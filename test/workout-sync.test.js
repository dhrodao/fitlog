// Offline workout upload (POST /api/workouts/sync).
//
// A workout recorded offline is uploaded whole with a client-generated id. The
// server materializes it exactly once: uploading the same clientId twice (an
// ambiguous timeout or a double tap) must NOT create a second workout, and must
// leave the first one unchanged. Workouts are scoped per user.

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, createTestApp, cleanupTestApp, newAgent } from './helpers/app.js';
import { loginDev, createExercise } from './helpers/fixtures.js';

setupTestEnv();
const { app, db, agent } = await createTestApp();
test.after(() => cleanupTestApp(db));

function countFinishedWorkouts() {
  return db
    .prepare('SELECT COUNT(*) AS n FROM workouts WHERE finished_at IS NOT NULL')
    .get().n;
}

test('offline workout sync', async (t) => {
  await loginDev(agent);
  const exercise = await createExercise(agent, { name: 'Sentadilla', category: 'Piernas' });

  const payload = {
    clientId: 'test-uuid-0001',
    name: 'Entreno offline',
    startedAt: '2026-01-01T10:00:00.000Z',
    finishedAt: '2026-01-01T10:45:00.000Z',
    exercises: [
      {
        exerciseId: exercise.id,
        sets: [
          { weightKg: 100, reps: 5, completed: true },
          { weightKg: 100, reps: 5, completed: true },
        ],
      },
    ],
  };

  await t.test('creates a finished workout with its exercises and sets', async () => {
    const res = await agent.post('/api/workouts/sync').send(payload).expect(201);
    const w = res.body.workout;
    assert.equal(w.name, 'Entreno offline');
    assert.equal(w.active, false);
    assert.ok(w.finishedAt, 'is finished');
    assert.equal(w.exercises.length, 1);
    assert.equal(w.exercises[0].sets.length, 2);
    assert.equal(w.exercises[0].sets[0].weightKg, 100);
    assert.equal(w.summary.sets, 2, 'two completed sets counted');
    assert.equal(countFinishedWorkouts(), 1);
  });

  await t.test('re-uploading the same clientId does not duplicate', async () => {
    const res = await agent.post('/api/workouts/sync').send(payload).expect(201);
    // Same workout returned, still exactly one on the server.
    assert.equal(res.body.workout.exercises[0].sets.length, 2);
    assert.equal(countFinishedWorkouts(), 1, 'no duplicate created on retry');
  });

  await t.test('re-upload is inert even if the payload changed', async () => {
    // A retry must not mutate an already-synced (append-only) workout.
    const mutated = { ...payload, name: 'Nombre cambiado' };
    const res = await agent.post('/api/workouts/sync').send(mutated).expect(201);
    assert.equal(res.body.workout.name, 'Entreno offline', 'original name kept');
    assert.equal(countFinishedWorkouts(), 1);
  });

  await t.test('a different clientId creates a separate workout', async () => {
    const res = await agent
      .post('/api/workouts/sync')
      .send({ ...payload, clientId: 'test-uuid-0002' })
      .expect(201);
    assert.ok(res.body.workout.id);
    assert.equal(countFinishedWorkouts(), 2);
  });

  await t.test('clientId is required', async () => {
    await agent
      .post('/api/workouts/sync')
      .send({ ...payload, clientId: undefined })
      .expect(400);
  });

  await t.test('the same clientId from another user is independent', async () => {
    const other = newAgent(app);
    await loginDev(other); // dev login reuses the single dev user, so use a fresh id scope

    // The dev login maps to one user; to prove per-user scoping we assert the
    // unique index is (user_id, client_id): insert a row for a synthetic second
    // user with the same client_id directly and confirm it is allowed.
    const u2 = db
      .prepare(
        "INSERT INTO users (email, name, is_dev, created_at) VALUES (?, ?, 1, ?)"
      )
      .run('other@example.test', 'Other', new Date().toISOString());
    const userId2 = u2.lastInsertRowid;
    assert.doesNotThrow(() => {
      db.prepare(
        `INSERT INTO workouts (user_id, name, started_at, finished_at, created_at, client_id)
         VALUES (?, 'x', ?, ?, ?, 'test-uuid-0001')`
      ).run(userId2, new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
    }, 'same client_id under a different user must be allowed');
  });
});
