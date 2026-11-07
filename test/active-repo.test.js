// Active-workout repository: decides API (online) vs local model (offline),
// degrades to local on a network failure, and uploads local workouts via the
// idempotent /sync endpoint.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createActiveWorkoutRepo } from '../public/js/offline/active-repo.js';
import * as model from '../public/js/offline/local-workout.js';

function networkError() {
  const e = new Error('offline');
  e.status = 0;
  return e;
}

// A fake store that records what was saved/cleared.
function fakeStore() {
  const calls = { saved: 0, cleared: 0 };
  return {
    calls,
    saveActiveWorkout: () => { calls.saved += 1; },
    clearActiveWorkout: () => { calls.cleared += 1; },
  };
}

test('online: start and addExercise delegate to the API', async () => {
  const api = {
    workouts: {
      create: async () => ({ workout: { id: 1, name: 'W', exercises: [], local: false } }),
      addExercise: async (id, body) => ({
        workout: { id, name: 'W', exercises: [{ id: 10, ...body }], local: false },
      }),
    },
  };
  const repo = createActiveWorkoutRepo({
    userId: 1, api, store: fakeStore(), model, isOnline: () => true,
  });
  await repo.start({ name: 'W' });
  assert.equal(repo.isLocal(), false);
  await repo.addExercise({ exerciseId: 7 });
  assert.equal(repo.current.exercises[0].exerciseId, 7);
  assert.equal(repo.current.local, undefined === repo.current.local ? undefined : false);
});

test('offline: start creates a local workout, never calls the API', async () => {
  let called = false;
  const api = { workouts: { create: async () => { called = true; return {}; } } };
  const repo = createActiveWorkoutRepo({
    userId: 1, api, store: fakeStore(), model, isOnline: () => false,
  });
  const w = await repo.start({ name: 'Gym' });
  assert.equal(called, false, 'no API call offline');
  assert.equal(repo.isLocal(), true);
  assert.ok(w.clientId, 'has an idempotency key');
});

test('a network failure during an online write degrades to local', async () => {
  const api = {
    workouts: {
      create: async () => ({ workout: { id: 1, name: 'W', exercises: [], local: false } }),
      addSet: async () => { throw networkError(); },
    },
  };
  const repo = createActiveWorkoutRepo({
    userId: 1, api, store: fakeStore(), model, isOnline: () => true,
  });
  await repo.start({ name: 'W' });
  // Give the online workout an exercise locally to attach the set to.
  model.addExercise(repo.current, { exerciseId: 7, name: 'X' });
  const exId = repo.current.exercises[0].id ?? repo.current.exercises[0];

  assert.equal(repo.isLocal(), false);
  const res = await repo.addSet(exId, { weightKg: 50, reps: 5 });
  assert.equal(res.local, true, 'fell back to local');
  assert.equal(repo.isLocal(), true, 'repo is local from now on');
});

test('a real (non-network) error is NOT swallowed', async () => {
  const unauthorized = Object.assign(new Error('nope'), { status: 401 });
  const api = {
    workouts: {
      create: async () => ({ workout: { id: 1, exercises: [], local: false } }),
      removeExercise: async () => { throw unauthorized; },
    },
  };
  const repo = createActiveWorkoutRepo({
    userId: 1, api, store: fakeStore(), model, isOnline: () => true,
  });
  await repo.start();
  await assert.rejects(() => repo.deleteExercise(10), /nope/);
});

test('finish uploads a local workout via idempotent /sync and clears the snapshot', async () => {
  let syncPayload = null;
  const api = {
    workouts: {
      sync: async (payload) => {
        syncPayload = payload;
        return { workout: { id: 99, finishedAt: 't', exercises: [] } };
      },
    },
  };
  const store = fakeStore();
  const repo = createActiveWorkoutRepo({
    userId: 1, api, store, model, isOnline: () => true,
  });
  // Seed a local workout with content.
  const w = model.createLocalWorkout({ name: 'Local' });
  model.addExercise(w, { exerciseId: 7, name: 'Sentadilla' });
  model.addSet(w, w.exercises[0].id, { weightKg: 100, reps: 5, completed: true });
  repo.set(w);

  const res = await repo.finish();
  assert.equal(res.finished.id, 99);
  assert.ok(syncPayload.clientId, 'clientId sent');
  assert.equal(syncPayload.exercises[0].exerciseId, 7);
  assert.equal(store.calls.cleared, 1, 'snapshot cleared after upload');
});

test('finish while offline keeps the workout pending (no upload)', async () => {
  const api = { workouts: { sync: async () => { throw new Error('should not be called'); } } };
  const store = fakeStore();
  const repo = createActiveWorkoutRepo({
    userId: 1, api, store, model, isOnline: () => false,
  });
  repo.set(model.createLocalWorkout({ name: 'Local' }));
  const res = await repo.finish();
  assert.equal(res.pending, true);
  assert.equal(store.calls.cleared, 0, 'kept for later sync');
});

test('syncPending uploads when back online, returns null otherwise', async () => {
  let uploads = 0;
  const api = {
    workouts: {
      sync: async () => { uploads += 1; return { workout: { id: 7, exercises: [] } }; },
    },
  };
  const store = fakeStore();
  let online = false;
  const repo = createActiveWorkoutRepo({
    userId: 1, api, store, model, isOnline: () => online,
  });
  repo.set(model.createLocalWorkout({ name: 'Local' }));

  assert.equal(await repo.syncPending(), null, 'nothing while offline');
  assert.equal(uploads, 0);

  online = true;
  const finished = await repo.syncPending();
  assert.equal(finished.id, 7);
  assert.equal(uploads, 1);
  assert.equal(store.calls.cleared, 1);
});
