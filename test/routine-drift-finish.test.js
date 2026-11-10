// Finishing a workout started from a routine, after its exercise structure was
// changed.
//
// A workout keeps a reference to the routine it was started from so the history
// can offer "Ver rutina". If the user swaps, adds, removes or reorders
// exercises mid-workout, that reference becomes stale: it points at a routine
// that no longer matches. On finish the client asks what to do, and sends a
// routineAction: 'overwrite' rewrites the routine to match the workout (keeping
// the link), 'detach' keeps the routine untouched and drops the link. With no
// structural change the flag is off and finishing behaves as before.

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, createTestApp, cleanupTestApp } from './helpers/app.js';
import { loginDev, createExercise, createRoutine } from './helpers/fixtures.js';

setupTestEnv();
const { app, db, agent } = await createTestApp();

test.after(() => cleanupTestApp(db));

// A routine with two exercises plus a spare exercise to swap in. Returns the
// created resources. Names are randomized so repeated calls don't collide.
async function seedScenario() {
  const tag = Math.random().toString(16).slice(2, 8);
  const bench = await createExercise(agent, { name: `Banca ${tag}`, category: 'Pecho' });
  const squat = await createExercise(agent, { name: `Sentadilla ${tag}`, category: 'Piernas' });
  const row = await createExercise(agent, { name: `Remo ${tag}`, category: 'Espalda' });
  const routine = await createRoutine(agent, {
    name: `Rutina ${tag}`,
    exercises: [
      { exerciseId: bench.id, targetSets: 3, targetReps: '8-10' },
      { exerciseId: squat.id, targetSets: 4, targetReps: '6-8' },
    ],
  });
  return { bench, squat, row, routine };
}

async function startFromRoutine(routineId) {
  const res = await agent.post(`/api/routines/${routineId}/start`).expect(201);
  return res.body.workout;
}

async function finish(workoutId, body = {}) {
  const res = await agent.post(`/api/workouts/${workoutId}/finish`).send(body).expect(200);
  return res.body.workout;
}

async function routineExerciseIds(routineId) {
  const res = await agent.get(`/api/routines/${routineId}`).expect(200);
  return res.body.routine.exercises.map((e) => e.exercise.id);
}

test('routine drift on finish', async (t) => {
  await loginDev(agent);

  await t.test('no structural change: routineDirty is false and link survives', async () => {
    const { routine } = await seedScenario();
    const workout = await startFromRoutine(routine.id);
    assert.equal(workout.routineId, routine.id);
    assert.equal(workout.routineDirty, false);

    // Logging sets (weights/reps/completed) is not a structural change.
    const setId = workout.exercises[0].sets[0].id;
    await agent
      .patch(`/api/workouts/${workout.id}/sets/${setId}`)
      .send({ weightKg: 50, reps: 8, completed: true })
      .expect(200);

    const active = await agent.get('/api/workouts/active').expect(200);
    assert.equal(active.body.workout.routineDirty, false);

    const finished = await finish(workout.id);
    assert.equal(finished.routineId, routine.id);
  });

  await t.test('replacing an exercise flips routineDirty', async () => {
    const { routine, row } = await seedScenario();
    const workout = await startFromRoutine(routine.id);

    await agent
      .post(`/api/workouts/${workout.id}/exercises/${workout.exercises[0].id}/replace`)
      .send({ exerciseId: row.id })
      .expect(200);

    const active = await agent.get('/api/workouts/active').expect(200);
    assert.equal(active.body.workout.routineDirty, true);

    // Clean up the active workout so the next subtest can start a new one.
    await finish(workout.id, { routineAction: 'detach' });
  });

  await t.test('overwrite rewrites the routine to match and keeps the link', async () => {
    const { routine, squat, row } = await seedScenario();
    const workout = await startFromRoutine(routine.id);
    const first = workout.exercises[0].id;

    // Swap the first exercise for the spare one; the routine now differs.
    await agent
      .post(`/api/workouts/${workout.id}/exercises/${first}/replace`)
      .send({ exerciseId: row.id })
      .expect(200);

    const finished = await finish(workout.id, { routineAction: 'overwrite' });
    // Link preserved.
    assert.equal(finished.routineId, routine.id);
    // Routine now mirrors the workout's exercise order: [row, squat].
    assert.deepEqual(await routineExerciseIds(routine.id), [row.id, squat.id]);
  });

  await t.test('overwrite keeps the surviving exercise target_sets', async () => {
    const { routine, squat, row } = await seedScenario();
    // squat had targetSets 4 in the routine; it must keep it after overwrite.
    const workout = await startFromRoutine(routine.id);

    await agent
      .post(`/api/workouts/${workout.id}/exercises/${workout.exercises[0].id}/replace`)
      .send({ exerciseId: row.id })
      .expect(200);

    await finish(workout.id, { routineAction: 'overwrite' });
    const detail = await agent.get(`/api/routines/${routine.id}`).expect(200);
    const squatRow = detail.body.routine.exercises.find((e) => e.exercise.id === squat.id);
    assert.ok(squatRow, 'squat should still be in the routine');
    assert.equal(squatRow.targetSets, 4);
  });

  await t.test('detach drops the link and leaves the routine untouched', async () => {
    const { routine, bench, squat, row } = await seedScenario();
    const before = await routineExerciseIds(routine.id);
    const workout = await startFromRoutine(routine.id);

    await agent
      .post(`/api/workouts/${workout.id}/exercises/${workout.exercises[0].id}/replace`)
      .send({ exerciseId: row.id })
      .expect(200);

    const finished = await finish(workout.id, { routineAction: 'detach' });
    // The workout is no longer linked to the routine.
    assert.equal(finished.routineId, null);
    // The routine is unchanged.
    assert.deepEqual(before, [bench.id, squat.id]);
    assert.deepEqual(await routineExerciseIds(routine.id), [bench.id, squat.id]);
  });

  await t.test('routineAction is ignored when nothing drifted', async () => {
    const { routine } = await seedScenario();
    const workout = await startFromRoutine(routine.id);

    // Even an explicit overwrite must not touch the routine or the link when
    // the structure still matches.
    const finished = await finish(workout.id, { routineAction: 'overwrite' });
    assert.equal(finished.routineId, routine.id);
    assert.deepEqual(await routineExerciseIds(routine.id), routine.exercises.map((e) => e.exercise.id));
  });
});
