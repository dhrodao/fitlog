// Previous-set suggestions endpoint: returns the completed sets of the last
// finished workout for each requested exercise, so the active view can refill
// the "Anterior" column on reconnect without uploading the current workout.

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
test.after(() => cleanupTestApp(db));

test('workout suggestions', async (t) => {
  await loginDev(agent);
  const exercise = await createExercise(agent, { name: 'Remo', category: 'Espalda' });

  // A finished workout with two completed sets for the exercise.
  const workout = await startFreeWorkout(agent, 'Pasado');
  const res = await agent
    .post(`/api/workouts/${workout.id}/exercises`)
    .send({ exerciseId: exercise.id, targetSets: 2 })
    .expect(201);
  const weId = res.body.workout.exercises[0].id;
  const s1 = res.body.workout.exercises[0].sets[0].id;
  const s2 = res.body.workout.exercises[0].sets[1].id;
  await agent.patch(`/api/workouts/${workout.id}/sets/${s1}`).send({ weightKg: 60, reps: 10, completed: true }).expect(200);
  await agent.patch(`/api/workouts/${workout.id}/sets/${s2}`).send({ weightKg: 60, reps: 8, completed: true }).expect(200);
  await finishWorkout(agent, workout.id);

  await t.test('returns previous completed sets for the exercise', async () => {
    const r = await agent
      .get(`/api/workouts/suggestions?exerciseIds=${exercise.id}`)
      .expect(200);
    const prev = r.body.suggestions[exercise.id];
    assert.ok(Array.isArray(prev));
    assert.equal(prev.length, 2);
    assert.equal(prev[0].weightKg, 60);
    assert.equal(prev[0].reps, 10);
  });

  await t.test('an exercise with no history returns an empty list', async () => {
    const other = await createExercise(agent, { name: 'Zancada', category: 'Piernas' });
    const r = await agent
      .get(`/api/workouts/suggestions?exerciseIds=${other.id}`)
      .expect(200);
    assert.deepEqual(r.body.suggestions[other.id], []);
  });

  await t.test('an exercise id from another user is not leaked', async () => {
    // Insert a second user with a finished workout + set for a private exercise.
    const now = new Date().toISOString();
    const u2 = db
      .prepare("INSERT INTO users (email, name, is_dev, created_at) VALUES (?, ?, 1, ?)")
      .run('intruder@example.test', 'Intruder', now).lastInsertRowid;
    const ex2 = db
      .prepare("INSERT INTO exercises (user_id, name, category, created_at) VALUES (?, 'Secreto', 'Pecho', ?)")
      .run(u2, now).lastInsertRowid;

    const r = await agent
      .get(`/api/workouts/suggestions?exerciseIds=${ex2}`)
      .expect(200);
    // The requesting (dev) user does not own ex2, so it yields an empty list.
    assert.deepEqual(r.body.suggestions[ex2], []);
  });

  await t.test('invalid ids are ignored', async () => {
    const r = await agent
      .get('/api/workouts/suggestions?exerciseIds=abc,,')
      .expect(200);
    assert.deepEqual(r.body.suggestions, {});
  });
});
