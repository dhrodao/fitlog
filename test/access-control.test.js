// Access-control tests: only allowlisted, verified Google accounts may log in,
// and dev login is off unless explicitly enabled.

import test from 'node:test';
import assert from 'node:assert/strict';

// Configure the access policy BEFORE importing config/auth (read at load time).
process.env.NODE_ENV = 'test';
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.ALLOWED_EMAILS = 'owner@example.com, Friend@Example.com';
process.env.ALLOW_ANY_GOOGLE_USER = '';
process.env.SESSION_SECRET = 'test-secret';

const { isGoogleUserAllowed } = await import('../server/auth.js');

test('Google access policy', async (t) => {
  await t.test('an allowlisted verified email is accepted', () => {
    assert.equal(
      isGoogleUserAllowed({ sub: '1', email: 'owner@example.com', email_verified: true }),
      true
    );
  });

  await t.test('the allowlist is case-insensitive', () => {
    assert.equal(
      isGoogleUserAllowed({ sub: '2', email: 'friend@example.com', email_verified: true }),
      true
    );
  });

  await t.test('a non-allowlisted email is rejected', () => {
    assert.equal(
      isGoogleUserAllowed({ sub: '3', email: 'stranger@example.com', email_verified: true }),
      false
    );
  });

  await t.test('an unverified email is rejected even if allowlisted', () => {
    assert.equal(
      isGoogleUserAllowed({ sub: '4', email: 'owner@example.com', email_verified: false }),
      false
    );
  });

  await t.test('email_verified as the string "true" is accepted', () => {
    assert.equal(
      isGoogleUserAllowed({ sub: '5', email: 'owner@example.com', email_verified: 'true' }),
      true
    );
  });

  await t.test('a missing payload is rejected', () => {
    assert.equal(isGoogleUserAllowed(null), false);
  });
});
