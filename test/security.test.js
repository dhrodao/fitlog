// Security hardening tests: rate limiting, origin checks, production cookie
// enforcement, and dev-login opt-in. The rate-limit and origin-check units are
// exercised against minimal Express apps (no DB). Config enforcement is checked
// in a child process so env is read fresh at import.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import express from 'express';
import request from 'supertest';

import { rateLimit } from '../server/rate-limit.js';
import { originCheck } from '../server/origin-check.js';

test('rateLimit returns 429 after the max is exceeded', async () => {
  const app = express();
  app.use(rateLimit({ windowMs: 60_000, max: 2, message: 'slow down' }));
  app.get('/x', (_req, res) => res.json({ ok: true }));

  const agent = request(app);
  await agent.get('/x').expect(200);
  await agent.get('/x').expect(200);
  const blocked = await agent.get('/x').expect(429);
  assert.equal(blocked.body.error, 'slow down');
  assert.ok(blocked.headers['retry-after']);
  assert.equal(blocked.headers['x-ratelimit-limit'], '2');
});

test('originCheck rejects a cross-site mutation but allows same-origin', async () => {
  const app = express();
  app.use(originCheck('https://fit.example.com'));
  app.post('/x', (_req, res) => res.json({ ok: true }));
  app.get('/x', (_req, res) => res.json({ ok: true }));
  const agent = request(app);

  // GET is never checked.
  await agent.get('/x').expect(200);
  // Same-origin POST via Origin header.
  await agent.post('/x').set('Origin', 'https://fit.example.com').expect(200);
  // Cross-site POST via Origin header.
  await agent.post('/x').set('Origin', 'https://evil.example.com').expect(403);
  // Sec-Fetch-Site cross-site is rejected even with no Origin.
  await agent.post('/x').set('Sec-Fetch-Site', 'cross-site').expect(403);
  // Sec-Fetch-Site same-origin is allowed.
  await agent.post('/x').set('Sec-Fetch-Site', 'same-origin').expect(200);
  // No Origin and no Sec-Fetch-Site (non-browser client) is allowed.
  await agent.post('/x').expect(200);
});

test('originCheck is a no-op when no public URL is configured', async () => {
  const app = express();
  app.use(originCheck(''));
  app.post('/x', (_req, res) => res.json({ ok: true }));
  await request(app)
    .post('/x')
    .set('Origin', 'https://evil.example.com')
    .expect(200);
});

test('production forces Secure cookies even if COOKIE_SECURE=false', () => {
  const script =
    "import('./server/config.js').then(m => " +
    "{ process.stdout.write(String(m.default.cookieSecure)); });";
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      COOKIE_SECURE: 'false',
      SESSION_SECRET: 'strong-secret-for-this-test-only',
      GOOGLE_CLIENT_ID: '',
    },
    encoding: 'utf8',
  });
  assert.equal(out.trim(), 'true');
});

test('dev login is disabled unless ALLOW_DEV_LOGIN=true', async () => {
  // Build an app WITHOUT ALLOW_DEV_LOGIN. The harness normally sets it, so set
  // the env explicitly here before importing the app for this file's process.
  const { setupTestEnv, createTestApp, cleanupTestApp } = await import(
    './helpers/app.js'
  );
  setupTestEnv({ ALLOW_DEV_LOGIN: 'false' });
  const { app, db } = await createTestApp();
  try {
    await request(app).post('/api/auth/dev').expect(404);
    const cfg = await request(app).get('/api/auth/config').expect(200);
    assert.equal(cfg.body.devLoginEnabled, false);
  } finally {
    cleanupTestApp(db);
  }
});
