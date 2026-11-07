import { db, nowIso } from '../db.js';
import { HttpError, toNumber, toPositiveInt, toNonNegativeNumber, requireString } from '../http.js';
import { serializeExercise, resolveExercise } from './exercises.js';

export function serializeSet(row) {
  return {
    id: row.id,
    number: row.set_number,
    weightKg: row.weight_kg,
    reps: row.reps,
    completed: Boolean(row.completed),
    restSeconds: row.rest_seconds,
  };
}

export function getWorkoutRow(userId, workoutId) {
  return db
    .prepare('SELECT * FROM workouts WHERE id = ? AND user_id = ?')
    .get(workoutId, userId);
}

export function assertWorkout(userId, workoutId) {
  const row = getWorkoutRow(userId, workoutId);
  if (!row) throw new HttpError(404, 'Entrenamiento no encontrado');
  return row;
}

// Workouts imported from Hevy are read-only: a later Hevy sync would overwrite
// any local edit, so we block content mutations (deletion is still allowed).
function assertEditableWorkout(row) {
  if (row?.source === 'hevy') {
    throw new HttpError(403, 'No se puede editar un entreno importado de Hevy');
  }
  return row;
}

export function workoutTotals(workoutId) {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN s.completed = 1 THEN COALESCE(s.weight_kg, 0) * COALESCE(s.reps, 0) ELSE 0 END), 0) AS volume,
         COALESCE(SUM(CASE WHEN s.completed = 1 THEN COALESCE(s.reps, 0) ELSE 0 END), 0) AS reps,
         COALESCE(SUM(CASE WHEN s.completed = 1 THEN 1 ELSE 0 END), 0) AS sets,
         COUNT(s.id) AS total_sets
       FROM workout_sets s
       JOIN workout_exercises we ON we.id = s.workout_exercise_id
       WHERE we.workout_id = ?`
    )
    .get(workoutId);

  return {
    volume: Number(row.volume) || 0,
    reps: Number(row.reps) || 0,
    sets: Number(row.sets) || 0,
    totalSets: Number(row.total_sets) || 0,
  };
}

export function prCount(userId, workout) {
  const exerciseIds = db
    .prepare(
      'SELECT DISTINCT exercise_id FROM workout_exercises WHERE workout_id = ?'
    )
    .all(workout.id)
    .map((row) => row.exercise_id);

  let count = 0;
  const maxThis = db.prepare(
    `SELECT MAX(s.weight_kg) AS max_weight
     FROM workout_sets s
     JOIN workout_exercises we ON we.id = s.workout_exercise_id
     WHERE we.workout_id = ? AND we.exercise_id = ? AND s.completed = 1 AND s.weight_kg > 0`
  );
  const maxPrevious = db.prepare(
    `SELECT MAX(s.weight_kg) AS max_weight
     FROM workout_sets s
     JOIN workout_exercises we ON we.id = s.workout_exercise_id
     JOIN workouts w ON w.id = we.workout_id
     WHERE we.exercise_id = ? AND w.user_id = ? AND w.finished_at IS NOT NULL
       AND w.started_at < ? AND s.completed = 1 AND s.weight_kg > 0`
  );

  for (const exerciseId of exerciseIds) {
    const current = maxThis.get(workout.id, exerciseId)?.max_weight;
    if (current === null || current === undefined) continue;
    const previous = maxPrevious.get(exerciseId, userId, workout.started_at)?.max_weight;
    if (Number(current) > Number(previous || 0)) count += 1;
  }

  return count;
}

export function getPreviousSets(userId, exerciseId, beforeIso, excludeWorkoutId = null) {
  const previousWorkout = db
    .prepare(
      `SELECT w.id
       FROM workouts w
       JOIN workout_exercises we ON we.workout_id = w.id
       WHERE w.user_id = ? AND we.exercise_id = ? AND w.finished_at IS NOT NULL
         AND w.started_at < ? AND (? IS NULL OR w.id != ?)
       ORDER BY w.started_at DESC
       LIMIT 1`
    )
    .get(
      userId,
      exerciseId,
      beforeIso,
      excludeWorkoutId,
      excludeWorkoutId
    );

  if (!previousWorkout) return [];

  const we = db
    .prepare(
      'SELECT id FROM workout_exercises WHERE workout_id = ? AND exercise_id = ? LIMIT 1'
    )
    .get(previousWorkout.id, exerciseId);

  if (!we) return [];

  return db
    .prepare(
      'SELECT * FROM workout_sets WHERE workout_exercise_id = ? ORDER BY set_number'
    )
    .all(we.id)
    .filter((row) => row.completed && (row.weight_kg !== null || row.reps !== null))
    .map(serializeSet);
}

// Previous-set suggestions for a set of exercises, keyed by exerciseId. Used to
// refill the "Anterior" column live when connectivity returns mid-workout, so
// an offline workout does not have to be uploaded (finished) just to see them.
// Only exercises the user owns are considered; unknown ids yield an empty list.
export function suggestionsForExercises(userId, exerciseIds = []) {
  const now = nowIso();
  const out = {};
  for (const raw of exerciseIds) {
    const exerciseId = Number(raw);
    if (!Number.isInteger(exerciseId)) continue;
    const owns = db
      .prepare('SELECT 1 FROM exercises WHERE id = ? AND user_id = ?')
      .get(exerciseId, userId);
    out[exerciseId] = owns ? getPreviousSets(userId, exerciseId, now) : [];
  }
  return out;
}

export function getWorkoutExercises(workoutId) {
  return db
    .prepare(
      `SELECT we.id AS workout_exercise_id, we.position, we.notes AS we_notes,
              we.superset_group, e.*
       FROM workout_exercises we
       JOIN exercises e ON e.id = we.exercise_id
       WHERE we.workout_id = ?
       ORDER BY we.position ASC, we.id ASC`
    )
    .all(workoutId);
}

export function getWorkoutDetail(userId, workoutId) {
  const workout = assertWorkout(userId, workoutId);
  const exercises = getWorkoutExercises(workoutId).map((row) => {
    const sets = db
      .prepare(
        'SELECT * FROM workout_sets WHERE workout_exercise_id = ? ORDER BY set_number ASC, id ASC'
      )
      .all(row.workout_exercise_id)
      .map(serializeSet);

    const previousSets = getPreviousSets(
      userId,
      row.id,
      workout.started_at,
      workout.id
    );

    return {
      id: row.workout_exercise_id,
      exerciseId: row.id,
      name: row.name,
      category: row.category,
      imageUrl: row.image_url,
      notes: row.we_notes,
      supersetGroup: row.superset_group,
      sets,
      previousSets,
      targetSets: sets.length,
    };
  });

  const totals = workoutTotals(workoutId);
  const active = !workout.finished_at;
  const durationSeconds = active
    ? Math.max(0, Math.round((Date.now() - new Date(workout.started_at).getTime()) / 1000))
    : workout.duration_seconds || 0;

  return {
    id: workout.id,
    name: workout.name,
    location: workout.location,
    notes: workout.notes,
    routineId: workout.routine_id,
    source: workout.source || null,
    startedAt: workout.started_at,
    finishedAt: workout.finished_at,
    durationSeconds,
    active,
    summary: {
      ...totals,
      records: active ? 0 : prCount(userId, workout),
    },
    exercises,
  };
}

export function createWorkout(userId, { name, location = null, notes = null, routineId = null } = {}) {
  const startedAt = nowIso();
  const info = db
    .prepare(
      `INSERT INTO workouts (user_id, routine_id, name, location, notes, started_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      routineId,
      name || 'Entreno',
      location,
      notes,
      startedAt,
      startedAt
    );

  return info.lastInsertRowid;
}

export function addExerciseToWorkout(
  userId,
  workoutId,
  exerciseId,
  { targetSets = 3, targetReps = null, notes = null, prefill = true } = {}
) {
  const workout = assertWorkout(userId, workoutId);
  assertEditableWorkout(workout);
  const positionRow = db
    .prepare(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM workout_exercises WHERE workout_id = ?'
    )
    .get(workoutId);

  const info = db
    .prepare(
      'INSERT INTO workout_exercises (workout_id, exercise_id, position, notes) VALUES (?, ?, ?, ?)'
    )
    .run(workoutId, exerciseId, positionRow.next_position, notes);

  const workoutExerciseId = info.lastInsertRowid;
  const count = Math.max(1, Math.min(Number(targetSets) || 3, 12));

  const insertSet = db.prepare(
    `INSERT INTO workout_sets (workout_exercise_id, set_number, weight_kg, reps, completed, rest_seconds, created_at)
     VALUES (?, ?, NULL, NULL, 0, NULL, ?)`
  );

  for (let i = 0; i < count; i += 1) {
    insertSet.run(workoutExerciseId, i + 1, nowIso());
  }

  return workoutExerciseId;
}

export function startWorkoutFromRoutine(userId, routineId) {
  const routine = db
    .prepare('SELECT * FROM routines WHERE id = ? AND user_id = ?')
    .get(routineId, userId);
  if (!routine) throw new HttpError(404, 'Rutina no encontrada');

  const exercises = db
    .prepare(
      `SELECT re.*, e.id AS exercise_id
       FROM routine_exercises re
       JOIN exercises e ON e.id = re.exercise_id
       WHERE re.routine_id = ?
       ORDER BY re.position ASC, re.id ASC`
    )
    .all(routineId);

  if (!exercises.length) {
    throw new HttpError(400, 'La rutina no tiene ejercicios');
  }

  const create = db.transaction(() => {
    const workoutId = createWorkout(userId, {
      name: routine.name,
      routineId: routine.id,
    });

    for (const rex of exercises) {
      addExerciseToWorkout(userId, workoutId, rex.exercise_id, {
        targetSets: rex.target_sets,
        targetReps: rex.target_reps,
        notes: rex.notes,
        prefill: true,
      });
    }

    return workoutId;
  });

  return create();
}

export function addSet(userId, workoutId, workoutExerciseId, input = {}) {
  assertEditableWorkout(assertWorkout(userId, workoutId));
  const we = db
    .prepare(
      'SELECT * FROM workout_exercises WHERE id = ? AND workout_id = ?'
    )
    .get(workoutExerciseId, workoutId);
  if (!we) throw new HttpError(404, 'Ejercicio del entreno no encontrado');

  const next = db
    .prepare(
      'SELECT COALESCE(MAX(set_number), 0) + 1 AS next_number FROM workout_sets WHERE workout_exercise_id = ?'
    )
    .get(workoutExerciseId).next_number;

  const info = db
    .prepare(
      `INSERT INTO workout_sets (workout_exercise_id, set_number, weight_kg, reps, completed, rest_seconds, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      workoutExerciseId,
      next,
      toNonNegativeNumber(input.weightKg),
      toPositiveInt(input.reps),
      input.completed ? 1 : 0,
      toPositiveInt(input.restSeconds),
      nowIso()
    );

  return db.prepare('SELECT * FROM workout_sets WHERE id = ?').get(info.lastInsertRowid);
}

export function updateSet(userId, workoutId, setId, input = {}) {
  assertEditableWorkout(assertWorkout(userId, workoutId));
  const row = db
    .prepare(
      `SELECT s.* FROM workout_sets s
       JOIN workout_exercises we ON we.id = s.workout_exercise_id
       WHERE s.id = ? AND we.workout_id = ?`
    )
    .get(setId, workoutId);
  if (!row) throw new HttpError(404, 'Serie no encontrada');

  const weight =
    input.weightKg === undefined ? row.weight_kg : toNonNegativeNumber(input.weightKg);
  const reps = input.reps === undefined ? row.reps : toPositiveInt(input.reps);
  const completed =
    input.completed === undefined ? row.completed : input.completed ? 1 : 0;
  const rest =
    input.restSeconds === undefined
      ? row.rest_seconds
      : toPositiveInt(input.restSeconds);

  db.prepare(
    'UPDATE workout_sets SET weight_kg = ?, reps = ?, completed = ?, rest_seconds = ? WHERE id = ?'
  ).run(weight, reps, completed, rest, setId);

  return db.prepare('SELECT * FROM workout_sets WHERE id = ?').get(setId);
}

export function deleteSet(userId, workoutId, setId) {
  assertEditableWorkout(assertWorkout(userId, workoutId));
  const row = db
    .prepare(
      `SELECT s.* FROM workout_sets s
       JOIN workout_exercises we ON we.id = s.workout_exercise_id
       WHERE s.id = ? AND we.workout_id = ?`
    )
    .get(setId, workoutId);
  if (!row) throw new HttpError(404, 'Serie no encontrada');

  db.prepare('DELETE FROM workout_sets WHERE id = ?').run(setId);

  const remaining = db
    .prepare(
      'SELECT id FROM workout_sets WHERE workout_exercise_id = ? ORDER BY set_number ASC, id ASC'
    )
    .all(row.workout_exercise_id);
  const renumber = db.prepare('UPDATE workout_sets SET set_number = ? WHERE id = ?');
  remaining.forEach((set, index) => renumber.run(index + 1, set.id));
}

export function deleteWorkoutExercise(userId, workoutId, workoutExerciseId) {
  assertEditableWorkout(assertWorkout(userId, workoutId));
  const row = db
    .prepare(
      'SELECT * FROM workout_exercises WHERE id = ? AND workout_id = ?'
    )
    .get(workoutExerciseId, workoutId);
  if (!row) throw new HttpError(404, 'Ejercicio del entreno no encontrado');

  db.prepare('DELETE FROM workout_exercises WHERE id = ?').run(workoutExerciseId);

  const remaining = db
    .prepare(
      'SELECT id FROM workout_exercises WHERE workout_id = ? ORDER BY position ASC, id ASC'
    )
    .all(workoutId);
  const renumber = db.prepare('UPDATE workout_exercises SET position = ? WHERE id = ?');
  remaining.forEach((we, index) => renumber.run(index, we.id));

  clearLoneSupersetGroups(workoutId);
}

function clearLoneSupersetGroups(workoutId) {
  db.prepare(
    `UPDATE workout_exercises
     SET superset_group = NULL
     WHERE workout_id = ? AND superset_group IS NOT NULL
       AND superset_group IN (
         SELECT superset_group
         FROM workout_exercises
         WHERE workout_id = ? AND superset_group IS NOT NULL
         GROUP BY superset_group
         HAVING COUNT(*) < 2
       )`
  ).run(workoutId, workoutId);
}

function getOrderedWorkoutExercises(workoutId) {
  return db
    .prepare(
      `SELECT id, superset_group
       FROM workout_exercises
       WHERE workout_id = ?
       ORDER BY position ASC, id ASC`
    )
    .all(workoutId);
}

function writeExerciseOrder(workoutId, orderedIds) {
  // positions are unique per workout, so a one-by-one renumber can transiently
  // collide (row A takes a position row B still holds). Offset every row out of
  // range first, then assign the final dense sequence. Wrapped in a transaction.
  const offset = db.prepare(
    'UPDATE workout_exercises SET position = position + ? WHERE workout_id = ?'
  );
  const renumber = db.prepare(
    'UPDATE workout_exercises SET position = ? WHERE id = ? AND workout_id = ?'
  );
  const OFFSET = 100000;
  db.transaction(() => {
    offset.run(OFFSET, workoutId);
    orderedIds.forEach((id, index) => renumber.run(index, id, workoutId));
  })();
}

export function setSuperset(userId, workoutId, workoutExerciseId, otherWorkoutExerciseId) {
  assertEditableWorkout(assertWorkout(userId, workoutId));
  const rows = getOrderedWorkoutExercises(workoutId);
  const source = rows.find((row) => row.id === workoutExerciseId);
  const target = rows.find((row) => row.id === otherWorkoutExerciseId);
  if (!source) throw new HttpError(404, 'Ejercicio del entreno no encontrado');
  if (!target) throw new HttpError(404, 'Ejercicio para la superserie no encontrado');
  if (source.id === target.id) throw new HttpError(400, 'Elige otro ejercicio');
  if (
    source.superset_group !== null &&
    source.superset_group === target.superset_group
  ) {
    return getWorkoutDetail(userId, workoutId);
  }

  const sourceMembers = source.superset_group
    ? rows.filter((row) => row.superset_group === source.superset_group)
    : [source];
  const targetMembers = target.superset_group
    ? rows.filter((row) => row.superset_group === target.superset_group)
    : [target];
  const targetIds = new Set(targetMembers.map((row) => row.id));
  const remaining = rows.filter((row) => !targetIds.has(row.id));
  const anchorId = sourceMembers[sourceMembers.length - 1].id;
  const anchorIndex = remaining.findIndex((row) => row.id === anchorId);
  const ordered = [
    ...remaining.slice(0, anchorIndex + 1),
    ...targetMembers,
    ...remaining.slice(anchorIndex + 1),
  ];

  const groupId =
    source.superset_group ??
    target.superset_group ??
    db
      .prepare(
        `SELECT COALESCE(MAX(superset_group), 0) + 1 AS next_group
         FROM workout_exercises WHERE workout_id = ?`
      )
      .get(workoutId).next_group;

  const combinedIds = [...sourceMembers, ...targetMembers].map((row) => row.id);
  const transaction = db.transaction(() => {
    const assign = db.prepare(
      'UPDATE workout_exercises SET superset_group = ? WHERE id = ?'
    );
    for (const id of combinedIds) assign.run(groupId, id);
    writeExerciseOrder(workoutId, ordered.map((row) => row.id));
    clearLoneSupersetGroups(workoutId);
  });
  transaction();

  return getWorkoutDetail(userId, workoutId);
}

export function removeFromSuperset(userId, workoutId, workoutExerciseId) {
  assertEditableWorkout(assertWorkout(userId, workoutId));
  const row = db
    .prepare(
      'SELECT * FROM workout_exercises WHERE id = ? AND workout_id = ?'
    )
    .get(workoutExerciseId, workoutId);
  if (!row) throw new HttpError(404, 'Ejercicio del entreno no encontrado');

  db.prepare('UPDATE workout_exercises SET superset_group = NULL WHERE id = ?').run(
    workoutExerciseId
  );
  clearLoneSupersetGroups(workoutId);

  return getWorkoutDetail(userId, workoutId);
}

export function reorderWorkoutExercises(userId, workoutId, orderedIds) {
  assertEditableWorkout(assertWorkout(userId, workoutId));
  const rows = getOrderedWorkoutExercises(workoutId);
  const currentIds = rows.map((row) => row.id);
  const ids = Array.isArray(orderedIds)
    ? orderedIds.map((id) => Number(id)).filter((id) => Number.isInteger(id))
    : [];

  if (
    ids.length !== currentIds.length ||
    new Set(ids).size !== currentIds.length ||
    !currentIds.every((id) => ids.includes(id))
  ) {
    throw new HttpError(400, 'El orden de ejercicios no es válido');
  }

  writeExerciseOrder(workoutId, ids);
  return getWorkoutDetail(userId, workoutId);
}

export function replaceWorkoutExercise(userId, workoutId, workoutExerciseId, exerciseId) {
  assertEditableWorkout(assertWorkout(userId, workoutId));
  const row = db
    .prepare(
      'SELECT * FROM workout_exercises WHERE id = ? AND workout_id = ?'
    )
    .get(workoutExerciseId, workoutId);
  if (!row) throw new HttpError(404, 'Ejercicio del entreno no encontrado');

  db.prepare('UPDATE workout_exercises SET exercise_id = ? WHERE id = ?').run(
    exerciseId,
    workoutExerciseId
  );

  return getWorkoutDetail(userId, workoutId);
}

export function finishWorkout(userId, workoutId, input = {}) {
  const workout = assertWorkout(userId, workoutId);
  assertEditableWorkout(workout);
  if (workout.finished_at) return getWorkoutDetail(userId, workoutId);

  const finishedAt = nowIso();
  const computed = Math.max(
    0,
    Math.round((new Date(finishedAt).getTime() - new Date(workout.started_at).getTime()) / 1000)
  );
  const duration = toPositiveInt(input.durationSeconds, computed);

  db.prepare(
    `UPDATE workouts SET finished_at = ?, duration_seconds = ?,
       notes = COALESCE(?, notes), name = COALESCE(?, name), location = COALESCE(?, location)
     WHERE id = ?`
  ).run(
    finishedAt,
    duration,
    input.notes ?? null,
    input.name ? String(input.name).slice(0, 200) : null,
    input.location ? String(input.location).slice(0, 200) : null,
    workoutId
  );

  return getWorkoutDetail(userId, workoutId);
}

export function listWorkouts(userId, { limit = 20, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const rows = db
    .prepare(
      `SELECT w.*, r.name AS routine_name
       FROM workouts w
       LEFT JOIN routines r ON r.id = w.routine_id
       WHERE w.user_id = ? AND w.finished_at IS NOT NULL
       ORDER BY w.started_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(userId, safeLimit, safeOffset);

  return rows.map((workout) => {
    const totals = workoutTotals(workout.id);
    const exercises = db
      .prepare(
        `SELECT we.id, we.superset_group, e.name, e.image_url,
           (SELECT COUNT(*) FROM workout_sets s WHERE s.workout_exercise_id = we.id AND s.completed = 1) AS completed_sets,
           (SELECT COUNT(*) FROM workout_sets s WHERE s.workout_exercise_id = we.id) AS total_sets
         FROM workout_exercises we
         JOIN exercises e ON e.id = we.exercise_id
         WHERE we.workout_id = ?
         ORDER BY we.position ASC, we.id ASC`
      )
      .all(workout.id);

    return {
      id: workout.id,
      name: workout.name,
      location: workout.location,
      routineId: workout.routine_id,
      routineName: workout.routine_name,
      startedAt: workout.started_at,
      finishedAt: workout.finished_at,
      durationSeconds: workout.duration_seconds || 0,
      summary: {
        ...totals,
        records: prCount(userId, workout),
      },
      exercises: exercises.map((ex) => ({
        id: ex.id,
        name: ex.name,
        imageUrl: ex.image_url,
        supersetGroup: ex.superset_group,
        completedSets: ex.completed_sets,
        totalSets: ex.total_sets,
      })),
    };
  });
}

export function getActiveWorkout(userId) {
  return db
    .prepare(
      `SELECT * FROM workouts
       WHERE user_id = ? AND finished_at IS NULL
       ORDER BY started_at DESC LIMIT 1`
    )
    .get(userId);
}

export function updateWorkout(userId, workoutId, input = {}) {
  assertEditableWorkout(assertWorkout(userId, workoutId));
  const fields = [];
  const values = [];

  if (input.name !== undefined) {
    fields.push('name = ?');
    values.push(String(input.name).trim().slice(0, 200) || 'Entreno');
  }
  if (input.location !== undefined) {
    fields.push('location = ?');
    values.push(input.location ? String(input.location).slice(0, 200) : null);
  }
  if (input.notes !== undefined) {
    fields.push('notes = ?');
    values.push(input.notes ? String(input.notes).slice(0, 2000) : null);
  }

  if (fields.length) {
    values.push(workoutId);
    db.prepare(`UPDATE workouts SET ${fields.join(', ')} WHERE id = ?`).run(
      ...values
    );
  }

  return getWorkoutDetail(userId, workoutId);
}

export function updateWorkoutExercise(userId, workoutId, workoutExerciseId, input = {}) {
  assertEditableWorkout(assertWorkout(userId, workoutId));
  const row = db
    .prepare(
      'SELECT * FROM workout_exercises WHERE id = ? AND workout_id = ?'
    )
    .get(workoutExerciseId, workoutId);
  if (!row) throw new HttpError(404, 'Ejercicio del entreno no encontrado');

  if (input.notes !== undefined) {
    db.prepare('UPDATE workout_exercises SET notes = ? WHERE id = ?').run(
      input.notes ? String(input.notes).slice(0, 1000) : null,
      workoutExerciseId
    );
  }

  return getWorkoutDetail(userId, workoutId);
}

export function deleteWorkout(userId, workoutId) {
  assertWorkout(userId, workoutId);
  db.prepare('DELETE FROM workouts WHERE id = ?').run(workoutId);
}

// Materialize a workout that was recorded offline, idempotently by client_id.
//
// The client assigns a UUID when it starts an offline workout and sends the
// whole finished workout here. Idempotency: a workout is unique per
// (user_id, client_id). If we have never seen this client_id we create and
// finish the workout; if we have, the upload is a retry — we return the existing
// workout untouched (a finished workout is append-only from the client, so a
// retry must never mutate or duplicate it). Everything runs in one transaction,
// so a partial materialization can never be observed.
export function syncWorkout(userId, input = {}) {
  const clientId = requireString(input.clientId, 'clientId', { max: 100 });

  const existing = db
    .prepare('SELECT * FROM workouts WHERE user_id = ? AND client_id = ?')
    .get(userId, clientId);
  if (existing) {
    // Idempotent retry: do not duplicate or mutate an already-synced workout.
    return getWorkoutDetail(userId, existing.id);
  }

  const name = input.name
    ? requireString(input.name, 'nombre del entrenamiento', { max: 200 })
    : 'Entreno';
  const exercises = Array.isArray(input.exercises) ? input.exercises : [];

  // Resolve exercises BEFORE opening the write transaction: resolveExercise may
  // create catalog-linked or custom exercises, and we want any 404 (unknown
  // exerciseId) to abort before we write the workout.
  const resolved = exercises.map((ex) => ({
    exercise: resolveExercise(userId, ex || {}),
    notes: ex?.notes ? String(ex.notes).slice(0, 1000) : null,
    supersetGroup:
      ex?.supersetGroup == null ? null : Number(ex.supersetGroup),
    sets: Array.isArray(ex?.sets) ? ex.sets : [],
  }));

  const startedAt = input.startedAt
    ? new Date(input.startedAt).toISOString()
    : nowIso();
  const finishedAt = input.finishedAt
    ? new Date(input.finishedAt).toISOString()
    : nowIso();
  const computedDuration = Math.max(
    0,
    Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000)
  );
  const duration = toPositiveInt(input.durationSeconds, computedDuration);

  const create = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO workouts
           (user_id, routine_id, name, location, notes, started_at,
            finished_at, duration_seconds, created_at, client_id)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        name,
        input.location ? String(input.location).slice(0, 200) : null,
        input.notes ? String(input.notes).slice(0, 2000) : null,
        startedAt,
        finishedAt,
        duration,
        nowIso(),
        clientId
      );
    const workoutId = info.lastInsertRowid;

    const insertWe = db.prepare(
      'INSERT INTO workout_exercises (workout_id, exercise_id, position, notes, superset_group) VALUES (?, ?, ?, ?, ?)'
    );
    const insertSet = db.prepare(
      `INSERT INTO workout_sets
         (workout_exercise_id, set_number, weight_kg, reps, completed, rest_seconds, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    resolved.forEach((item, position) => {
      const weInfo = insertWe.run(
        workoutId,
        item.exercise.id,
        position,
        item.notes,
        Number.isInteger(item.supersetGroup) ? item.supersetGroup : null
      );
      const weId = weInfo.lastInsertRowid;
      item.sets.forEach((set, index) => {
        insertSet.run(
          weId,
          index + 1,
          toNonNegativeNumber(set?.weightKg),
          toPositiveInt(set?.reps),
          set?.completed ? 1 : 0,
          toPositiveInt(set?.restSeconds),
          nowIso()
        );
      });
    });

    return workoutId;
  });

  const workoutId = create();
  return getWorkoutDetail(userId, workoutId);
}

export { serializeExercise };
