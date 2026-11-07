// Shared IndexedDB connection for all offline features. Centralizing open()
// here keeps the schema (object stores + version) in one place, so adding a
// store is a single version bump instead of two modules fighting over the same
// database name.
//
// Every operation is best-effort: if IndexedDB is missing or fails to open we
// resolve to null and callers degrade to no-ops, so offline storage can never
// break the app.

const DB_NAME = 'fitlog-offline';
const DB_VERSION = 2;

export const STORES = {
  activeWorkout: 'active-workout', // keyPath: userId
  catalog: 'catalog', // keyPath: key (e.g. `${userId}:catalog`)
};

let dbPromise = null;

function hasIndexedDB() {
  return typeof indexedDB !== 'undefined';
}

export function openDb() {
  if (!hasIndexedDB()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.activeWorkout)) {
        db.createObjectStore(STORES.activeWorkout, { keyPath: 'userId' });
      }
      if (!db.objectStoreNames.contains(STORES.catalog)) {
        db.createObjectStore(STORES.catalog, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return dbPromise;
}

export function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Run fn with the object store, or return fallback if the DB is unavailable. */
export async function withStore(storeName, mode, fn, fallback = undefined) {
  const db = await openDb();
  if (!db) return fallback;
  try {
    const store = db.transaction(storeName, mode).objectStore(storeName);
    return await fn(store);
  } catch {
    return fallback;
  }
}
