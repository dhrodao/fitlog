// Hevy sync hardening: the per-user lock coalesces concurrent syncs, and a
// routine import failure is surfaced as a warning without failing the sync.
//
// These drive syncUser against a fake global fetch (createClient defaults its
// fetchImpl to the global `fetch`, resolved at call time), so no network is
// used. One temp DB for the file via the harness.

import test from 'node:test';
import assert from 'node:assert/strict';

import { setupTestEnv, createTestApp, cleanupTestApp } from './helpers/app.js';
import { loginDev } from './helpers/fixtures.js';

setupTestEnv({
  HEVY_REQUEST_TIMEOUT_MS: '1000',
  HEVY_MAX_RETRIES: '0',
  HEVY_RETRY_BACKOFF_MS: '1',
});
const { app, db } = await createTestApp();
const hevySync = await import('../server/hevy-sync.js');
const { default: request } = await import('supertest');

test.after(() => cleanupTestApp(db));

function jsonResponse(body) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
}

// Routes a Hevy request URL to a canned response. `hooks` can inject delays or
// errors for specific collections.
function makeFakeFetch(hooks = {}) {
  const counts = {};
  const fetchImpl = async (url) => {
    const u = String(url);
    const hit = (name) => (counts[name] = (counts[name] || 0) + 1);

    if (u.includes('/workouts/count')) {
      hit('count');
      return jsonResponse({ workout_count: 0 });
    }
    if (u.includes('/exercise_templates')) {
      hit('templates');
      if (hooks.onTemplates) await hooks.onTemplates();
      return jsonResponse({ exercise_templates: [], page_count: 1 });
    }
    if (u.includes('/workouts/events')) {
      hit('events');
      return jsonResponse({ events: [], page_count: 1 });
    }
    if (u.includes('/workouts')) {
      hit('workouts');
      return jsonResponse({ workouts: [], page_count: 1 });
    }
    if (u.includes('/routine_folders')) {
      hit('routineFolders');
      if (hooks.onRoutineFolders) await hooks.onRoutineFolders();
      return jsonResponse({ routine_folders: [], page_count: 1 });
    }
    if (u.includes('/routines')) {
      hit('routines');
      return jsonResponse({ routines: [], page_count: 1 });
    }
    return jsonResponse({});
  };
  return { fetchImpl, counts };
}

// Swap the global fetch for the duration of a callback.
async function withFakeFetch(fake, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test('concurrent syncs for one user run only once', async () => {
  const agent = request.agent(app);
  const user = await loginDev(agent);

  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  // Hold the first network call (templates) until we fire a second syncUser.
  const { fetchImpl, counts } = makeFakeFetch({ onTemplates: () => gate });

  await withFakeFetch(fetchImpl, async () => {
    await hevySync.connect(user.id, 'fake-key', { autoSync: false });

    const first = hevySync.syncUser(user.id);
    // Second call while the first is still blocked on the gate.
    const second = hevySync.syncUser(user.id);
    // They must be the exact same in-flight promise (coalesced).
    assert.equal(first, second);

    release();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a, b);
    // Templates fetched once -> the body ran a single time.
    assert.equal(counts.templates, 1);
  });

  // After settling, a fresh sync is allowed again.
  assert.equal(hevySync.getSyncStatus(user.id).syncing, false);
});

test('a routine import failure sets a warning, not an error', async () => {
  const agent = request.agent(app);
  const user = await loginDev(agent);

  // Fail only the routine-folders read; workouts still import fine.
  const { fetchImpl } = makeFakeFetch({
    onRoutineFolders: () => {
      throw new Error('routine folders exploded');
    },
  });

  const result = await withFakeFetch(fetchImpl, async () => {
    await hevySync.connect(user.id, 'fake-key', { autoSync: false });
    return hevySync.syncUser(user.id, { full: true });
  });

  assert.equal(result.ok, true);
  assert.ok(result.warning, 'expected a warning on the result');

  const status = hevySync.getSyncStatus(user.id);
  assert.equal(status.lastStatus, 'warning');
  assert.ok(status.lastWarning && status.lastWarning.includes('rutinas'));
  assert.equal(status.lastError, null);
});

test('a successful sync clears a previous warning', async () => {
  const agent = request.agent(app);
  const user = await loginDev(agent);

  // First: fail routines -> warning.
  const failing = makeFakeFetch({
    onRoutineFolders: () => {
      throw new Error('boom');
    },
  });
  await withFakeFetch(failing.fetchImpl, async () => {
    await hevySync.connect(user.id, 'fake-key', { autoSync: false });
    await hevySync.syncUser(user.id, { full: true });
  });
  assert.equal(hevySync.getSyncStatus(user.id).lastStatus, 'warning');

  // Then: a clean sync clears the warning.
  const clean = makeFakeFetch();
  await withFakeFetch(clean.fetchImpl, async () => {
    await hevySync.syncUser(user.id, { full: true });
  });
  const status = hevySync.getSyncStatus(user.id);
  assert.equal(status.lastStatus, 'ok');
  assert.equal(status.lastWarning, null);
});
