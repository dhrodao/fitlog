// Local snapshot of the active workout, kept in IndexedDB.
//
// Scope and intent (step 1 of offline support): this is a RECOVERY snapshot,
// not a source of truth. The server stays authoritative. When the app opens
// offline (or a request to /api/workouts/active fails), the active view can
// render the last known workout from here instead of showing nothing, and set
// edits made offline are not lost across a reload. It deliberately does NOT
// queue writes to the server yet — that outbox is a separate, later step.
//
// Why IndexedDB and not localStorage: localStorage is synchronous, small, and
// string-only; a workout snapshot is structured and can grow. IndexedDB is the
// right primitive and the one the eventual outbox will also use.
//
// Multi-user safety: on a shared device two Google accounts must never see each
// other's workout. Every record is keyed by userId, load()/clear() are scoped
// by userId, and clearAll() wipes everything on logout.

const DB_NAME = 'fitlog-offline';
const DB_VERSION = 1;
const STORE = 'active-workout';

let dbPromise = null;

function hasIndexedDB() {
  return typeof indexedDB !== 'undefined';
}

function openDb() {
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
      if (!db.objectStoreNames.contains(STORE)) {
        // keyPath userId: one snapshot per user, overwritten on each save.
        db.createObjectStore(STORE, { keyPath: 'userId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null); // best-effort: never break the app
  });
  return dbPromise;
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Persist the active workout snapshot for a user. No-op without a userId or
 * IndexedDB. Never throws: a storage failure must not break the workout.
 * @param {number|string} userId
 * @param {object|null} workout The active workout, or null to clear it.
 */
export async function saveActiveWorkout(userId, workout) {
  if (userId == null) return;
  const db = await openDb();
  if (!db) return;
  try {
    if (workout == null) {
      await promisify(tx(db, 'readwrite').delete(userId));
      return;
    }
    await promisify(
      tx(db, 'readwrite').put({ userId, workout, savedAt: Date.now() })
    );
  } catch {
    // ignore: snapshot is best-effort
  }
}

/**
 * Load the active workout snapshot for a user, or null if none/unavailable.
 * @param {number|string} userId
 * @returns {Promise<object|null>}
 */
export async function loadActiveWorkout(userId) {
  if (userId == null) return null;
  const db = await openDb();
  if (!db) return null;
  try {
    const record = await promisify(tx(db, 'readonly').get(userId));
    return record?.workout ?? null;
  } catch {
    return null;
  }
}

/**
 * Remove the active workout snapshot for a single user (finish/discard).
 * @param {number|string} userId
 */
export async function clearActiveWorkout(userId) {
  if (userId == null) return;
  const db = await openDb();
  if (!db) return;
  try {
    await promisify(tx(db, 'readwrite').delete(userId));
  } catch {
    // ignore
  }
}

/** Wipe all offline data (call on logout, regardless of which user). */
export async function clearAll() {
  const db = await openDb();
  if (!db) return;
  try {
    await promisify(tx(db, 'readwrite').clear());
  } catch {
    // ignore
  }
}
