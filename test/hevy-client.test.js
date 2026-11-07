// Hevy client hardening tests: timeout, retry with backoff, and the rule that
// auth/client errors (4xx) are never retried. These use a fake fetch, so they
// run without any network or database.

import test from 'node:test';
import assert from 'node:assert/strict';

import { HevyClient, HevyApiError } from '../server/hevy-client.js';

// A fake Response good enough for the client (ok/status/text()).
function fakeResponse(status, body = '{}') {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

// Build a client with near-zero backoff so retries do not slow the test.
function client(fetchImpl, overrides = {}) {
  return new HevyClient('test-key', {
    fetchImpl,
    timeoutMs: 50,
    maxRetries: 3,
    backoffMs: 1,
    ...overrides,
  });
}

test('request retries a 429 then succeeds', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return fakeResponse(429, 'rate limited');
    return fakeResponse(200, JSON.stringify({ workout_count: 7 }));
  };
  const data = await client(fetchImpl).request('/workouts/count');
  assert.equal(calls, 2);
  assert.equal(data.workout_count, 7);
});

test('request retries 5xx up to the cap then throws', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return fakeResponse(503, 'unavailable');
  };
  await assert.rejects(
    () => client(fetchImpl).request('/workouts/count'),
    (err) => err instanceof HevyApiError && err.status === 503
  );
  // 1 initial attempt + 3 retries.
  assert.equal(calls, 4);
});

test('request does NOT retry a 401 (auth error)', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return fakeResponse(401, 'unauthorized');
  };
  await assert.rejects(
    () => client(fetchImpl).request('/workouts/count'),
    (err) => err instanceof HevyApiError && err.status === 401
  );
  assert.equal(calls, 1);
});

test('request does NOT retry a 404', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return fakeResponse(404, 'not found');
  };
  await assert.rejects(() => client(fetchImpl).request('/webhook-subscription'));
  assert.equal(calls, 1);
});

test('request aborts on timeout and reports a timeout error', async () => {
  // A fetch that never resolves until aborted: reject when the signal fires.
  const fetchImpl = (url, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const e = new Error('aborted');
        e.name = 'TimeoutError';
        reject(e);
      });
    });
  // No retries so the test asserts the timeout directly.
  await assert.rejects(
    () => client(fetchImpl, { maxRetries: 0 }).request('/workouts/count'),
    (err) => err.name === 'HevyTimeoutError'
  );
});

test('request retries a network/timeout failure then succeeds', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error('socket hang up'); // network error -> retriable
    }
    return fakeResponse(200, JSON.stringify({ ok: true }));
  };
  const data = await client(fetchImpl).request('/workouts/count');
  assert.equal(calls, 2);
  assert.equal(data.ok, true);
});

test('writes (send) are not retried on 5xx', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return fakeResponse(500, 'boom');
  };
  await assert.rejects(() =>
    client(fetchImpl).send('/webhook-subscription', 'POST', { url: 'x' })
  );
  assert.equal(calls, 1);
});
