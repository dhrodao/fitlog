// Local (offline) workout model: pure data structure with client-generated ids
// that collapses into the POST /api/workouts/sync payload.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLocalWorkout,
  adoptWorkout,
  addExercise,
  addSet,
  updateSet,
  deleteSet,
  deleteExercise,
  toSyncPayload,
} from '../public/js/offline/local-workout.js';

test('a new local workout has a clientId and a local string id', () => {
  const w = createLocalWorkout({ name: 'Pierna' });
  assert.equal(w.local, true);
  assert.match(w.clientId, /[0-9a-f-]{8,}/);
  assert.equal(typeof w.id, 'string');
  assert.ok(w.id.startsWith('local-'), 'id is non-numeric so Number(id) is NaN');
  assert.equal(w.name, 'Pierna');
  assert.deepEqual(w.exercises, []);
});

test('adopting an online workout keeps its data and adds a clientId', () => {
  const online = { id: 42, name: 'Empuje', startedAt: 't', exercises: [] };
  const w = adoptWorkout(online);
  assert.equal(w.id, 42, 'server id preserved');
  assert.equal(w.local, true);
  assert.ok(w.clientId, 'clientId attached for later upload');
});

test('adding exercises and sets, then editing and deleting', () => {
  const w = createLocalWorkout();
  addExercise(w, { exerciseId: 7, name: 'Sentadilla' });
  const ex = w.exercises[0];
  assert.equal(ex.exerciseId, 7);
  assert.deepEqual(ex.previousSets, [], 'no history offline');

  const s1 = addSet(w, ex.id, { weightKg: 100, reps: 5 });
  addSet(w, ex.id, { weightKg: 100, reps: 5 });
  assert.equal(ex.sets.length, 2);
  assert.ok(s1.id.startsWith('local-s-'));

  updateSet(w, s1.id, { weightKg: 110, completed: true });
  assert.equal(ex.sets[0].weightKg, 110);
  assert.equal(ex.sets[0].completed, true);

  deleteSet(w, s1.id);
  assert.equal(ex.sets.length, 1);

  deleteExercise(w, ex.id);
  assert.equal(w.exercises.length, 0);
});

test('toSyncPayload drops local ids and sends resolvable exercises only', () => {
  const w = createLocalWorkout({ name: 'Full body' });
  addExercise(w, { exerciseId: 7, name: 'Sentadilla' });
  addExercise(w, { catalogId: 'abc', name: 'Press banca' });
  addExercise(w, { name: 'Ejercicio raro sin id' }); // custom, by name
  // An exercise with no id and no name cannot be resolved; it must be skipped.
  w.exercises.push({ id: 'x', exerciseId: null, catalogId: null, name: '', sets: [] });

  addSet(w, w.exercises[0].id, { weightKg: 100, reps: 5, completed: true });

  const payload = toSyncPayload(w);
  assert.equal(payload.clientId, w.clientId);
  assert.equal(payload.name, 'Full body');
  assert.ok(payload.startedAt && payload.finishedAt);
  assert.equal(payload.exercises.length, 3, 'the unresolvable exercise is dropped');

  // First exercise by server id.
  assert.equal(payload.exercises[0].exerciseId, 7);
  assert.equal(payload.exercises[0].sets[0].weightKg, 100);
  assert.equal(payload.exercises[0].sets[0].completed, true);
  // Second by catalog id.
  assert.equal(payload.exercises[1].catalogId, 'abc');
  // Third is custom, sent by name.
  assert.equal(payload.exercises[2].name, 'Ejercicio raro sin id');
  // No local ids leak into the payload.
  assert.ok(!('id' in payload.exercises[0]));
  assert.ok(!('id' in payload.exercises[0].sets[0]));
});
