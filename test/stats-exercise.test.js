import test from 'node:test';
import assert from 'node:assert/strict';

import { setupTestEnv, createTestApp, cleanupTestApp, newAgent } from './helpers/app.js';

setupTestEnv();

const { app, db, agent } = await createTestApp();

import {
  loginDev,
  createExercise,
  startFreeWorkout,
  addSet,
  finishWorkout,
} from './helpers/fixtures.js';

test.after(() => cleanupTestApp(db));

// Add an exercise to a free workout and return its workout-exercise entry.
async function addExerciseToWorkout(a, workoutId, exerciseId) {
  const res = await a
    .post(`/api/workouts/${workoutId}/exercises`)
    .send({ exerciseId, targetSets: 0, prefill: false })
    .expect(201);
  const we = res.body.workout.exercises.find((e) => e.exerciseId === exerciseId);
  assert.ok(we, 'workout exercise should be present after adding');
  return we;
}

test('per-exercise stats: per-set e1RM, documented PRs and owner scoping', async (t) => {
  await loginDev(agent);
  const exercise = await createExercise(agent, { name: 'Press militar fixture', category: 'Hombros' });

  // Session 1: a heavy low-rep set and a light high-rep set. The correct e1RM
  // is the per-set Epley max (120x2 -> 128), NOT the cross product
  // (120 * (1 + 15/30) = 180) that the old buggy formula produced.
  const w1 = await startFreeWorkout(agent, 'Sesion 1');
  const we1 = await addExerciseToWorkout(agent, w1.id, exercise.id);
  await addSet(agent, w1.id, we1.id, { weightKg: 120, reps: 2, completed: true });
  await addSet(agent, w1.id, we1.id, { weightKg: 60, reps: 15, completed: true });
  await finishWorkout(agent, w1.id);

  // Session 2: a different, lower-weight session so PRs aggregate across days.
  const w2 = await startFreeWorkout(agent, 'Sesion 2');
  const we2 = await addExerciseToWorkout(agent, w2.id, exercise.id);
  await addSet(agent, w2.id, we2.id, { weightKg: 80, reps: 5, completed: true });
  await addSet(agent, w2.id, we2.id, { weightKg: 70, reps: 8, completed: true });
  await finishWorkout(agent, w2.id);

  const res = await agent.get(`/api/stats/exercise/${exercise.id}`).expect(200);
  const body = res.body;

  await t.test('history carries a per-set e1RM, not the cross product', () => {
    assert.equal(body.history.length, 2);
    const s1 = body.history[0];
    // 120 * (1 + 2/30) = 128.0; rounded to 1 decimal.
    assert.ok(Math.abs(s1.e1rm - 128) < 0.1, `expected ~128, got ${s1.e1rm}`);
    assert.ok(s1.e1rm < 180, 'must not be the cross-product overstatement');
    // Session 2 best set: 80x5 -> 80 * (1 + 5/30) = 93.3.
    const s2 = body.history[1];
    assert.ok(Math.abs(s2.e1rm - 93.3) < 0.1, `expected ~93.3, got ${s2.e1rm}`);
    // History rows keep the backward-compatible fields.
    assert.equal(s1.maxWeight, 120);
    assert.equal(s1.maxReps, 15);
    assert.equal(s1.volume, 120 * 2 + 60 * 15);
    assert.equal(s1.reps, 2 + 15);
  });

  await t.test('prs block has the documented records', () => {
    assert.ok(body.prs, 'prs block present');
    // Heaviest single set across all sessions.
    assert.equal(body.prs.maxWeight, 120);
    // Best per-set Epley across all sessions (120x2 -> 128.0).
    assert.ok(Math.abs(body.prs.bestE1rm - 128) < 0.1, `expected ~128, got ${body.prs.bestE1rm}`);
    // Most reps on any completed set.
    assert.equal(body.prs.maxReps, 15);
    // Highest single-session volume: session 1 = 240 + 900 = 1140.
    assert.equal(body.prs.maxVolume, 1140);
  });

  await t.test('top-level fields stay backward-compatible', () => {
    assert.equal(body.exercise.id, exercise.id);
    assert.equal(body.bestWeight, 120);
    // estimated1rm is the corrected PR value.
    assert.ok(Math.abs(body.estimated1rm - 128) < 0.1, `expected ~128, got ${body.estimated1rm}`);
    assert.equal(body.estimated1rm, body.prs.bestE1rm);
  });

  await t.test('another user cannot read this exercise (owner scoping)', async () => {
    // Insert a second, genuinely distinct user and mint a session for it,
    // mirroring how the server stores sessions (sha-256 of a random token).
    const crypto = await import('node:crypto');
    const now = new Date().toISOString();
    const info = db
      .prepare(
        'INSERT INTO users (google_sub, email, name, is_dev, created_at) VALUES (?, ?, ?, 0, ?)'
      )
      .run('stats-owner-b', 'owner-b@local', 'Usuario B', now);
    const userBId = info.lastInsertRowid;

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + 3600_000).toISOString();
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run(tokenHash, userBId, now, expires);

    const b = newAgent(app);
    const cookie = `fit_session=${token}`;
    const me = await b.get('/api/auth/me').set('Cookie', cookie).expect(200);
    assert.equal(me.body.user.id, Number(userBId), 'agent B is user B');

    // User B must NOT reach user A's exercise stats: owner scoping -> 404.
    await b.get(`/api/stats/exercise/${exercise.id}`).set('Cookie', cookie).expect(404);
  });
});
