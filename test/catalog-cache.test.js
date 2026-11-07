// Offline catalog cache: refresh from the server while online, then serve
// search / categories / mine from IndexedDB with the same filtering the server
// does. Uses a tiny in-memory IndexedDB (multi-store) so no dependency is added.

import test from 'node:test';
import assert from 'node:assert/strict';

function installFakeIndexedDB() {
  const stores = new Map(); // name -> Map(key -> record)
  const storeMeta = new Map(); // name -> keyPath

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

// A fake api.exercises returning a small catalog.
const fakeApi = {
  exercises: {
    search: async () => ({
      exercises: [
        { id: 'a', name: 'Sentadilla', category: 'Piernas', imageUrl: '/img/a' },
        { id: 'b', name: 'Press banca', category: 'Pecho', imageUrl: '/img/b' },
        { id: 'c', name: 'Peso muerto', category: 'Piernas', imageUrl: '/img/c' },
      ],
    }),
    categories: async () => ({
      categories: [{ category: 'Piernas', count: 2 }, { category: 'Pecho', count: 1 }],
    }),
    mine: async () => ({
      exercises: [{ id: 1, name: 'Dominadas asistidas', category: 'Espalda', imageUrl: '/img/d' }],
    }),
  },
};

test('refresh then search/categories/mine from the cache (images dropped)', async () => {
  const restore = installFakeIndexedDB();
  const cache = await import('../public/js/offline/catalog-cache.js?case=refresh');

  assert.equal(await cache.hasCatalogCache(1), false, 'empty before refresh');
  await cache.refreshCatalogCache(fakeApi, 1);
  assert.equal(await cache.hasCatalogCache(1), true);

  // Full catalog, name-ordered.
  const all = await cache.searchCatalogLocal(1, '', '');
  assert.deepEqual(all.map((r) => r.name), ['Peso muerto', 'Press banca', 'Sentadilla']);
  assert.ok(!('imageUrl' in all[0]), 'image not cached');

  // Query filter (accent/case-insensitive).
  const press = await cache.searchCatalogLocal(1, 'press', '');
  assert.deepEqual(press.map((r) => r.id), ['b']);

  // Category filter.
  const legs = await cache.searchCatalogLocal(1, '', 'Piernas');
  assert.deepEqual(legs.map((r) => r.id).sort(), ['a', 'c']);

  // Categories and mine.
  assert.equal((await cache.categoriesLocal(1)).length, 2);
  const mine = await cache.mineLocal(1, 'domin');
  assert.deepEqual(mine.map((r) => r.id), [1]);

  restore();
});

test('scoped per user: another user has no cache', async () => {
  const restore = installFakeIndexedDB();
  const cache = await import('../public/js/offline/catalog-cache.js?case=scope');
  await cache.refreshCatalogCache(fakeApi, 1);
  assert.equal(await cache.hasCatalogCache(2), false);
  assert.deepEqual(await cache.searchCatalogLocal(2, '', ''), []);
  restore();
});

test('degrades to empty results without IndexedDB', async () => {
  delete globalThis.indexedDB;
  const cache = await import('../public/js/offline/catalog-cache.js?case=noidb');
  await assert.doesNotReject(cache.refreshCatalogCache(fakeApi, 1));
  assert.deepEqual(await cache.searchCatalogLocal(1, '', ''), []);
  assert.equal(await cache.hasCatalogCache(1), false);
});
