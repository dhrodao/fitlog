// Editing policy for routines.
//
// Manual routines are fully editable. Routines imported from Hevy are read-only
// (a later Hevy sync would overwrite local edits), but they can still be
// deleted, started and duplicated. A duplicate must be an editable copy
// (source null) so the user can adapt it freely.

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, createTestApp, cleanupTestApp } from './helpers/app.js';
import { loginDev, createExercise, createRoutine } from './helpers/fixtures.js';

setupTestEnv();
const { app, db, agent } = await createTestApp();

// Build a routine with a single exercise. Returns the routine body.
async function seedRoutine(name = 'Rutina manual') {
  const exercise = await createExercise(agent, {
    name: `Ejercicio ${Math.random().toString(16).slice(2, 8)}`,
    category: 'Pecho',
  });
  return createRoutine(agent, {
    name,
    exercises: [{ exerciseId: exercise.id, targetSets: 3, targetReps: '8-10' }],
  });
}

function markAsHevy(routineId) {
  db.prepare("UPDATE routines SET source = 'hevy' WHERE id = ?").run(routineId);
}

test('routine edit policy', async (t) => {
  await loginDev(agent);

  await t.test('a manual routine can be updated with PUT', async () => {
    const routine = await seedRoutine('Editable');

    const res = await agent
      .put(`/api/routines/${routine.id}`)
      .send({ name: 'Renombrada', exercises: routine.exercises.map((e) => ({ exerciseId: e.exercise.id })) })
      .expect(200);
    assert.equal(res.body.routine.name, 'Renombrada');

    const reload = await agent.get(`/api/routines/${routine.id}`).expect(200);
    assert.equal(reload.body.routine.name, 'Renombrada');
  });

  await t.test('updating a Hevy routine is blocked with 403', async () => {
    const routine = await seedRoutine('De Hevy');
    markAsHevy(routine.id);

    await agent
      .put(`/api/routines/${routine.id}`)
      .send({ name: 'Intento' })
      .expect(403);
  });

  await t.test('a Hevy routine can still be deleted', async () => {
    const routine = await seedRoutine('De Hevy borrable');
    markAsHevy(routine.id);

    await agent.delete(`/api/routines/${routine.id}`).expect(200);
    await agent.get(`/api/routines/${routine.id}`).expect(404);
  });

  await t.test('duplicating a Hevy routine yields an editable (source null) copy', async () => {
    const routine = await seedRoutine('De Hevy duplicable');
    markAsHevy(routine.id);

    const dup = await agent
      .post(`/api/routines/${routine.id}/duplicate`)
      .expect(201);
    const copy = dup.body.routine;
    assert.equal(copy.source, null, 'the duplicate is not tagged as Hevy');

    // The editable copy accepts a PUT.
    await agent
      .put(`/api/routines/${copy.id}`)
      .send({ name: 'Copia editada', exercises: copy.exercises.map((e) => ({ exerciseId: e.exercise.id })) })
      .expect(200);
  });
});

test.after(() => cleanupTestApp(db));
