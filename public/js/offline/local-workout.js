// Pure data model for a workout being recorded locally (offline).
//
// It mirrors the shape the active view already renders (a workout with
// exercises, each with sets), but every id is LOCAL and client-generated. These
// ids never travel to the server: when the workout is uploaded, toSyncPayload()
// collapses the model into the flat { clientId, exercises:[{ sets }] } shape
// that POST /api/workouts/sync materializes under the clientId. Online ids are
// opaque to this model, so an online workout can be adopted and kept editable
// after connectivity drops.
//
// The model is storage-agnostic (no IndexedDB here) so it is trivial to unit
// test; persistence is handled by the offline store.

function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID: good enough for a
  // client-side idempotency key (not a security token).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let localSeq = 0;
// Local ids are strings prefixed so they can never be mistaken for a numeric
// server id by code that does `Number(id)`.
function localId(prefix) {
  localSeq += 1;
  return `local-${prefix}-${Date.now()}-${localSeq}`;
}

/** Create a brand-new local workout (started with no connectivity). */
export function createLocalWorkout({ name = 'Entreno' } = {}) {
  const now = new Date().toISOString();
  return {
    local: true,
    clientId: uuid(),
    id: localId('w'),
    name,
    startedAt: now,
    exercises: [],
  };
}

/**
 * Wrap an existing (online) workout detail so it can keep being edited locally
 * after connectivity drops. A clientId is attached if missing; it is the
 * idempotency key used to upload the workout later.
 */
export function adoptWorkout(workout) {
  return {
    ...workout,
    local: true,
    clientId: workout.clientId || uuid(),
  };
}

export function addExercise(workout, exercise) {
  workout.exercises.push({
    id: localId('e'),
    exerciseId: exercise.exerciseId ?? null,
    catalogId: exercise.catalogId ?? null,
    name: exercise.name,
    category: exercise.category ?? null,
    imageUrl: exercise.imageUrl ?? null,
    supersetGroup: null,
    notes: null,
    sets: [],
    // No history available offline.
    previousSets: [],
  });
  return workout;
}

export function findExercise(workout, exerciseLocalId) {
  return workout.exercises.find((e) => e.id === exerciseLocalId) || null;
}

export function addSet(workout, exerciseLocalId, values = {}) {
  const exercise = findExercise(workout, exerciseLocalId);
  if (!exercise) return null;
  const set = {
    id: localId('s'),
    weightKg: values.weightKg ?? null,
    reps: values.reps ?? null,
    completed: Boolean(values.completed),
    restSeconds: values.restSeconds ?? null,
  };
  exercise.sets.push(set);
  return set;
}

export function updateSet(workout, setLocalId, patch = {}) {
  for (const exercise of workout.exercises) {
    const set = exercise.sets.find((s) => s.id === setLocalId);
    if (set) {
      if ('weightKg' in patch) set.weightKg = patch.weightKg;
      if ('reps' in patch) set.reps = patch.reps;
      if ('completed' in patch) set.completed = Boolean(patch.completed);
      if ('restSeconds' in patch) set.restSeconds = patch.restSeconds;
      return set;
    }
  }
  return null;
}

export function deleteSet(workout, setLocalId) {
  for (const exercise of workout.exercises) {
    const index = exercise.sets.findIndex((s) => s.id === setLocalId);
    if (index !== -1) {
      exercise.sets.splice(index, 1);
      return true;
    }
  }
  return false;
}

export function deleteExercise(workout, exerciseLocalId) {
  const index = workout.exercises.findIndex((e) => e.id === exerciseLocalId);
  if (index === -1) return false;
  workout.exercises.splice(index, 1);
  return true;
}

/**
 * Collapse the model into the payload POST /api/workouts/sync expects. Only the
 * fields the server needs to materialize the workout are sent; local ids are
 * dropped. An exercise with neither a server exerciseId/catalogId nor a name is
 * skipped (it cannot be resolved).
 */
export function toSyncPayload(workout) {
  return {
    clientId: workout.clientId,
    name: workout.name,
    startedAt: workout.startedAt,
    finishedAt: new Date().toISOString(),
    exercises: workout.exercises
      .filter((e) => e.exerciseId != null || e.catalogId != null || e.name)
      .map((e) => ({
        ...(e.exerciseId != null ? { exerciseId: e.exerciseId } : {}),
        ...(e.catalogId != null ? { catalogId: e.catalogId } : {}),
        ...(e.exerciseId == null && e.catalogId == null ? { name: e.name } : {}),
        notes: e.notes ?? null,
        supersetGroup: e.supersetGroup ?? null,
        sets: e.sets.map((s) => ({
          weightKg: s.weightKg,
          reps: s.reps,
          completed: Boolean(s.completed),
          restSeconds: s.restSeconds,
        })),
      })),
  };
}
