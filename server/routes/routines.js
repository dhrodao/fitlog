import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { HttpError, requireString, toPositiveInt } from '../http.js';
import { resolveExercise, serializeExercise } from '../services/exercises.js';
import {
  getActiveWorkout,
  getWorkoutDetail,
  startWorkoutFromRoutine,
} from '../services/workouts.js';

const router = Router();

function periodStart(period) {
  const days =
    period === 'year' ? 365 : period === '3m' ? 90 : period === '6m' ? 180 : 365;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function getRoutineOr404(userId, id) {
  const routine = db
    .prepare('SELECT * FROM routines WHERE id = ? AND user_id = ?')
    .get(id, userId);
  if (!routine) throw new HttpError(404, 'Rutina no encontrada');
  return routine;
}

function lastRoutineSets(userId, routineId, exerciseId) {
  const workout = db
    .prepare(
      `SELECT w.id
       FROM workouts w
       JOIN workout_exercises we ON we.workout_id = w.id
       WHERE w.user_id = ? AND w.routine_id = ? AND we.exercise_id = ?
         AND w.finished_at IS NOT NULL
       ORDER BY w.started_at DESC LIMIT 1`
    )
    .get(userId, routineId, exerciseId);
  if (!workout) return [];

  const we = db
    .prepare(
      'SELECT id FROM workout_exercises WHERE workout_id = ? AND exercise_id = ? LIMIT 1'
    )
    .get(workout.id, exerciseId);
  if (!we) return [];

  return db
    .prepare(
      'SELECT * FROM workout_sets WHERE workout_exercise_id = ? ORDER BY set_number ASC'
    )
    .all(we.id)
    .filter((row) => row.completed)
    .map((row) => ({
      number: row.set_number,
      weightKg: row.weight_kg,
      reps: row.reps,
    }));
}

function routineExercises(userId, routineId) {
  const rows = db
    .prepare(
      `SELECT re.id AS routine_exercise_id, re.position, re.target_sets, re.target_reps, re.notes, e.*
       FROM routine_exercises re
       JOIN exercises e ON e.id = re.exercise_id
       WHERE re.routine_id = ?
       ORDER BY re.position ASC, re.id ASC`
    )
    .all(routineId);

  return rows.map((row) => ({
    id: row.routine_exercise_id,
    position: row.position,
    targetSets: row.target_sets,
    targetReps: row.target_reps,
    notes: row.notes,
    exercise: serializeExercise(row),
    lastSets: lastRoutineSets(userId, routineId, row.id),
  }));
}

function routineHistory(userId, routineId, period = 'year') {
  return db
    .prepare(
      `SELECT w.id, w.started_at, w.finished_at, w.duration_seconds,
         COALESCE(SUM(CASE WHEN s.completed = 1 THEN COALESCE(s.weight_kg, 0) * COALESCE(s.reps, 0) ELSE 0 END), 0) AS volume,
         COALESCE(SUM(CASE WHEN s.completed = 1 THEN COALESCE(s.reps, 0) ELSE 0 END), 0) AS reps,
         COALESCE(SUM(CASE WHEN s.completed = 1 THEN 1 ELSE 0 END), 0) AS sets
       FROM workouts w
       LEFT JOIN workout_exercises we ON we.workout_id = w.id
       LEFT JOIN workout_sets s ON s.workout_exercise_id = we.id
       WHERE w.user_id = ? AND w.routine_id = ? AND w.finished_at IS NOT NULL
         AND w.started_at >= ?
       GROUP BY w.id
       ORDER BY w.started_at ASC`
    )
    .all(userId, routineId, periodStart(period))
    .map((row) => ({
      workoutId: row.id,
      date: row.started_at,
      durationSeconds: row.duration_seconds || 0,
      volume: Number(row.volume) || 0,
      reps: Number(row.reps) || 0,
      sets: Number(row.sets) || 0,
    }));
}

function routineDetail(userId, routineId, period = 'year') {
  const routine = getRoutineOr404(userId, routineId);
  return {
    id: routine.id,
    name: routine.name,
    description: routine.description,
    folder: routine.folder,
    createdAt: routine.created_at,
    updatedAt: routine.updated_at,
    exercises: routineExercises(userId, routineId),
    history: routineHistory(userId, routineId, period),
  };
}

function normalizeExercises(userId, list) {
  if (!Array.isArray(list)) return [];

  return list.map((item, index) => {
    const exercise = resolveExercise(userId, item);
    return {
      exerciseId: exercise.id,
      position: index,
      targetSets: Math.min(
        Math.max(toPositiveInt(item.targetSets, 3) || 3, 1),
        20
      ),
      targetReps: item.targetReps ? String(item.targetReps).slice(0, 40) : '8-12',
      notes: item.notes ? String(item.notes).slice(0, 1000) : null,
    };
  });
}

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*,
         (SELECT COUNT(*) FROM routine_exercises re WHERE re.routine_id = r.id) AS exercise_count,
         (SELECT GROUP_CONCAT(e.name, ', ') FROM (
            SELECT e.name FROM routine_exercises re
            JOIN exercises e ON e.id = re.exercise_id
            WHERE re.routine_id = r.id ORDER BY re.position LIMIT 4
          ) e) AS preview
       FROM routines r
       WHERE r.user_id = ?
       ORDER BY r.folder COLLATE NOCASE, r.name COLLATE NOCASE`
    )
    .all(req.user.id);

  res.json({
    routines: rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      folder: row.folder,
      exerciseCount: row.exercise_count,
      preview: row.preview || '',
      updatedAt: row.updated_at,
    })),
  });
});

router.post('/', (req, res) => {
  const name = requireString(req.body?.name, 'nombre de la rutina', { max: 120 });
  const exercises = normalizeExercises(req.user.id, req.body?.exercises);
  const now = nowIso();

  const create = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO routines (user_id, name, description, folder, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.user.id,
        name,
        req.body?.description ? String(req.body.description).slice(0, 1000) : null,
        req.body?.folder ? String(req.body.folder).slice(0, 120) : null,
        now,
        now
      );

    const routineId = info.lastInsertRowid;
    const insert = db.prepare(
      `INSERT INTO routine_exercises (routine_id, exercise_id, position, target_sets, target_reps, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const ex of exercises) {
      insert.run(
        routineId,
        ex.exerciseId,
        ex.position,
        ex.targetSets,
        ex.targetReps,
        ex.notes
      );
    }
    return routineId;
  });

  const routineId = create();
  res.status(201).json({ routine: routineDetail(req.user.id, routineId) });
});

router.get('/:id', (req, res) => {
  res.json({
    routine: routineDetail(
      req.user.id,
      Number(req.params.id),
      req.query.period || 'year'
    ),
  });
});

router.put('/:id', (req, res) => {
  const routine = getRoutineOr404(req.user.id, Number(req.params.id));
  const name = req.body?.name
    ? requireString(req.body.name, 'nombre de la rutina', { max: 120 })
    : routine.name;
  const exercises = normalizeExercises(req.user.id, req.body?.exercises);
  const now = nowIso();

  const update = db.transaction(() => {
    db.prepare(
      `UPDATE routines SET name = ?, description = ?, folder = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      name,
      req.body?.description !== undefined
        ? String(req.body.description || '').slice(0, 1000) || null
        : routine.description,
      req.body?.folder !== undefined
        ? String(req.body.folder || '').slice(0, 120) || null
        : routine.folder,
      now,
      routine.id
    );

    db.prepare('DELETE FROM routine_exercises WHERE routine_id = ?').run(routine.id);

    const insert = db.prepare(
      `INSERT INTO routine_exercises (routine_id, exercise_id, position, target_sets, target_reps, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const ex of exercises) {
      insert.run(
        routine.id,
        ex.exerciseId,
        ex.position,
        ex.targetSets,
        ex.targetReps,
        ex.notes
      );
    }
  });

  update();
  res.json({ routine: routineDetail(req.user.id, routine.id) });
});

router.delete('/:id', (req, res) => {
  const routine = getRoutineOr404(req.user.id, Number(req.params.id));
  db.prepare('DELETE FROM routines WHERE id = ?').run(routine.id);
  res.json({ ok: true });
});

router.post('/:id/duplicate', (req, res) => {
  const routine = getRoutineOr404(req.user.id, Number(req.params.id));
  const exercises = routineExercises(req.user.id, routine.id);
  const now = nowIso();

  const duplicate = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO routines (user_id, name, description, folder, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.user.id,
        `${routine.name} (copia)`,
        routine.description,
        routine.folder,
        now,
        now
      );

    const routineId = info.lastInsertRowid;
    const insert = db.prepare(
      `INSERT INTO routine_exercises (routine_id, exercise_id, position, target_sets, target_reps, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const ex of exercises) {
      insert.run(
        routineId,
        ex.exercise.id,
        ex.position,
        ex.targetSets,
        ex.targetReps,
        ex.notes
      );
    }
    return routineId;
  });

  const routineId = duplicate();
  res.status(201).json({ routine: routineDetail(req.user.id, routineId) });
});

router.post('/:id/start', (req, res) => {
  const routine = getRoutineOr404(req.user.id, Number(req.params.id));
  const active = getActiveWorkout(req.user.id);
  if (active) {
    return res.status(409).json({
      error: 'Ya tienes un entrenamiento en curso',
      workoutId: active.id,
    });
  }

  const workoutId = startWorkoutFromRoutine(req.user.id, routine.id);
  res.status(201).json({ workout: getWorkoutDetail(req.user.id, workoutId) });
});

export default router;
