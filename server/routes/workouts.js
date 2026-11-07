import { Router } from 'express';
import { requireString, toPositiveInt } from '../http.js';
import { resolveExercise } from '../services/exercises.js';
import {
  addExerciseToWorkout,
  addSet,
  createWorkout,
  deleteSet,
  deleteWorkout,
  deleteWorkoutExercise,
  finishWorkout,
  getActiveWorkout,
  getWorkoutDetail,
  listWorkouts,
  removeFromSuperset,
  reorderWorkoutExercises,
  replaceWorkoutExercise,
  setSuperset,
  updateSet,
  updateWorkout,
  updateWorkoutExercise,
  syncWorkout,
} from '../services/workouts.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    workouts: listWorkouts(req.user.id, {
      limit: req.query.limit,
      offset: req.query.offset,
    }),
  });
});

router.get('/active', (req, res) => {
  const active = getActiveWorkout(req.user.id);
  if (!active) return res.json({ workout: null });
  res.json({ workout: getWorkoutDetail(req.user.id, active.id) });
});

router.post('/', (req, res) => {
  const active = getActiveWorkout(req.user.id);
  if (active) {
    return res.status(409).json({
      error: 'Ya tienes un entrenamiento en curso',
      workoutId: active.id,
    });
  }

  const name = req.body?.name
    ? requireString(req.body.name, 'nombre del entrenamiento', { max: 200 })
    : 'Entreno';

  const workoutId = createWorkout(req.user.id, {
    name,
    location: req.body?.location || null,
    notes: req.body?.notes || null,
    routineId: null,
  });

  res.status(201).json({ workout: getWorkoutDetail(req.user.id, workoutId) });
});

// Upload a workout recorded offline. Idempotent by clientId: a retried upload
// returns the already-synced workout instead of creating a duplicate.
router.post('/sync', (req, res) => {
  const workout = syncWorkout(req.user.id, req.body || {});
  res.status(201).json({ workout });
});

router.get('/:id', (req, res) => {
  res.json({
    workout: getWorkoutDetail(req.user.id, Number(req.params.id)),
  });
});

router.patch('/:id', (req, res) => {
  res.json({
    workout: updateWorkout(req.user.id, Number(req.params.id), req.body || {}),
  });
});

router.delete('/:id', (req, res) => {
  deleteWorkout(req.user.id, Number(req.params.id));
  res.json({ ok: true });
});

router.post('/:id/finish', (req, res) => {
  res.json({
    workout: finishWorkout(req.user.id, Number(req.params.id), req.body || {}),
  });
});

router.post('/:id/exercises', (req, res) => {
  const exercise = resolveExercise(req.user.id, req.body || {});
  addExerciseToWorkout(req.user.id, Number(req.params.id), exercise.id, {
    targetSets: toPositiveInt(req.body?.targetSets, 3) || 3,
    targetReps: req.body?.targetReps || null,
    notes: req.body?.notes || null,
    prefill: req.body?.prefill !== false,
  });

  res.status(201).json({
    workout: getWorkoutDetail(req.user.id, Number(req.params.id)),
  });
});

router.patch('/:id/exercises/:workoutExerciseId', (req, res) => {
  res.json({
    workout: updateWorkoutExercise(
      req.user.id,
      Number(req.params.id),
      Number(req.params.workoutExerciseId),
      req.body || {}
    ),
  });
});

router.delete('/:id/exercises/:workoutExerciseId', (req, res) => {
  deleteWorkoutExercise(
    req.user.id,
    Number(req.params.id),
    Number(req.params.workoutExerciseId)
  );
  res.json({
    workout: getWorkoutDetail(req.user.id, Number(req.params.id)),
  });
});

router.put('/:id/exercises/order', (req, res) => {
  res.json({
    workout: reorderWorkoutExercises(
      req.user.id,
      Number(req.params.id),
      req.body?.exerciseIds
    ),
  });
});

router.post('/:id/exercises/:workoutExerciseId/superset', (req, res) => {
  res.json({
    workout: setSuperset(
      req.user.id,
      Number(req.params.id),
      Number(req.params.workoutExerciseId),
      Number(req.body?.otherWorkoutExerciseId)
    ),
  });
});

router.delete('/:id/exercises/:workoutExerciseId/superset', (req, res) => {
  res.json({
    workout: removeFromSuperset(
      req.user.id,
      Number(req.params.id),
      Number(req.params.workoutExerciseId)
    ),
  });
});

router.post('/:id/exercises/:workoutExerciseId/replace', (req, res) => {
  const exercise = resolveExercise(req.user.id, req.body || {});
  res.json({
    workout: replaceWorkoutExercise(
      req.user.id,
      Number(req.params.id),
      Number(req.params.workoutExerciseId),
      exercise.id
    ),
  });
});

router.post('/:id/exercises/:workoutExerciseId/sets', (req, res) => {
  const set = addSet(
    req.user.id,
    Number(req.params.id),
    Number(req.params.workoutExerciseId),
    req.body || {}
  );
  res.status(201).json({
    set: {
      id: set.id,
      number: set.set_number,
      weightKg: set.weight_kg,
      reps: set.reps,
      completed: Boolean(set.completed),
      restSeconds: set.rest_seconds,
    },
  });
});

router.patch('/:id/sets/:setId', (req, res) => {
  const set = updateSet(
    req.user.id,
    Number(req.params.id),
    Number(req.params.setId),
    req.body || {}
  );
  res.json({
    set: {
      id: set.id,
      number: set.set_number,
      weightKg: set.weight_kg,
      reps: set.reps,
      completed: Boolean(set.completed),
      restSeconds: set.rest_seconds,
    },
  });
});

router.delete('/:id/sets/:setId', (req, res) => {
  deleteSet(req.user.id, Number(req.params.id), Number(req.params.setId));
  res.json({ ok: true });
});

export default router;
