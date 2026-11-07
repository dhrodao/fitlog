// Offline cache of the exercise catalog so a workout can be built from scratch
// with no connectivity. Images are intentionally NOT cached (they stream from
// the server/CDN on demand); offline, exercises show the placeholder thumbnail.
// Caching ~900 small JSON rows is cheap; caching images would not be.
//
// Shape stored per user (keyed `${userId}:catalog` / `:mine` / `:categories`):
//   catalog:    [{ id, name, category }]        (shared free-exercise-db rows)
//   mine:       [{ id, name, category }]         (the user's own exercises)
//   categories: [{ category, count }]
//
// The local query helpers replicate the server's filtering (name LIKE, optional
// category, name order) so the picker behaves the same offline.

import { STORES, withStore, promisify } from './db.js';

const keyCatalog = (userId) => `${userId}:catalog`;
const keyMine = (userId) => `${userId}:mine`;
const keyCategories = (userId) => `${userId}:categories`;

async function putBlob(key, items) {
  await withStore(STORES.catalog, 'readwrite', (store) =>
    promisify(store.put({ key, items, savedAt: Date.now() }))
  );
}

async function getBlob(key) {
  const record = await withStore(
    STORES.catalog,
    'readonly',
    (store) => promisify(store.get(key)),
    null
  );
  return record?.items ?? null;
}

/**
 * Refresh the cache from the server (call while online). Pulls the full catalog
 * (empty query, high limit), the categories and the user's own exercises, and
 * stores only id/name/category. Best-effort: failures are swallowed.
 */
export async function refreshCatalogCache(api, userId) {
  if (userId == null) return;
  try {
    const [catalogRes, categoriesRes, mineRes] = await Promise.all([
      api.exercises.search('', ''),
      api.exercises.categories(),
      api.exercises.mine(''),
    ]);
    const slim = (row) => ({ id: row.id, name: row.name, category: row.category });
    await putBlob(keyCatalog(userId), (catalogRes.exercises || []).map(slim));
    await putBlob(keyCategories(userId), categoriesRes.categories || []);
    await putBlob(keyMine(userId), (mineRes.exercises || []).map(slim));
  } catch {
    // ignore: an offline or failed refresh just leaves the previous cache
  }
}

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** Local equivalent of GET /exercises/search. Returns [{id,name,category}]. */
export async function searchCatalogLocal(userId, query = '', category = '') {
  const all = (await getBlob(keyCatalog(userId))) || [];
  const q = norm(query.trim());
  return all
    .filter((row) => (category ? row.category === category : true))
    .filter((row) => (q ? norm(row.name).includes(q) : true))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 100);
}

/** Local equivalent of GET /exercises/categories. */
export async function categoriesLocal(userId) {
  return (await getBlob(keyCategories(userId))) || [];
}

/** Local equivalent of GET /exercises/mine. */
export async function mineLocal(userId, query = '') {
  const all = (await getBlob(keyMine(userId))) || [];
  const q = norm(query.trim());
  return all
    .filter((row) => (q ? norm(row.name).includes(q) : true))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** True if there is a usable cached catalog for this user. */
export async function hasCatalogCache(userId) {
  const all = await getBlob(keyCatalog(userId));
  return Array.isArray(all) && all.length > 0;
}
