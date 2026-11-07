// Offline cache of the user's routines so they can be read, and started, with
// no connectivity. Stored in the shared `catalog` key/value store (no schema
// bump): the routine list under `${userId}:routines` and each routine's detail
// (its exercises) under `${userId}:routine:${id}`.
//
// Only what the training view and the "start routine" flow need is kept:
//   list:   [{ id, name, folder, source, exerciseCount, preview }]
//   detail: { id, name, exercises: [{ exerciseId, name, category, targetSets,
//                                     targetReps, notes }] }
// History, images and server-only metadata are not cached.
//
// Everything is best-effort: without IndexedDB the helpers resolve to null /
// empty and callers degrade gracefully.

import { STORES, withStore, promisify } from './db.js';
import { createLocalWorkout, addExercise, addSet } from './local-workout.js';

const keyList = (userId) => `${userId}:routines`;
const keyDetail = (userId, routineId) => `${userId}:routine:${routineId}`;

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
 * Refresh the routines cache from the server (call while online). Stores the
 * list and the detail of each routine so a routine can be started offline.
 * Best-effort: failures leave the previous cache untouched.
 */
export async function refreshRoutinesCache(api, userId) {
  if (userId == null) return;
  try {
    const { routines = [] } = await api.routines.list();
    const list = routines.map((r) => ({
      id: r.id,
      name: r.name,
      folder: r.folder || null,
      source: r.source || null,
      exerciseCount: r.exerciseCount,
      preview: r.preview || '',
    }));
    await putBlob(keyList(userId), list);

    // Pull each routine's detail so "Empezar Rutina" works offline. Done
    // sequentially to avoid a burst of parallel requests; small N in practice.
    for (const routine of list) {
      try {
        const detail = await api.routines.detail(routine.id);
        await putBlob(keyDetail(userId, routine.id), {
          id: detail.id,
          name: detail.name,
          exercises: (detail.exercises || []).map((item) => ({
            exerciseId: item.exercise?.id ?? item.exerciseId ?? null,
            name: item.exercise?.name ?? item.name ?? 'Ejercicio',
            category: item.exercise?.category ?? null,
            targetSets: item.targetSets ?? null,
            targetReps: item.targetReps ?? null,
            notes: item.notes ?? null,
          })),
        });
      } catch {
        // Skip a routine whose detail could not be fetched; the list entry
        // stays and starting it offline will simply have no exercises cached.
      }
    }
  } catch {
    // ignore: an offline or failed refresh just leaves the previous cache
  }
}

/** Cached routine list for the training view. Returns [] when none. */
export async function cachedRoutinesLocal(userId) {
  return (await getBlob(keyList(userId))) || [];
}

/** Cached detail for a single routine, or null when not cached. */
export async function cachedRoutineDetailLocal(userId, routineId) {
  return await getBlob(keyDetail(userId, routineId));
}

/** True if there is at least one cached routine for this user. */
export async function hasRoutinesCache(userId) {
  const list = await getBlob(keyList(userId));
  return Array.isArray(list) && list.length > 0;
}

/**
 * Materialize a cached routine into a fresh local workout: one exercise per
 * cached routine exercise, with `targetSets` empty (uncompleted) sets so the
 * user can fill them in offline. Returns the local workout, or null if the
 * routine is not cached.
 */
export async function startRoutineLocal(userId, routineId, { name } = {}) {
  const detail = await cachedRoutineDetailLocal(userId, routineId);
  if (!detail) return null;

  const workout = createLocalWorkout({ name: name || detail.name || 'Entreno' });
  for (const item of detail.exercises || []) {
    addExercise(workout, {
      exerciseId: item.exerciseId ?? null,
      name: item.name,
      category: item.category ?? null,
    });
    const exercise = workout.exercises[workout.exercises.length - 1];
    if (item.notes) exercise.notes = item.notes;
    const targetSets = Math.max(1, Math.min(Number(item.targetSets) || 1, 20));
    for (let i = 0; i < targetSets; i += 1) {
      addSet(workout, exercise.id, { completed: false });
    }
  }
  return workout;
}
