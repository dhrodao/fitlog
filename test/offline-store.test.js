// Offline active-workout snapshot store. The store must:
//   - scope every snapshot by userId (no cross-user leakage on a shared device),
//   - round-trip a workout (save -> load),
//   - clear a single user's snapshot, and clear everything on logout,
//   - degrade gracefully when IndexedDB is unavailable (never throw).
//
// Node has no IndexedDB, so we install a tiny in-memory implementation covering
// exactly the operations the module uses (open/upgrade, objectStore with a
// keyPath, put/get/delete/clear). This keeps the test dependency-free while
// exercising the real scoping and persistence logic.

import test from 'node:test';
import assert from 'node:assert/strict';

function installFakeIndexedDB() {
  const stores = new Map(); // storeName -> Map(key -> record)

  class FakeRequest {
    constructor() {
      this.onsuccess = null;
      this.onerror = null;
      this.onupgradeneeded = null;
      this.result = undefined;
    }
    _succeed(result) {
      this.result = result;
      queueMicrotask(() => this.onsuccess && this.onsuccess());
    }
  }

  class FakeObjectStore {
    constructor(name, keyPath) {
      this.name = name;
      this.keyPath = keyPath;
    }
    _map() {
      if (!stores.has(this.name)) stores.set(this.name, new Map());
      return stores.get(this.name);
    }
    put(record) {
      const req = new FakeRequest();
      this._map().set(record[this.keyPath], record);
      req._succeed(undefined);
      return req;
    }
    get(key) {
      const req = new FakeRequest();
      req._succeed(this._map().get(key));
      return req;
    }
    delete(key) {
      const req = new FakeRequest();
      this._map().delete(key);
      req._succeed(undefined);
      return req;
    }
    clear() {
      const req = new FakeRequest();
      this._map().clear();
      req._succeed(undefined);
      return req;
    }
  }

  const storeMeta = new Map(); // name -> keyPath

  class FakeDB {
    constructor() {
      this.objectStoreNames = {
        contains: (name) => storeMeta.has(name),
      };
    }
    createObjectStore(name, { keyPath }) {
      storeMeta.set(name, keyPath);
      stores.set(name, new Map());
      return new FakeObjectStore(name, keyPath);
    }
    transaction(name) {
      const keyPath = storeMeta.get(name);
      return { objectStore: () => new FakeObjectStore(name, keyPath) };
    }
  }

  const db = new FakeDB();

  globalThis.indexedDB = {
    open() {
      const req = new FakeRequest();
      req.result = db;
      queueMicrotask(() => {
        if (req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
  };
  return () => {
    delete globalThis.indexedDB;
  };
}

test('snapshots are scoped per user and round-trip', async () => {
  const restore = installFakeIndexedDB();
  // Fresh module instance so it opens against the freshly installed fake.
  const store = await import(`../public/js/offline/active-store.js?case=scope`);

  await store.saveActiveWorkout(1, { id: 10, name: 'Push' });
  await store.saveActiveWorkout(2, { id: 20, name: 'Pull' });

  assert.deepEqual(await store.loadActiveWorkout(1), { id: 10, name: 'Push' });
  assert.deepEqual(await store.loadActiveWorkout(2), { id: 20, name: 'Pull' });
  // A user with no snapshot gets null, never another user's data.
  assert.equal(await store.loadActiveWorkout(3), null);

  restore();
});

test('clearActiveWorkout removes only one user; clearAll wipes everything', async () => {
  const restore = installFakeIndexedDB();
  const store = await import(`../public/js/offline/active-store.js?case=clear`);

  await store.saveActiveWorkout(1, { id: 10 });
  await store.saveActiveWorkout(2, { id: 20 });

  await store.clearActiveWorkout(1);
  assert.equal(await store.loadActiveWorkout(1), null);
  assert.deepEqual(await store.loadActiveWorkout(2), { id: 20 });

  await store.clearAll();
  assert.equal(await store.loadActiveWorkout(2), null);

  restore();
});

test('a null workout clears the snapshot', async () => {
  const restore = installFakeIndexedDB();
  const store = await import(`../public/js/offline/active-store.js?case=null`);

  await store.saveActiveWorkout(1, { id: 10 });
  await store.saveActiveWorkout(1, null);
  assert.equal(await store.loadActiveWorkout(1), null);

  restore();
});

test('degrades gracefully without IndexedDB (never throws)', async () => {
  delete globalThis.indexedDB;
  const store = await import(`../public/js/offline/active-store.js?case=noidb`);

  // All operations resolve quietly; load returns null.
  await assert.doesNotReject(store.saveActiveWorkout(1, { id: 10 }));
  assert.equal(await store.loadActiveWorkout(1), null);
  await assert.doesNotReject(store.clearActiveWorkout(1));
  await assert.doesNotReject(store.clearAll());
});

test('no-ops without a userId', async () => {
  const restore = installFakeIndexedDB();
  const store = await import(`../public/js/offline/active-store.js?case=nouser`);

  await store.saveActiveWorkout(null, { id: 10 });
  assert.equal(await store.loadActiveWorkout(null), null);

  restore();
});
