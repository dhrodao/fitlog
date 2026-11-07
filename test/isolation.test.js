// Multi-user isolation and session-lifecycle tests.
//
// These cover the highest-value invariants that previously had no coverage:
// that one user can never read or mutate another user's data, and that logout
// actually invalidates the session. They also exercise the shared test harness.

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, createTestApp, newAgent, cleanupTestApp } from './helpers/app.js';
import {
  loginDev,
  createExercise,
  createRoutine,
  startFreeWorkout,
} from './helpers/fixtures.js';

setupTestEnv();
const { app, db, agent } = await createTestApp();

test('authentication and session lifecycle', async (t) => {
  await t.test('protected routes require a session', async () => {
    await agent.get('/api/auth/me').expect(401);
    await agent.get('/api/workouts').expect(401);
    await agent.get('/api/routines').expect(401);
    await agent.get('/api/measurements').expect(401);
  });

  await t.test('dev login creates a session', async () => {
    const user = await loginDev(agent);
    assert.equal(user.isDev, true);
    const me = await agent.get('/api/auth/me').expect(200);
    assert.equal(me.body.user.id, user.id);
  });

  await t.test('logout invalidates the session immediately', async () => {
    await agent.post('/api/auth/logout').expect(200);
    await agent.get('/api/auth/me').expect(401);
    await agent.get('/api/workouts').expect(401);
  });

  await t.test('an expired session is rejected', async () => {
    // Log in again, then expire the session row directly in the DB.
    await loginDev(agent);
    await agent.get('/api/auth/me').expect(200);
    const past = new Date(Date.now() - 1000).toISOString();
    db.prepare('UPDATE sessions SET expires_at = ?').run(past);
    await agent.get('/api/auth/me').expect(401);
  });
});

test('cross-user isolation', async (t) => {
  const a = agent;
  await loginDev(a);

  // Create resources owned by user A.
  const bench = await createExercise(a, { name: 'Iso bench', category: 'Pecho' });
  const routine = await createRoutine(a, {
    name: 'Iso routine',
    exercises: [{ exerciseId: bench.id, targetSets: 2, targetReps: '5' }],
  });
  const workout = await startFreeWorkout(a, 'Iso workout');

  await t.test('a non-existent id returns 404, never another user data', async () => {
    await a.get('/api/routines/999999').expect(404);
    await a.get('/api/workouts/999999').expect(404);
  });

  await t.test('a second user cannot see user A resources', async () => {
    // Insert a second user directly and mint a session for it, mirroring how
    // the server stores sessions (sha-256 of a random token).
    const crypto = await import('node:crypto');
    const now = new Date().toISOString();
    const info = db
      .prepare(
        'INSERT INTO users (google_sub, email, name, is_dev, created_at) VALUES (?, ?, ?, 0, ?)'
      )
      .run('iso-user-b', 'b@local', 'Usuario B', now);
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

    // User B must NOT see user A's routine or workout.
    await b.get(`/api/routines/${routine.id}`).set('Cookie', cookie).expect(404);
    await b.get(`/api/workouts/${workout.id}`).set('Cookie', cookie).expect(404);

    // And B's own lists are empty of A's data.
    const routines = await b.get('/api/routines').set('Cookie', cookie).expect(200);
    assert.equal(
      routines.body.routines.some((r) => r.id === routine.id),
      false,
      'user B must not see user A routine in the list'
    );
  });
});

test.after(() => cleanupTestApp(db));
