// The structured logger must emit one valid JSON object per line, serialize
// Error fields safely (name/message/code/stack only), and never include a raw
// field the caller did not pass.

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/app.js';

// Logger reads config.nodeEnv at import time; under 'test' only error-level is
// emitted (keeps the suite quiet). Set env before importing it.
setupTestEnv();
const { logger } = await import('../server/logger.js');

/** Capture everything written to a stream during fn(). */
function capture(stream, fn) {
  const lines = [];
  const original = process[stream].write;
  process[stream].write = (chunk) => {
    lines.push(String(chunk));
    return true;
  };
  try {
    fn();
  } finally {
    process[stream].write = original;
  }
  return lines;
}

test('error log is a single valid JSON line with level, time and msg', () => {
  const lines = capture('stderr', () => {
    logger.error('something broke', { route: '/api/x' });
  });
  assert.equal(lines.length, 1);
  assert.ok(lines[0].endsWith('\n'), 'line is terminated');
  const record = JSON.parse(lines[0]);
  assert.equal(record.level, 'error');
  assert.equal(record.msg, 'something broke');
  assert.equal(record.route, '/api/x');
  assert.ok(record.time, 'has a timestamp');
});

test('Error fields are serialized to name/message/stack, not dropped or raw', () => {
  const lines = capture('stderr', () => {
    logger.error('failed', { err: new TypeError('boom') });
  });
  const record = JSON.parse(lines[0]);
  assert.equal(record.err.name, 'TypeError');
  assert.equal(record.err.message, 'boom');
  assert.ok(record.err.stack.includes('TypeError'));
});

test('a log record contains only the fields the caller passed', () => {
  const secret = 'super-secret-token-value';
  const lines = capture('stderr', () => {
    // Caller passes a userId but NOT the token; the token must not appear.
    logger.error('auth event', { userId: 7 });
  });
  const record = JSON.parse(lines[0]);
  assert.equal(record.userId, 7);
  assert.ok(!lines[0].includes(secret), 'unpassed secret never leaks');
});

test('below-threshold levels are suppressed under NODE_ENV=test', () => {
  const out = capture('stdout', () => logger.info('noise'));
  const err = capture('stderr', () => logger.warn('also noise'));
  assert.equal(out.length, 0, 'info is suppressed in tests');
  assert.equal(err.length, 0, 'warn is suppressed in tests');
});
