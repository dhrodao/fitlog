// Graceful shutdown must: stop accepting new connections, let an in-flight
// request finish, and close the database cleanly. We exercise the same
// primitives index.js uses (server.close + db.close) against a real listener,
// rather than sending a process signal (which would tear down the test runner).

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { setupTestEnv, createTestApp, cleanupTestApp } from './helpers/app.js';

setupTestEnv();
const { app, db } = await createTestApp();

test.after(() => cleanupTestApp(db));

test('in-flight request drains and the server stops accepting new ones', async () => {
  const server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address();

  // Fire a real request, then begin a graceful close while it is in flight.
  // /api/health is a genuine JSON endpoint (the SPA catch-all would otherwise
  // shadow any ad-hoc route and return HTML).
  const inflight = fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.json());
  // Give the connection a moment to be accepted so close() has something to
  // drain rather than racing the TCP handshake.
  await new Promise((r) => setTimeout(r, 30));

  const closed = new Promise((resolve) => server.close(resolve));

  // A connection attempt started AFTER close() should be refused.
  const refused = new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/api/health', agent: false },
      (res) => {
        res.resume();
        resolve('connected');
      }
    );
    req.on('error', () => resolve('refused'));
  });

  const [body, newConn] = await Promise.all([inflight, refused]);
  await closed;

  assert.equal(body.ok, true, 'in-flight request completed with JSON');
  assert.equal(newConn, 'refused', 'new connection rejected after close');
});

test('database closes cleanly after the server is down', () => {
  assert.doesNotThrow(() => db.close());
  // A second close is a no-op in better-sqlite3; the cleanup hook also tolerates
  // it. Querying a closed DB must throw, proving it is really closed.
  assert.throws(() => db.prepare('SELECT 1').get());
});
