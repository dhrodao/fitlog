// Access-control escape hatch: ALLOW_ANY_GOOGLE_USER=true accepts any verified
// Google account (explicit opt-in for a public instance). Separate file because
// config is read once at import time.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.ALLOWED_EMAILS = '';
process.env.ALLOW_ANY_GOOGLE_USER = 'true';
process.env.SESSION_SECRET = 'test-secret';

const { isGoogleUserAllowed } = await import('../server/auth.js');

test('ALLOW_ANY_GOOGLE_USER escape hatch', async (t) => {
  await t.test('any verified account is accepted when opted in', () => {
    assert.equal(
      isGoogleUserAllowed({ sub: '1', email: 'anyone@example.com', email_verified: true }),
      true
    );
  });

  await t.test('an unverified account is still rejected', () => {
    assert.equal(
      isGoogleUserAllowed({ sub: '2', email: 'anyone@example.com', email_verified: false }),
      false
    );
  });
});
