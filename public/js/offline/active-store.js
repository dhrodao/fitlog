// Local snapshot of the active workout, kept in IndexedDB.
//
// Scope and intent: this is a RECOVERY snapshot plus the working copy for an
// offline workout. The server stays authoritative for finished workouts. When
// the app opens offline (or /api/workouts/active fails), the active view can
// render the last saved workout from here, and offline edits survive a reload.
//
// Multi-user safety: on a shared device two accounts must never see each
// other's workout. Every record is keyed by userId; load()/clear() are scoped
// by userId; clearAll() wipes everything on logout.

import { STORES, withStore, promisify } from './db.js';

/**
 * Persist the active workout snapshot for a user (or clear it with null).
 * Never throws: a storage failure must not break the workout.
 */
export async function saveActiveWorkout(userId, workout) {
  if (userId == null) return;
  await withStore(STORES.activeWorkout, 'readwrite', (store) => {
    if (workout == null) return promisify(store.delete(userId));
    return promisify(store.put({ userId, workout, savedAt: Date.now() }));
  });
}

/** Load the active workout snapshot for a user, or null if none/unavailable. */
export async function loadActiveWorkout(userId) {
  if (userId == null) return null;
  const record = await withStore(
    STORES.activeWorkout,
    'readonly',
    (store) => promisify(store.get(userId)),
    null
  );
  return record?.workout ?? null;
}

/** Remove the active workout snapshot for a single user (finish/discard). */
export async function clearActiveWorkout(userId) {
  if (userId == null) return;
  await withStore(STORES.activeWorkout, 'readwrite', (store) =>
    promisify(store.delete(userId))
  );
}

/** Wipe all offline data (call on logout, regardless of which user). */
export async function clearAll() {
  await withStore(STORES.activeWorkout, 'readwrite', (store) =>
    promisify(store.clear())
  );
  await withStore(STORES.catalog, 'readwrite', (store) =>
    promisify(store.clear())
  );
}
