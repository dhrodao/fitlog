import { Router } from 'express';
import { db } from '../db.js';
import { listWorkouts } from '../services/workouts.js';
import { bestE1rm, personalRecords } from '../services/strength.js';
import { getCatalogExercise } from '../catalog.js';

const router = Router();

function periodDays(period) {
  if (period === 'year') return 365;
  if (period === '6m') return 180;
  return 90;
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function workoutRows(userId, fromIso) {
  return db
    .prepare(
      `SELECT w.id, w.started_at, w.finished_at, w.duration_seconds,
         COALESCE(SUM(CASE WHEN s.completed = 1 THEN COALESCE(s.weight_kg, 0) * COALESCE(s.reps, 0) ELSE 0 END), 0) AS volume,
         COALESCE(SUM(CASE WHEN s.completed = 1 THEN COALESCE(s.reps, 0) ELSE 0 END), 0) AS reps,
         COALESCE(SUM(CASE WHEN s.completed = 1 THEN 1 ELSE 0 END), 0) AS sets
       FROM workouts w
       LEFT JOIN workout_exercises we ON we.workout_id = w.id
       LEFT JOIN workout_sets s ON s.workout_exercise_id = we.id
       WHERE w.user_id = ? AND w.finished_at IS NOT NULL AND w.started_at >= ?
       GROUP BY w.id
       ORDER BY w.started_at ASC`
    )
    .all(userId, fromIso)
    .map((row) => ({
      id: row.id,
      date: row.started_at,
      durationSeconds: row.duration_seconds || 0,
      volume: Number(row.volume) || 0,
      reps: Number(row.reps) || 0,
      sets: Number(row.sets) || 0,
    }));
}

router.get('/overview', (req, res) => {
  const days = periodDays(req.query.period);
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = workoutRows(req.user.id, from.toISOString());

  const totals = rows.reduce(
    (acc, row) => {
      acc.workouts += 1;
      acc.durationSeconds += row.durationSeconds;
      acc.volume += row.volume;
      acc.reps += row.reps;
      acc.sets += row.sets;
      return acc;
    },
    { workouts: 0, durationSeconds: 0, volume: 0, reps: 0, sets: 0 }
  );

  const buckets = new Map();
  const firstWeek = startOfWeek(from);
  const currentWeek = startOfWeek(new Date());
  for (
    let cursor = new Date(firstWeek);
    cursor <= currentWeek;
    cursor.setUTCDate(cursor.getUTCDate() + 7)
  ) {
    buckets.set(dateKey(cursor), {
      weekStart: dateKey(cursor),
      durationSeconds: 0,
      volume: 0,
      reps: 0,
      sets: 0,
      workouts: 0,
    });
  }

  for (const row of rows) {
    const key = dateKey(startOfWeek(new Date(row.date)));
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.durationSeconds += row.durationSeconds;
    bucket.volume += row.volume;
    bucket.reps += row.reps;
    bucket.sets += row.sets;
    bucket.workouts += 1;
  }

  const thisWeekKey = dateKey(currentWeek);
  const thisWeek = buckets.get(thisWeekKey)?.durationSeconds || 0;
  const allTime = db
    .prepare(
      'SELECT COUNT(*) AS count FROM workouts WHERE user_id = ? AND finished_at IS NOT NULL'
    )
    .get(req.user.id).count;

  const latestWeight = db
    .prepare(
      'SELECT * FROM measurements WHERE user_id = ? ORDER BY date DESC LIMIT 1'
    )
    .get(req.user.id);

  res.json({
    period: req.query.period || '3m',
    totals,
    allTimeWorkouts: allTime,
    thisWeekSeconds: thisWeek,
    weekly: Array.from(buckets.values()),
    latestWeight: latestWeight
      ? {
          date: latestWeight.date,
          weightKg: latestWeight.weight_kg,
        }
      : null,
    recent: listWorkouts(req.user.id, { limit: 3 }),
  });
});

router.get('/exercise/:exerciseId', (req, res) => {
  const exerciseId = Number(req.params.exerciseId);
  const exercise = db
    .prepare('SELECT * FROM exercises WHERE id = ? AND user_id = ?')
    .get(exerciseId, req.user.id);
  if (!exercise) return res.status(404).json({ error: 'Ejercicio no encontrado' });

  // Fetch the individual completed sets per finished session. We group them in
  // JS so the e1RM is computed PER SET (Epley), not from a session's heaviest
  // weight crossed with its highest reps — those can belong to different sets.
  // The per-set rows are also what the "Historial" tab renders (one line per
  // set: weight × reps), so we keep them around, not just the aggregates.
  const setRows = db
    .prepare(
      `SELECT w.id AS workout_id, w.name AS workout_name, w.started_at,
         w.duration_seconds, we.superset_group, s.weight_kg, s.reps
       FROM workouts w
       JOIN workout_exercises we ON we.workout_id = w.id
       JOIN workout_sets s ON s.workout_exercise_id = we.id
       WHERE w.user_id = ? AND we.exercise_id = ?
         AND w.finished_at IS NOT NULL AND s.completed = 1
       ORDER BY w.started_at ASC, s.id ASC`
    )
    .all(req.user.id, exerciseId);

  // Group completed sets by session, preserving session order.
  const sessionsById = new Map();
  for (const row of setRows) {
    let session = sessionsById.get(row.workout_id);
    if (!session) {
      session = {
        workoutId: row.workout_id,
        name: row.workout_name,
        date: row.started_at,
        durationSeconds: row.duration_seconds || 0,
        supersetGroup: row.superset_group,
        sets: [],
      };
      sessionsById.set(row.workout_id, session);
    }
    session.sets.push({
      weightKg: row.weight_kg,
      reps: row.reps,
      completed: true,
    });
  }

  const sessions = Array.from(sessionsById.values());
  const round1 = (n) => Math.round(n * 10) / 10;

  const history = sessions.map((session) => {
    let maxWeight = 0;
    let maxReps = 0;
    let volume = 0;
    let reps = 0;
    for (const s of session.sets) {
      const w = Number(s.weightKg) || 0;
      const r = Number(s.reps) || 0;
      if (w > maxWeight) maxWeight = w;
      if (r > maxReps) maxReps = r;
      volume += w * r;
      reps += r;
    }
    const e1rm = bestE1rm(session.sets);
    return {
      workoutId: session.workoutId,
      name: session.name,
      date: session.date,
      durationSeconds: session.durationSeconds,
      superset: session.supersetGroup != null,
      // One entry per completed set, in logged order, for the Historial tab.
      sets: session.sets.map((s) => ({ weightKg: s.weightKg, reps: s.reps })),
      maxWeight: maxWeight > 0 ? maxWeight : null,
      volume,
      reps,
      maxReps: maxReps > 0 ? maxReps : null,
      e1rm: e1rm > 0 ? round1(e1rm) : null,
    };
  });

  // Documented personal records across all sessions (see services/strength.js).
  const prs = personalRecords(sessions);

  // Catalog detail (muscles, equipment, instructions, …) for the "Indicaciones"
  // tab. Only available when the user's exercise is linked to a catalog entry;
  // custom exercises with no catalog_id simply return detail: null.
  const detail = exercise.catalog_id
    ? (() => {
        const catalog = getCatalogExercise(exercise.catalog_id);
        if (!catalog) return null;
        return {
          muscles: catalog.muscles,
          equipment: catalog.equipment,
          instructions: catalog.instructions,
          level: catalog.level,
          force: catalog.force,
          mechanic: catalog.mechanic,
          imageUrl: catalog.imageUrl,
        };
      })()
    : null;

  res.json({
    exercise: {
      id: exercise.id,
      name: exercise.name,
      category: exercise.category,
      imageUrl: exercise.image_url,
    },
    history,
    detail,
    bestWeight: prs.maxWeight,
    estimated1rm: prs.bestE1rm,
    prs,
  });
});

export default router;
