/**
 * Thin helpers over the browser context's request client. Everything goes
 * through the public HTTP API with the same cookie jar as the page, so the
 * tests exercise the real server contract and never touch the database file.
 */

async function json(response, label) {
  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`${label} failed with ${response.status()}: ${body}`);
  }
  return response.json();
}

export async function loginViaApi(context) {
  const response = await context.request.post('/api/auth/dev');
  return json(response, 'dev login');
}

export async function getActiveWorkout(context) {
  const response = await context.request.get('/api/workouts/active');
  const body = await json(response, 'get active workout');
  return body.workout || null;
}

export async function resetData(context) {
  const active = await getActiveWorkout(context);
  if (active) {
    await context.request.delete(`/api/workouts/${active.id}`);
  }

  // listWorkouts only returns finished workouts and caps the page at 100.
  for (let page = 0; page < 50; page += 1) {
    const response = await context.request.get('/api/workouts?limit=100');
    const { workouts } = await json(response, 'list workouts');
    if (!workouts.length) break;
    for (const workout of workouts) {
      await context.request.delete(`/api/workouts/${workout.id}`);
    }
  }

  const routinesResponse = await context.request.get('/api/routines');
  const { routines } = await json(routinesResponse, 'list routines');
  for (const routine of routines) {
    await context.request.delete(`/api/routines/${routine.id}`);
  }

  const measurementsResponse = await context.request.get('/api/measurements');
  const { measurements } = await json(measurementsResponse, 'list measurements');
  for (const measurement of measurements) {
    await context.request.delete(`/api/measurements/${measurement.id}`);
  }
}

export async function seedExercise(context, name, { category = 'Personalizado' } = {}) {
  const response = await context.request.post('/api/exercises/custom', {
    data: { name, category },
  });
  const { exercise } = await json(response, 'create custom exercise');
  return exercise;
}

export async function seedCatalogExercise(context, catalogId) {
  const response = await context.request.post('/api/exercises/from-catalog', {
    data: { catalogId },
  });
  const { exercise } = await json(response, 'create catalog exercise');
  return exercise;
}

export async function seedRoutine(context, payload) {
  const response = await context.request.post('/api/routines', { data: payload });
  const { routine } = await json(response, 'create routine');
  return routine;
}

export async function seedWorkout(context, payload) {
  const response = await context.request.post('/api/workouts/sync', {
    data: payload,
  });
  const { workout } = await json(response, 'sync workout');
  return workout;
}

export async function startRoutine(context, id) {
  const response = await context.request.post(`/api/routines/${id}/start`);
  const { workout } = await json(response, 'start routine');
  return workout;
}

export async function finishWorkout(context, id) {
  const response = await context.request.post(`/api/workouts/${id}/finish`, {
    data: {},
  });
  const { workout } = await json(response, 'finish workout');
  return workout;
}

export async function seedMeasurement(context, payload) {
  const response = await context.request.post('/api/measurements', {
    data: payload,
  });
  const { measurement } = await json(response, 'create measurement');
  return measurement;
}
