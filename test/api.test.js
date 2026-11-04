import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

const dbPath = path.join(os.tmpdir(), `fitlog-test-${process.pid}.db`);
process.env.DB_PATH = dbPath;
process.env.NODE_ENV = 'test';
process.env.ALLOW_DEV_LOGIN = 'true';
process.env.GOOGLE_CLIENT_ID = '';

const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db.js');

const app = createApp();
const agent = request.agent(app);

test('flujo completo de la API', async (t) => {
  let routine;
  let workout;
  let benchExercise;
  let workoutId;

  await t.test('health y autenticación', async () => {
    const health = await agent.get('/api/health').expect(200);
    assert.equal(health.body.ok, true);

    const config = await agent.get('/api/auth/config').expect(200);
    assert.equal(config.body.devLoginEnabled, true);
    assert.equal(config.body.googleEnabled, false);

    await agent.get('/api/auth/me').expect(401);
    await agent.get('/api/workouts').expect(401);

    const dev = await agent.post('/api/auth/dev').expect(200);
    assert.equal(dev.body.user.name, 'Atleta Demo');
    assert.equal(dev.body.user.isDev, true);

    const me = await agent.get('/api/auth/me').expect(200);
    assert.equal(me.body.user.isDev, true);
  });

  await t.test('ejercicios personalizados', async () => {
    const bench = await agent
      .post('/api/exercises/custom')
      .send({ name: 'Press banca test', category: 'Pecho' })
      .expect(201);
    benchExercise = bench.body.exercise;
    assert.equal(benchExercise.name, 'Press banca test');

    const squat = await agent
      .post('/api/exercises/custom')
      .send({ name: 'Sentadilla test', category: 'Piernas' })
      .expect(201);
    assert.equal(squat.body.exercise.category, 'Piernas');

    await agent.post('/api/exercises/custom').send({ name: '  ' }).expect(400);

    const mine = await agent.get('/api/exercises/mine').expect(200);
    assert.ok(mine.body.exercises.length >= 2);

    const search = await agent
      .get('/api/exercises/mine?q=banca')
      .expect(200);
    assert.equal(search.body.exercises.length, 1);
  });

  await t.test('crear, listar y detallar rutina', async () => {
    const created = await agent
      .post('/api/routines')
      .send({
        name: 'Rutina QA',
        description: 'Rutina de prueba',
        folder: 'QA',
        exercises: [
          {
            exerciseId: benchExercise.id,
            targetSets: 3,
            targetReps: '8-10',
          },
          {
            name: 'Sentadilla test',
            targetSets: 4,
            targetReps: '6-8',
          },
        ],
      })
      .expect(201);

    routine = created.body.routine;
    assert.equal(routine.exercises.length, 2);
    assert.equal(routine.exercises[0].targetSets, 3);
    assert.deepEqual(routine.exercises[0].lastSets, []);

    const list = await agent.get('/api/routines').expect(200);
    const entry = list.body.routines.find((item) => item.id === routine.id);
    assert.ok(entry);
    assert.equal(entry.exerciseCount, 2);
    assert.match(entry.preview, /Press banca test/);
    assert.equal(entry.folder, 'QA');

    const detail = await agent.get(`/api/routines/${routine.id}`).expect(200);
    assert.equal(detail.body.routine.name, 'Rutina QA');

    await agent.get('/api/routines/999999').expect(404);
  });

  await t.test('iniciar entreno desde rutina y registrar series', async () => {
    const started = await agent
      .post(`/api/routines/${routine.id}/start`)
      .expect(201);

    workout = started.body.workout;
    workoutId = workout.id;
    assert.equal(workout.active, true);
    assert.equal(workout.exercises.length, 2);
    assert.equal(workout.exercises[0].sets.length, 3);
    assert.equal(workout.exercises[1].sets.length, 4);
    assert.equal(workout.exercises[0].sets[0].reps, 8);
    assert.equal(workout.exercises[1].sets[0].reps, 6);

    await agent.post(`/api/routines/${routine.id}/start`).expect(409);
    await agent.post('/api/workouts').send({ name: 'Otro' }).expect(409);

    const active = await agent.get('/api/workouts/active').expect(200);
    assert.equal(active.body.workout.id, workoutId);

    const firstSet = workout.exercises[0].sets[0];
    const updated = await agent
      .patch(`/api/workouts/${workoutId}/sets/${firstSet.id}`)
      .send({ weightKg: 60, reps: 8, completed: true })
      .expect(200);
    assert.equal(updated.body.set.weightKg, 60);
    assert.equal(updated.body.set.completed, true);

    const added = await agent
      .post(
        `/api/workouts/${workoutId}/exercises/${workout.exercises[0].id}/sets`
      )
      .send({ weightKg: 62.5, reps: 7, completed: true })
      .expect(201);
    assert.equal(added.body.set.number, 4);

    await agent
      .delete(`/api/workouts/${workoutId}/sets/${added.body.set.id}`)
      .expect(200);

    const secondSet = workout.exercises[0].sets[1];
    await agent
      .patch(`/api/workouts/${workoutId}/sets/${secondSet.id}`)
      .send({ weightKg: 60, reps: 7, completed: true })
      .expect(200);
  });

  await t.test('finalizar entreno, historial y estadísticas', async () => {
    const finished = await agent
      .post(`/api/workouts/${workoutId}/finish`)
      .send({ notes: 'Sesión de prueba' })
      .expect(200);

    assert.equal(finished.body.workout.active, false);
    assert.ok(finished.body.workout.durationSeconds >= 0);
    assert.equal(finished.body.workout.summary.sets, 2);
    assert.equal(finished.body.workout.summary.volume, 900);

    const list = await agent.get('/api/workouts?limit=10').expect(200);
    assert.equal(list.body.workouts.length, 1);
    assert.equal(list.body.workouts[0].id, workoutId);

    const detail = await agent.get(`/api/workouts/${workoutId}`).expect(200);
    assert.equal(detail.body.workout.notes, 'Sesión de prueba');

    const overview = await agent
      .get('/api/stats/overview?period=3m')
      .expect(200);
    assert.equal(overview.body.totals.workouts, 1);
    assert.equal(overview.body.totals.sets, 2);
    assert.equal(overview.body.allTimeWorkouts, 1);
    assert.ok(Array.isArray(overview.body.weekly));
    assert.ok(overview.body.weekly.length > 0);
    assert.equal(overview.body.recent.length, 1);

    const exerciseStats = await agent
      .get(`/api/stats/exercise/${benchExercise.id}`)
      .expect(200);
    assert.equal(exerciseStats.body.history.length, 1);
    assert.equal(exerciseStats.body.bestWeight, 60);
    assert.equal(exerciseStats.body.exercise.name, 'Press banca test');

    const routineDetail = await agent
      .get(`/api/routines/${routine.id}?period=3m`)
      .expect(200);
    assert.equal(routineDetail.body.routine.history.length, 1);
    assert.equal(routineDetail.body.routine.exercises[0].lastSets.length, 2);
  });

  await t.test('medidas corporales', async () => {
    await agent
      .post('/api/measurements')
      .send({ date: '2026-01-05', weightKg: 80.4 })
      .expect(201);

    const updated = await agent
      .post('/api/measurements')
      .send({ date: '2026-01-05', weightKg: 80.1, waistCm: 84 })
      .expect(201);
    assert.equal(updated.body.measurement.weightKg, 80.1);
    assert.equal(updated.body.measurement.waistCm, 84);

    const list = await agent.get('/api/measurements').expect(200);
    assert.equal(list.body.measurements.length, 1);

    await agent
      .post('/api/measurements')
      .send({ date: '05-01-2026', weightKg: 80 })
      .expect(400);
    await agent
      .post('/api/measurements')
      .send({ date: '2026-01-06' })
      .expect(400);

    const latest = await agent
      .get('/api/stats/overview')
      .expect(200);
    assert.equal(latest.body.latestWeight.weightKg, 80.1);
  });

  await t.test('duplicar y eliminar rutina', async () => {
    const duplicated = await agent
      .post(`/api/routines/${routine.id}/duplicate`)
      .expect(201);
    assert.match(duplicated.body.routine.name, /copia/);
    assert.equal(duplicated.body.routine.exercises.length, 2);

    const deleteDuplicate = await agent
      .delete(`/api/routines/${duplicated.body.routine.id}`)
      .expect(200);
    assert.equal(deleteDuplicate.body.ok, true);

    await agent.delete(`/api/routines/${duplicated.body.routine.id}`).expect(404);
  });

  await t.test('eliminar series y ejercicios del entreno', async () => {
    const created = await agent
      .post('/api/workouts')
      .send({ name: 'Entreno suelto' })
      .expect(201);
    const id = created.body.workout.id;

    const withExercise = await agent
      .post(`/api/workouts/${id}/exercises`)
      .send({ name: 'Press banca test', targetSets: 2, prefill: false })
      .expect(201);
    assert.equal(withExercise.body.workout.exercises.length, 1);
    const workoutExercise = withExercise.body.workout.exercises[0];
    assert.equal(workoutExercise.sets.length, 2);

    const added = await agent
      .post(`/api/workouts/${id}/exercises/${workoutExercise.id}/sets`)
      .send({ weightKg: 40, reps: 10, completed: true })
      .expect(201);
    await agent
      .delete(`/api/workouts/${id}/sets/${added.body.set.id}`)
      .expect(200);

    const removed = await agent
      .delete(`/api/workouts/${id}/exercises/${workoutExercise.id}`)
      .expect(200);
    assert.equal(removed.body.workout.exercises.length, 0);

    await agent.delete(`/api/workouts/${id}`).expect(200);
    await agent.get(`/api/workouts/${id}`).expect(404);
  });

  await t.test('cerrar sesión', async () => {
    await agent.post('/api/auth/logout').expect(200);
    await agent.get('/api/auth/me').expect(401);
    await agent.get('/api/routines').expect(401);
  });
});

test.after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(`${dbPath}${suffix}`);
    } catch {
      // ignore
    }
  }
});
