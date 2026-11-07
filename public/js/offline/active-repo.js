// Active-workout repository: the single place that knows whether a mutation
// goes to the server (online) or to the local model (offline). The active view
// talks only to this repo, so it never branches on connectivity itself.
//
// Rules:
//  - A workout is "local" when it was started offline, or when an online write
//    failed because the device went offline (status 0). Once local, it stays
//    local until it is successfully uploaded.
//  - Online mutations delegate to the API exactly as before (no behaviour
//    change when connected). If one fails with a NETWORK error, the repo adopts
//    the workout into the local model and retries the mutation locally, so a
//    connection drop mid-set is transparent.
//  - Every local mutation persists a snapshot so a reload/relaunch recovers it.
//  - Uploading uses POST /api/workouts/sync, which is idempotent by clientId,
//    so a retried upload never duplicates.
//
// Dependencies (api, store, local model, isOnline) are injected for testability.

const isNetworkError = (err) => err && err.status === 0;

export function createActiveWorkoutRepo({
  userId,
  api,
  store,
  model,
  isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine),
}) {
  let workout = null;

  const isLocal = () => Boolean(workout && workout.local);
  const persist = () => {
    if (workout) store.saveActiveWorkout(userId, workout);
  };

  // Turn the current (online) workout into a locally-editable one. Used both
  // when starting offline and when an online write fails due to connectivity.
  const goLocal = () => {
    if (!workout.local) workout = model.adoptWorkout(workout);
    persist();
  };

  // Run an online API mutation; on a network failure, fall back to running the
  // provided local mutation instead and stay local from now on.
  async function onlineOrLocal(apiCall, localCall) {
    if (isLocal() || !isOnline()) {
      goLocal();
      localCall();
      persist();
      return workout;
    }
    try {
      const fresh = await apiCall();
      workout = fresh;
      persist();
      return workout;
    } catch (err) {
      if (isNetworkError(err)) {
        goLocal();
        localCall();
        persist();
        return workout;
      }
      throw err; // 401/404/etc. are real errors the caller must handle
    }
  }

  return {
    get current() {
      return workout;
    },
    isLocal,

    /** Seed the repo with a workout (online detail or a local model). */
    set(w) {
      workout = w;
      return workout;
    },

    /** Start a brand-new workout. Offline → local only; online → POST. */
    async start({ name } = {}) {
      if (!isOnline()) {
        workout = model.createLocalWorkout({ name });
        persist();
        return workout;
      }
      try {
        const { workout: fresh } = await api.workouts.create(
          name ? { name } : {}
        );
        workout = fresh;
        persist();
        return workout;
      } catch (err) {
        if (isNetworkError(err)) {
          workout = model.createLocalWorkout({ name });
          persist();
          return workout;
        }
        throw err;
      }
    },

    async addExercise(exercise) {
      return onlineOrLocal(
        async () => {
          const { workout: fresh } = await api.workouts.addExercise(workout.id, {
            ...(exercise.exerciseId ? { exerciseId: exercise.exerciseId } : {}),
            ...(exercise.catalogId ? { catalogId: exercise.catalogId } : {}),
          });
          return fresh;
        },
        () => model.addExercise(workout, exercise)
      );
    },

    async addSet(exerciseId, values = {}) {
      // Online returns just the set; we keep the view's existing flow by
      // returning the set for the online path and null for local (the view
      // reads workout.exercises in local mode).
      if (isLocal() || !isOnline()) {
        goLocal();
        const set = model.addSet(workout, exerciseId, values);
        persist();
        return { local: true, set };
      }
      try {
        const { set } = await api.workouts.addSet(workout.id, exerciseId, values);
        persist();
        return { local: false, set };
      } catch (err) {
        if (isNetworkError(err)) {
          goLocal();
          const set = model.addSet(workout, exerciseId, values);
          persist();
          return { local: true, set };
        }
        throw err;
      }
    },

    async updateSet(setId, patch) {
      return onlineOrLocal(
        async () => {
          await api.workouts.updateSet(workout.id, setId, patch);
          return workout; // view keeps its own in-memory copy for online
        },
        () => model.updateSet(workout, setId, patch)
      );
    },

    async deleteSet(setId) {
      return onlineOrLocal(
        async () => {
          await api.workouts.removeSet(workout.id, setId);
          return workout;
        },
        () => model.deleteSet(workout, setId)
      );
    },

    async deleteExercise(exerciseId) {
      return onlineOrLocal(
        async () => {
          const { workout: fresh } = await api.workouts.removeExercise(
            workout.id,
            exerciseId
          );
          return fresh;
        },
        () => model.deleteExercise(workout, exerciseId)
      );
    },

    /**
     * Finish the workout. Local workouts are uploaded with /sync (idempotent).
     * Returns { finished } with the server workout when uploaded, or
     * { pending:true } if still offline (the snapshot is kept for later sync).
     */
    async finish(payload = {}) {
      if (isLocal()) {
        if (!isOnline()) {
          // Mark it as finished-offline and persist, so a global syncer can
          // upload it later even after the user leaves the active view.
          workout.finishedOffline = true;
          persist();
          return { pending: true, workout };
        }
        const { workout: finished } = await api.workouts.sync(
          model.toSyncPayload(workout)
        );
        store.clearActiveWorkout(userId);
        return { finished };
      }
      const { workout: finished } = await api.workouts.finish(workout.id, payload);
      store.clearActiveWorkout(userId);
      return { finished };
    },

    /**
     * Try to upload a pending local workout (e.g. on reconnect). Idempotent.
     * Returns the server workout on success, or null if nothing to sync / still
     * offline.
     */
    async syncPending() {
      if (!isLocal() || !isOnline()) return null;
      const { workout: finished } = await api.workouts.sync(
        model.toSyncPayload(workout)
      );
      store.clearActiveWorkout(userId);
      return finished;
    },

    /** Discard the workout: delete on the server if online, always clear local. */
    async discard() {
      if (!isLocal()) {
        try {
          await api.workouts.remove(workout.id);
        } catch (err) {
          if (!isNetworkError(err)) throw err;
        }
      }
      store.clearActiveWorkout(userId);
      workout = null;
    },
  };
}
