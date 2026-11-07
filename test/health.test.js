// Operational readiness: health endpoint reflects DB state, and the structured
// logger emits valid single-line JSON without leaking caller secrets.

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, createTestApp, cleanupTestApp } from './helpers/app.js';

setupTestEnv();
const { app, db } = await createTestApp();
test.after(() => cleanupTestApp(db));

test('health returns 200 and reports all checks ok on a good DB', async () => {
  const res = await (await import('supertest')).default(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.checks.db.ok, true);
  assert.equal(res.body.checks.schema.ok, true);
  assert.equal(res.body.checks.writable.ok, true);
  // Schema version is reported and matches (applied === expected).
  assert.equal(res.body.schema.applied, res.body.schema.expected);
  assert.ok(res.body.schema.expected >= 1);
});

test('health returns 503 when a database query fails', async () => {
  // Simulate an unavailable database by closing the handle the app shares.
  // checkHealth() must catch the error and report unhealthy, not throw.
  const request = (await import('supertest')).default;
  db.close();
  try {
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 503);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.checks.db.ok, false);
    assert.ok(res.body.checks.db.detail, 'should include an error detail');
  } finally {
    // Reopening is not needed: this is the last DB-touching assertion and the
    // after() hook tolerates an already-closed handle.
  }
});
