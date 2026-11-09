// prCount: a workout exercise counts as a record when it beats the previous
// best in weight, estimated 1RM, or single-session volume. Rep-only increases
// do not count. Driven through the real API so it exercises the SQL.

import test from 'node:test';
import assert from 'node:assert/strict';

import { setupTestEnv, createTestApp, cleanupTestApp } from './helpers/app.js';

setupTestEnv();

const { app, db, agent } = await createTestApp();

import {
  loginDev,
  createExercise,
  startFreeWorkout,
  addSet,
  finishWorkout,
} from './helpers/fixtures.js';

test.after(() => cleanupTestApp(db));

async function addExercise(a, workoutId, exerciseId) {
  const res = await a
    .post(`/api/workouts/${workoutId}/exercises`)
    .send({ exerciseId, targetSets: 0 })
    .expect(201);
  return res.body.workout.exercises.find((e) => e.exerciseId === exerciseId);
}

// Record one workout with a single completed set and return summary.records.
async function sessionRecords(exerciseId, name, sets) {
  const w = await startFreeWorkout(agent, name);
  const we = await addExercise(agent, w.id, exerciseId);
  for (const s of sets) {
    await addSet(agent, w.id, we.id, { ...s, completed: true });
  }
  const finished = await finishWorkout(agent, w.id);
  return finished.summary.records;
}

test('first ever session of an exercise is a record', async () => {
  await loginDev(agent);
  const ex = await createExercise(agent, { name: 'Sentadilla PR', category: 'Piernas' });
  const records = await sessionRecords(ex.id, 'Baseline', [{ weightKg: 100, reps: 5 }]);
  assert.equal(records, 1, 'the baseline beats an empty history');
});

test('beating weight counts; failing to beat anything does not', async () => {
  await loginDev(agent);
  const ex = await createExercise(agent, { name: 'Press banca PR', category: 'Pecho' });

  await sessionRecords(ex.id, 'S1', [{ weightKg: 100, reps: 5 }]); // baseline
  const heavier = await sessionRecords(ex.id, 'S2', [{ weightKg: 105, reps: 5 }]);
  assert.equal(heavier, 1, 'heavier top set is a weight PR');

  // Strictly worse than the running bests (lower weight, lower e1rm, lower volume).
  const worse = await sessionRecords(ex.id, 'S3', [{ weightKg: 60, reps: 3 }]);
  assert.equal(worse, 0, 'a worse session sets no record');
});

test('beating estimated 1RM at the same top weight counts', async () => {
  await loginDev(agent);
  const ex = await createExercise(agent, { name: 'Peso muerto PR', category: 'Espalda' });

  // Baseline: 140x1 -> e1rm 140, volume 140.
  await sessionRecords(ex.id, 'S1', [{ weightKg: 140, reps: 1 }]);
  // Same top weight (no weight PR) but more reps -> higher e1rm (140*(1+3/30)=154).
  const better = await sessionRecords(ex.id, 'S2', [{ weightKg: 140, reps: 3 }]);
  assert.equal(better, 1, 'higher e1RM at equal weight is a record');
});

test('beating session volume counts even without a weight or e1RM PR', async () => {
  await loginDev(agent);
  const ex = await createExercise(agent, { name: 'Remo PR', category: 'Espalda' });

  // Baseline: one set 100x5 -> weight 100, e1rm ~116.7, volume 500.
  await sessionRecords(ex.id, 'S1', [{ weightKg: 100, reps: 5 }]);
  // Lower top weight and lower e1RM per set, but much higher total volume.
  // 90x5 (e1rm 105) repeated gives volume 90*5*3 = 1350 > 500.
  const volumePR = await sessionRecords(ex.id, 'S2', [
    { weightKg: 90, reps: 5 },
    { weightKg: 90, reps: 5 },
    { weightKg: 90, reps: 5 },
  ]);
  assert.equal(volumePR, 1, 'a session-volume PR counts');
});

test('workout detail flags the sets that beat the previous best', async () => {
  await loginDev(agent);
  const ex = await createExercise(agent, { name: 'Sentadilla flags', category: 'Piernas' });

  await sessionRecords(ex.id, 'S1', [{ weightKg: 100, reps: 5 }]);

  const w = await startFreeWorkout(agent, 'S2');
  const we = await addExercise(agent, w.id, ex.id);
  const worse = await addSet(agent, w.id, we.id, { weightKg: 90, reps: 5, completed: true });
  const heavier = await addSet(agent, w.id, we.id, { weightKg: 105, reps: 5, completed: true });
  const top = await addSet(agent, w.id, we.id, { weightKg: 110, reps: 3, completed: true });

  const finished = await finishWorkout(agent, w.id);
  const sets = finished.exercises.find((e) => e.exerciseId === ex.id).sets;
  const recordById = new Map(sets.map((set) => [set.id, set.record]));

  assert.equal(recordById.get(worse.id), false, 'a set below the previous best is not a record');
  assert.equal(recordById.get(heavier.id), true, 'a heavier set is a record');
  assert.equal(recordById.get(top.id), true, 'a heavier top set is a record');
});

test('a record set only advances the dimension it beats', async () => {
  await loginDev(agent);
  const ex = await createExercise(agent, { name: 'Press militar flags', category: 'Hombros' });

  // Baseline: weight 100, e1RM ~116.7.
  await sessionRecords(ex.id, 'S1', [{ weightKg: 100, reps: 5 }]);

  const w = await startFreeWorkout(agent, 'S2');
  const we = await addExercise(agent, w.id, ex.id);
  // 90x10 beats e1RM (120) but not weight; must not lower the weight record.
  const e1rmPR = await addSet(agent, w.id, we.id, { weightKg: 90, reps: 10, completed: true });
  // 95x5 beats neither the weight (95 < 100) nor the running e1RM (110.8 < 120).
  const belowBoth = await addSet(agent, w.id, we.id, { weightKg: 95, reps: 5, completed: true });
  // 105x1 beats weight but has a lower e1RM; must not lower the e1RM record.
  const weightPR = await addSet(agent, w.id, we.id, { weightKg: 105, reps: 1, completed: true });
  // 100x5 beats neither the running weight (100 < 105) nor e1RM (116.7 < 120).
  const belowRunning = await addSet(agent, w.id, we.id, { weightKg: 100, reps: 5, completed: true });

  const finished = await finishWorkout(agent, w.id);
  const sets = finished.exercises.find((e) => e.exerciseId === ex.id).sets;
  const recordById = new Map(sets.map((set) => [set.id, set.record]));

  assert.equal(recordById.get(e1rmPR.id), true, 'an e1RM-only record is flagged');
  assert.equal(recordById.get(belowBoth.id), false, 'an e1RM-only set must not lower the weight best');
  assert.equal(recordById.get(weightPR.id), true, 'a weight-only record is flagged');
  assert.equal(recordById.get(belowRunning.id), false, 'a weight-only set must not lower the e1RM best');
});
