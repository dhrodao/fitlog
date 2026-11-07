// Fixture builders for FitLog tests.
//
// These drive the real HTTP API through a supertest agent, so fixtures exercise
// the same validation and side effects as production. Each helper returns the
// created resource body. Pass the agent returned by createTestApp()/newAgent().

import assert from 'node:assert/strict';

/**
 * Log in as the demo dev user on the given agent (requires ALLOW_DEV_LOGIN).
 * @returns {Promise<object>} the user object
 */
export async function loginDev(agent) {
  const res = await agent.post('/api/auth/dev').expect(200);
  return res.body.user;
}

/**
 * Create a custom (per-user) exercise.
 * @param {object} agent
 * @param {{name: string, category?: string}} data
 * @returns {Promise<object>} the exercise
 */
export async function createExercise(agent, { name, category = 'Pecho' }) {
  const res = await agent
    .post('/api/exercises/custom')
    .send({ name, category })
    .expect(201);
  return res.body.exercise;
}

/**
 * Create a routine.
 * @param {object} agent
 * @param {object} data
 * @param {string} data.name
 * @param {string} [data.description]
 * @param {string} [data.folder]
 * @param {Array<{exerciseId?: number, name?: string, targetSets?: number, targetReps?: string}>} [data.exercises]
 * @returns {Promise<object>} the routine
 */
export async function createRoutine(agent, { name, description = '', folder = null, exercises = [] }) {
  const res = await agent
    .post('/api/routines')
    .send({ name, description, folder, exercises })
    .expect(201);
  return res.body.routine;
}

/**
 * Start an empty ("free") workout.
 * @returns {Promise<object>} the workout
 */
export async function startFreeWorkout(agent, name = 'Entreno libre') {
  const res = await agent.post('/api/workouts').send({ name }).expect(201);
  return res.body.workout;
}

/**
 * Start a workout from an existing routine.
 * @returns {Promise<object>} the workout
 */
export async function startWorkoutFromRoutine(agent, routineId) {
  const res = await agent.post(`/api/routines/${routineId}/start`).expect(201);
  return res.body.workout;
}

/**
 * Add a set to a workout exercise.
 * @returns {Promise<object>} the created set
 */
export async function addSet(agent, workoutId, workoutExerciseId, payload = {}) {
  const res = await agent
    .post(`/api/workouts/${workoutId}/exercises/${workoutExerciseId}/sets`)
    .send(payload)
    .expect(201);
  return res.body.set;
}

/**
 * Update a set (absolute values).
 * @returns {Promise<object>} the response body
 */
export async function updateSet(agent, workoutId, setId, payload) {
  const res = await agent
    .patch(`/api/workouts/${workoutId}/sets/${setId}`)
    .send(payload)
    .expect(200);
  return res.body;
}

/**
 * Finish a workout.
 * @returns {Promise<object>} the finished workout
 */
export async function finishWorkout(agent, workoutId) {
  const res = await agent
    .post(`/api/workouts/${workoutId}/finish`)
    .send({})
    .expect(200);
  return res.body.workout;
}

/**
 * Save a measurement for a date.
 * @returns {Promise<object>} the measurement
 */
export async function saveMeasurement(agent, payload) {
  const res = await agent.post('/api/measurements').send(payload).expect(201);
  return res.body.measurement;
}

/**
 * Convenience: a logged-in user with one routine (bench + squat) ready to use.
 * @returns {Promise<{user: object, bench: object, squat: object, routine: object}>}
 */
export async function seedRoutineScenario(agent) {
  const user = await loginDev(agent);
  const bench = await createExercise(agent, { name: 'Press banca fixture', category: 'Pecho' });
  const squat = await createExercise(agent, { name: 'Sentadilla fixture', category: 'Piernas' });
  const routine = await createRoutine(agent, {
    name: 'Rutina fixture',
    folder: 'Fixtures',
    exercises: [
      { exerciseId: bench.id, targetSets: 3, targetReps: '8-10' },
      { exerciseId: squat.id, targetSets: 3, targetReps: '6-8' },
    ],
  });
  assert.equal(routine.exercises.length, 2, 'fixture routine should have two exercises');
  return { user, bench, squat, routine };
}
