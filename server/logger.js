// Minimal structured logger: one JSON object per line on stdout/stderr.
//
// Why: scattered console.log/warn/error strings are hard to grep, filter by
// level, or correlate across a request. A single-line JSON record with a
// level, timestamp and arbitrary fields is enough for a one-person app running
// under Docker (which already captures stdout/stderr) and keeps the door open
// for a log shipper later, without adding a logging dependency.
//
// It intentionally does NOT try to redact secrets magically: callers pass
// explicit fields, so the rule is simply "never put a token/password/cookie in
// a log field". The error serializer only keeps name/message/code/stack.

import config from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

// In tests we keep the output quiet unless something goes wrong; in normal use
// everything from info up is emitted.
const threshold = config.nodeEnv === 'test' ? LEVELS.error : LEVELS.debug;

function serializeError(err) {
  if (!(err instanceof Error)) return err;
  return {
    name: err.name,
    message: err.message,
    code: err.code,
    // Stack is useful for diagnosis; it never contains secrets we set.
    stack: err.stack,
  };
}

function emit(level, msg, fields) {
  if (LEVELS[level] < threshold) return;

  const record = { level, time: new Date().toISOString(), msg };
  if (fields && typeof fields === 'object') {
    for (const [key, value] of Object.entries(fields)) {
      record[key] = value instanceof Error ? serializeError(value) : value;
    }
  }

  const line = JSON.stringify(record);
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const logger = {
  debug: (msg, fields) => emit('debug', msg, fields),
  info: (msg, fields) => emit('info', msg, fields),
  warn: (msg, fields) => emit('warn', msg, fields),
  error: (msg, fields) => emit('error', msg, fields),
};

export default logger;
