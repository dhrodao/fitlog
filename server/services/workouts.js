import { db, nowIso } from '../db.js';
import { HttpError, toNumber, toPositiveInt } from '../http.js';
import { serializeExercise } from './exercises.js';

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

export function getWorkoutExercises(workoutId) {
  return db
    .prepare(
      `SELECT we.id AS workout_exercise_id, we.position, we.notes AS we_notes, e.*
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

function parseTargetReps(value) {
  if (!value) return null;
  const match = String(value).match(/\d+/);
  return match ? Number(match[0]) : null;
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
  const previous = prefill
    ? getPreviousSets(userId, exerciseId, workout.started_at, workout.id)
    : [];
  const defaultReps = parseTargetReps(targetReps);

  const insertSet = db.prepare(
    `INSERT INTO workout_sets (workout_exercise_id, set_number, weight_kg, reps, completed, rest_seconds, created_at)
     VALUES (?, ?, ?, ?, 0, NULL, ?)`
  );

  for (let i = 0; i < count; i += 1) {
    const prev = previous[i] || previous[previous.length - 1] || null;
    insertSet.run(
      workoutExerciseId,
      i + 1,
      prev ? prev.weightKg : null,
      prev ? prev.reps : defaultReps,
      nowIso()
    );
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
  assertWorkout(userId, workoutId);
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
      toNumber(input.weightKg),
      toPositiveInt(input.reps),
      input.completed ? 1 : 0,
      toPositiveInt(input.restSeconds),
      nowIso()
    );

  return db.prepare('SELECT * FROM workout_sets WHERE id = ?').get(info.lastInsertRowid);
}

export function updateSet(userId, workoutId, setId, input = {}) {
  assertWorkout(userId, workoutId);
  const row = db
    .prepare(
      `SELECT s.* FROM workout_sets s
       JOIN workout_exercises we ON we.id = s.workout_exercise_id
       WHERE s.id = ? AND we.workout_id = ?`
    )
    .get(setId, workoutId);
  if (!row) throw new HttpError(404, 'Serie no encontrada');

  const weight =
    input.weightKg === undefined ? row.weight_kg : toNumber(input.weightKg);
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
  assertWorkout(userId, workoutId);
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
  assertWorkout(userId, workoutId);
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
}

export function finishWorkout(userId, workoutId, input = {}) {
  const workout = assertWorkout(userId, workoutId);
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
        `SELECT we.id, e.name, e.image_url,
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
  assertWorkout(userId, workoutId);
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
  assertWorkout(userId, workoutId);
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

export { serializeExercise };
