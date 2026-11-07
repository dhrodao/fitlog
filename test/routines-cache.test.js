// Offline routines cache: refresh the list + each routine's detail while
// online, then read them and materialize a routine into a local workout
// offline. Uses a tiny in-memory IndexedDB (multi-store) so no dependency is
// added.

import test from 'node:test';
import assert from 'node:assert/strict';

function installFakeIndexedDB() {
  const stores = new Map();
  const storeMeta = new Map();

  class Req {
    constructor() { this.onsuccess = null; this.onerror = null; this.onupgradeneeded = null; this.result = undefined; }
    _ok(r) { this.result = r; queueMicrotask(() => this.onsuccess && this.onsuccess()); }
  }
  class Store {
    constructor(name) { this.name = name; this.keyPath = storeMeta.get(name); }
    _m() { if (!stores.has(this.name)) stores.set(this.name, new Map()); return stores.get(this.name); }
    put(rec) { const r = new Req(); this._m().set(rec[this.keyPath], rec); r._ok(); return r; }
    get(k) { const r = new Req(); r._ok(this._m().get(k)); return r; }
    delete(k) { const r = new Req(); this._m().delete(k); r._ok(); return r; }
    clear() { const r = new Req(); this._m().clear(); r._ok(); return r; }
  }
  class DB {
    constructor() { this.objectStoreNames = { contains: (n) => storeMeta.has(n) }; }
    createObjectStore(name, { keyPath }) { storeMeta.set(name, keyPath); stores.set(name, new Map()); return new Store(name); }
    transaction(name) { return { objectStore: () => new Store(name) }; }
  }
  const db = new DB();
  globalThis.indexedDB = {
    open() {
      const r = new Req();
      r.result = db;
      queueMicrotask(() => { if (r.onupgradeneeded) r.onupgradeneeded(); if (r.onsuccess) r.onsuccess(); });
      return r;
    },
  };
  return () => { delete globalThis.indexedDB; };
}

// Fake api.routines: a list plus per-routine details.
function makeApi() {
  const detailCalls = [];
  return {
    detailCalls,
    routines: {
      list: async () => ({
        routines: [
          { id: 1, name: 'Empuje', folder: 'Fuerza', source: null, exerciseCount: 2, preview: 'Press banca, Fondos' },
          { id: 2, name: 'Pierna', folder: null, source: 'hevy', exerciseCount: 1, preview: 'Sentadilla' },
        ],
      }),
      detail: async (id) => {
        detailCalls.push(id);
        if (id === 1) {
          return {
            id: 1,
            name: 'Empuje',
            exercises: [
              { targetSets: 3, targetReps: '8-12', notes: 'Controla la bajada', exercise: { id: 10, name: 'Press banca', category: 'Pecho' } },
              { targetSets: 2, targetReps: '10', notes: null, exercise: { id: 11, name: 'Fondos', category: 'Pecho' } },
            ],
          };
        }
        return {
          id: 2,
          name: 'Pierna',
          exercises: [
            { targetSets: 4, targetReps: '6', notes: null, exercise: { id: 12, name: 'Sentadilla', category: 'Piernas' } },
          ],
        };
      },
    },
  };
}

test('refresh caches the list and each routine detail', async () => {
  const restore = installFakeIndexedDB();
  const cache = await import('../public/js/offline/routines-cache.js?case=refresh');
  const api = makeApi();

  assert.equal(await cache.hasRoutinesCache(1), false, 'empty before refresh');
  await cache.refreshRoutinesCache(api, 1);
  assert.equal(await cache.hasRoutinesCache(1), true);

  const list = await cache.cachedRoutinesLocal(1);
  assert.deepEqual(list.map((r) => r.name), ['Empuje', 'Pierna']);
  assert.equal(list[1].source, 'hevy');
  assert.deepEqual(api.detailCalls.sort(), [1, 2], 'detail fetched for each routine');

  const detail = await cache.cachedRoutineDetailLocal(1, 1);
  assert.equal(detail.name, 'Empuje');
  assert.deepEqual(detail.exercises.map((e) => e.exerciseId), [10, 11]);
  assert.equal(detail.exercises[0].targetSets, 3);

  restore();
});

test('startRoutineLocal materializes a cached routine into a local workout', async () => {
  const restore = installFakeIndexedDB();
  const cache = await import('../public/js/offline/routines-cache.js?case=start');
  const api = makeApi();
  await cache.refreshRoutinesCache(api, 1);

  const workout = await cache.startRoutineLocal(1, 1);
  assert.ok(workout.local, 'is a local workout');
  assert.ok(typeof workout.clientId === 'string' && workout.clientId.length > 0);
  assert.equal(workout.name, 'Empuje');
  assert.equal(workout.exercises.length, 2);

  const [press, dips] = workout.exercises;
  assert.equal(press.exerciseId, 10);
  assert.equal(press.name, 'Press banca');
  assert.equal(press.notes, 'Controla la bajada');
  assert.equal(press.sets.length, 3, 'one empty set per target set');
  assert.equal(press.sets.every((s) => s.completed === false), true);
  assert.equal(dips.sets.length, 2);

  restore();
});

test('startRoutineLocal returns null for a routine that is not cached', async () => {
  const restore = installFakeIndexedDB();
  const cache = await import('../public/js/offline/routines-cache.js?case=missing');
  assert.equal(await cache.startRoutineLocal(1, 999), null);
  restore();
});

test('scoped per user: another user has no cached routines', async () => {
  const restore = installFakeIndexedDB();
  const cache = await import('../public/js/offline/routines-cache.js?case=scope');
  const api = makeApi();
  await cache.refreshRoutinesCache(api, 1);
  assert.equal(await cache.hasRoutinesCache(2), false);
  assert.deepEqual(await cache.cachedRoutinesLocal(2), []);
  restore();
});

test('degrades without IndexedDB', async () => {
  delete globalThis.indexedDB;
  const cache = await import('../public/js/offline/routines-cache.js?case=noidb');
  const api = makeApi();
  await assert.doesNotReject(cache.refreshRoutinesCache(api, 1));
  assert.deepEqual(await cache.cachedRoutinesLocal(1), []);
  assert.equal(await cache.startRoutineLocal(1, 1), null);
});
