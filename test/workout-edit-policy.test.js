// Editing policy for finished workouts.
//
// A finished (manual) workout stays fully editable: name, notes and sets can be
// changed and the changes persist. Workouts imported from Hevy are read-only
// for their content (a later Hevy sync would overwrite local edits), but they
// can still be deleted.

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, createTestApp, cleanupTestApp } from './helpers/app.js';
import {
  loginDev,
  createExercise,
  startFreeWorkout,
  addSet,
  finishWorkout,
} from './helpers/fixtures.js';

setupTestEnv();
const { app, db, agent } = await createTestApp();

// Build a finished workout with one exercise and one set. Returns handy ids.
async function seedFinishedWorkout(name = 'Entreno manual') {
  const workout = await startFreeWorkout(agent, name);
  const exercise = await createExercise(agent, {
    name: `Ejercicio ${Math.random().toString(16).slice(2, 8)}`,
    category: 'Pecho',
  });
  const res = await agent
    .post(`/api/workouts/${workout.id}/exercises`)
    .send({ exerciseId: exercise.id, targetSets: 1 })
    .expect(201);
  const workoutExerciseId = res.body.workout.exercises[0].id;
  const set = await addSet(agent, workout.id, workoutExerciseId, {
    weightKg: 50,
    reps: 10,
    completed: true,
  });
  await finishWorkout(agent, workout.id);
  return { workoutId: workout.id, workoutExerciseId, setId: set.id };
}

// Mark an existing workout as imported from Hevy via the db handle.
function markAsHevy(workoutId) {
  db.prepare("UPDATE workouts SET source = 'hevy' WHERE id = ?").run(workoutId);
}

test('workout edit policy', async (t) => {
  await loginDev(agent);

  await t.test('a manual finished workout can edit name, notes and sets', async () => {
    const { workoutId, setId } = await seedFinishedWorkout('Original');

    await agent
      .patch(`/api/workouts/${workoutId}`)
      .send({ name: 'Editado', notes: 'Buenas sensaciones' })
      .expect(200);

    await agent
      .patch(`/api/workouts/${workoutId}/sets/${setId}`)
      .send({ weightKg: 70, reps: 8 })
      .expect(200);

    // Reload and assert the edits persisted.
    const res = await agent.get(`/api/workouts/${workoutId}`).expect(200);
    assert.equal(res.body.workout.name, 'Editado');
    assert.equal(res.body.workout.notes, 'Buenas sensaciones');
    const set = res.body.workout.exercises[0].sets.find((s) => s.id === setId);
    assert.equal(set.weightKg, 70);
    assert.equal(set.reps, 8);
  });

  await t.test('editing a Hevy workout name/notes is blocked with 403', async () => {
    const { workoutId } = await seedFinishedWorkout('De Hevy');
    markAsHevy(workoutId);

    await agent
      .patch(`/api/workouts/${workoutId}`)
      .send({ name: 'Intento de edicion' })
      .expect(403);
  });

  await t.test('editing a set of a Hevy workout is blocked with 403', async () => {
    const { workoutId, setId } = await seedFinishedWorkout('De Hevy con serie');
    markAsHevy(workoutId);

    await agent
      .patch(`/api/workouts/${workoutId}/sets/${setId}`)
      .send({ weightKg: 99 })
      .expect(403);
  });

  await t.test('adding a set to a Hevy workout is blocked with 403', async () => {
    const { workoutId, workoutExerciseId } = await seedFinishedWorkout('De Hevy add');
    markAsHevy(workoutId);

    await agent
      .post(`/api/workouts/${workoutId}/exercises/${workoutExerciseId}/sets`)
      .send({ weightKg: 40, reps: 5 })
      .expect(403);
  });

  await t.test('a Hevy workout can still be deleted', async () => {
    const { workoutId } = await seedFinishedWorkout('De Hevy borrable');
    markAsHevy(workoutId);

    await agent.delete(`/api/workouts/${workoutId}`).expect(200);
    await agent.get(`/api/workouts/${workoutId}`).expect(404);
  });
});

test.after(() => cleanupTestApp(db));
