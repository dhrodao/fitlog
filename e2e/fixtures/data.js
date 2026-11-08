import { randomUUID } from 'node:crypto';

/**
 * Returns a name that is unique for this run. Custom exercises cannot be
 * deleted through the API, so tests locate them by this suffix instead of
 * relying on the database being pristine.
 */
export function uniqueName(prefix = 'E2E') {
  return `${prefix} ${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export function workoutPayload({
  clientId = randomUUID(),
  name = 'Entreno E2E',
  startedAt,
  finishedAt,
  exercises = [],
} = {}) {
  return {
    clientId,
    name,
    startedAt,
    finishedAt,
    exercises,
  };
}

export function setPayload({ weightKg = null, reps = null, completed = false } = {}) {
  return { weightKg, reps, completed };
}

export function exercisePayload({ exerciseId, name, sets = [] } = {}) {
  return {
    ...(exerciseId ? { exerciseId } : {}),
    ...(name ? { name } : {}),
    sets,
  };
}

export function routinePayload({
  name = 'Rutina E2E',
  folder = null,
  exercises = [],
} = {}) {
  return { name, folder, exercises };
}
