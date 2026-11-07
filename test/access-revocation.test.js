// Access revocation: a Google user with a valid session loses access on every
// endpoint the moment their email leaves the allowlist, not only at login.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { setupTestEnv, createTestApp, newAgent, cleanupTestApp } from './helpers/app.js';

setupTestEnv({ ALLOWED_EMAILS: 'member@example.com', ALLOW_ANY_GOOGLE_USER: 'false' });
const { app, db } = await createTestApp();
const config = (await import('../server/config.js')).default;

test.after(() => cleanupTestApp(db));

// Insert a Google (non-dev) user and mint a valid session cookie for it.
function seedGoogleUser(email) {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      'INSERT INTO users (google_sub, email, name, is_dev, created_at) VALUES (?, ?, ?, 0, ?)'
    )
    .run(`sub-${email}`, email, 'Member', now);
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expires = new Date(Date.now() + 3600_000).toISOString();
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(tokenHash, info.lastInsertRowid, now, expires);
  return { userId: Number(info.lastInsertRowid), cookie: `fit_session=${token}`, tokenHash };
}

test('removing a user from the allowlist revokes an active session', async () => {
  const { cookie, tokenHash } = seedGoogleUser('member@example.com');
  const agent = newAgent(app);

  // While allowed, the session works.
  await agent.get('/api/auth/me').set('Cookie', cookie).expect(200);
  await agent.get('/api/workouts').set('Cookie', cookie).expect(200);

  // Revoke access by editing the live policy (config is read at request time).
  const original = config.allowedEmails.slice();
  config.allowedEmails = [];
  try {
    // Now every protected endpoint rejects the still-present cookie with 403.
    const res = await agent.get('/api/workouts').set('Cookie', cookie).expect(403);
    assert.match(res.body.error, /acceso/i);

    // The session row was destroyed, so even re-allowing does not resurrect it.
    const stillThere = db
      .prepare('SELECT 1 FROM sessions WHERE token_hash = ?')
      .get(tokenHash);
    assert.equal(stillThere, undefined, 'session must be destroyed on revocation');
  } finally {
    config.allowedEmails = original;
  }
});

test('a dev user is unaffected by the Google allowlist', async () => {
  // Dev login is governed by ALLOW_DEV_LOGIN (true in the harness), not emails.
  const agent = newAgent(app);
  const login = await agent.post('/api/auth/dev').expect(200);
  assert.equal(login.body.user.isDev, true);

  const original = config.allowedEmails.slice();
  config.allowedEmails = ['someone-else@example.com'];
  try {
    await agent.get('/api/auth/me').expect(200);
    await agent.get('/api/workouts').expect(200);
  } finally {
    config.allowedEmails = original;
  }
});
