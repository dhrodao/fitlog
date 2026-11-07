// Global sync for a workout that was finished while offline.
//
// When the user presses "Terminar" with no connectivity, the active view can't
// upload the workout, so it is kept in the local snapshot marked
// finishedOffline. The user then leaves the active view, so the upload can no
// longer be driven from there. This module runs at the app level (on boot and
// on the 'online' event) and uploads any finished-offline workout with the
// idempotent /sync endpoint, so it is never lost and never duplicated.
//
// An in-progress local workout (finishedOffline not set) is left untouched:
// uploading it would finish it prematurely.

import { loadActiveWorkout, clearActiveWorkout } from './active-store.js';
import { toSyncPayload } from './local-workout.js';

/**
 * Upload a finished-offline workout for this user if one is pending.
 * @returns {Promise<object|null>} the server workout, or null if nothing to do.
 */
export async function syncFinishedOffline(userId, api) {
  if (userId == null) return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;

  const workout = await loadActiveWorkout(userId);
  if (!workout || !workout.local || !workout.finishedOffline) return null;

  const { workout: finished } = await api.workouts.sync(toSyncPayload(workout));
  await clearActiveWorkout(userId);
  return finished;
}
