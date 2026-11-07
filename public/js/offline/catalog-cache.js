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
 * Fetch the entire catalog by paging through the server (which caps each
 * response at 100). Returns { exercises: [...] } to match a single response.
 */
async function fetchAllCatalog(api) {
  const pageSize = 100;
  const exercises = [];
  for (let offset = 0; ; offset += pageSize) {
    const res = await api.exercises.search('', '', { limit: pageSize, offset });
    const page = res.exercises || [];
    exercises.push(...page);
    if (page.length < pageSize) break;
  }
  return { exercises };
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
      // Pull the whole catalog for offline use, page by page, since the server
      // caps a single response (limit 100). Without this we would only cache
      // the first page and the offline picker could not see every exercise.
      fetchAllCatalog(api),
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
export async function searchCatalogLocal(userId, query = '', category = '', { limit = 40, offset = 0 } = {}) {
  const all = (await getBlob(keyCatalog(userId))) || [];
  const q = norm(query.trim());
  const filtered = all
    .filter((row) => (category ? row.category === category : true))
    .filter((row) => (q ? norm(row.name).includes(q) : true))
    .sort((a, b) => a.name.localeCompare(b.name));
  return filtered.slice(offset, offset + limit);
}

/** Local equivalent of GET /exercises/categories. */
export async function categoriesLocal(userId) {
  return (await getBlob(keyCategories(userId))) || [];
}

/** Local equivalent of GET /exercises/mine. */
export async function mineLocal(userId, query = '', { limit, offset = 0 } = {}) {
  const all = (await getBlob(keyMine(userId))) || [];
  const q = norm(query.trim());
  const filtered = all
    .filter((row) => (q ? norm(row.name).includes(q) : true))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (limit == null) return filtered;
  return filtered.slice(offset, offset + limit);
}

/** True if there is a usable cached catalog for this user. */
export async function hasCatalogCache(userId) {
  const all = await getBlob(keyCatalog(userId));
  return Array.isArray(all) && all.length > 0;
}
