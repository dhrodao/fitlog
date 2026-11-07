// Global syncer: uploads a workout finished while offline on the next launch /
// reconnect, idempotently, and leaves an in-progress local workout untouched.

import test from 'node:test';
import assert from 'node:assert/strict';

function installFakeIndexedDB() {
  const stores = new Map();
  const meta = new Map();
  class Req { constructor() { this.result = undefined; } _ok(r) { this.result = r; queueMicrotask(() => this.onsuccess && this.onsuccess()); } }
  class Store {
    constructor(n) { this.name = n; this.keyPath = meta.get(n); }
    _m() { if (!stores.has(this.name)) stores.set(this.name, new Map()); return stores.get(this.name); }
    put(r) { const q = new Req(); this._m().set(r[this.keyPath], r); q._ok(); return q; }
    get(k) { const q = new Req(); q._ok(this._m().get(k)); return q; }
    delete(k) { const q = new Req(); this._m().delete(k); q._ok(); return q; }
    clear() { const q = new Req(); this._m().clear(); q._ok(); return q; }
  }
  class DB {
    constructor() { this.objectStoreNames = { contains: (n) => meta.has(n) }; }
    createObjectStore(n, { keyPath }) { meta.set(n, keyPath); stores.set(n, new Map()); return new Store(n); }
    transaction(n) { return { objectStore: () => new Store(n) }; }
  }
  const db = new DB();
  globalThis.indexedDB = {
    open() { const q = new Req(); q.result = db; queueMicrotask(() => { if (q.onupgradeneeded) q.onupgradeneeded(); if (q.onsuccess) q.onsuccess(); }); return q; },
  };
  return () => { delete globalThis.indexedDB; };
}

function fakeApi() {
  const calls = { sync: 0 };
  return {
    calls,
    workouts: {
      sync: async () => { calls.sync += 1; return { workout: { id: 500, exercises: [] } }; },
    },
  };
}

test('uploads a finished-offline workout, then clears it', async () => {
  const restore = installFakeIndexedDB();
  const store = await import('../public/js/offline/active-store.js?case=sync1');
  const syncer = await import('../public/js/offline/sync.js?case=sync1');
  const api = fakeApi();

  await store.saveActiveWorkout(1, {
    local: true,
    finishedOffline: true,
    clientId: 'c-1',
    name: 'Offline',
    startedAt: 't',
    exercises: [{ id: 'local-e-1', exerciseId: 7, name: 'X', sets: [] }],
  });

  const finished = await syncer.syncFinishedOffline(1, api);
  assert.equal(finished.id, 500);
  assert.equal(api.calls.sync, 1);
  // Cleared afterwards, so a second run is a no-op.
  assert.equal(await syncer.syncFinishedOffline(1, api), null);
  assert.equal(api.calls.sync, 1);

  restore();
});

test('does NOT upload an in-progress local workout', async () => {
  const restore = installFakeIndexedDB();
  const store = await import('../public/js/offline/active-store.js?case=sync2');
  const syncer = await import('../public/js/offline/sync.js?case=sync2');
  const api = fakeApi();

  await store.saveActiveWorkout(1, {
    local: true, // finishedOffline NOT set — still training
    clientId: 'c-2',
    name: 'En curso',
    startedAt: 't',
    exercises: [],
  });

  assert.equal(await syncer.syncFinishedOffline(1, api), null);
  assert.equal(api.calls.sync, 0, 'in-progress workout must not be uploaded');

  restore();
});

test('no-op when there is nothing stored', async () => {
  const restore = installFakeIndexedDB();
  const syncer = await import('../public/js/offline/sync.js?case=sync3');
  const api = fakeApi();
  assert.equal(await syncer.syncFinishedOffline(1, api), null);
  assert.equal(api.calls.sync, 0);
  restore();
});
