async function request(path, { method = 'GET', body, signal } = {}) {
  const options = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal,
  };

  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`/api${path}`, options);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    const offline = new Error('Sin conexión con el servidor');
    offline.status = 0;
    throw offline;
  }

  const data = await response
    .json()
    .catch(() => ({ error: 'Respuesta no válida del servidor' }));

  if (!response.ok) {
    const error = new Error(data.error || `Error ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export const api = {
  auth: {
    config: () => request('/auth/config'),
    me: () => request('/auth/me'),
    logout: () => request('/auth/logout', { method: 'POST' }),
    dev: () => request('/auth/dev', { method: 'POST' }),
    google: (credential) =>
      request('/auth/google', { method: 'POST', body: { credential } }),
  },
  exercises: {
    search: (query = '', category = '') => {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (category) params.set('category', category);
      return request(`/exercises/search?${params}`);
    },
    categories: () => request('/exercises/categories'),
    mine: (query = '') =>
      request(`/exercises/mine?q=${encodeURIComponent(query)}`),
    custom: (payload) =>
      request('/exercises/custom', { method: 'POST', body: payload }),
    fromCatalog: (catalogId) =>
      request('/exercises/from-catalog', {
        method: 'POST',
        body: { catalogId },
      }),
    catalog: (id) => request(`/exercises/catalog/${encodeURIComponent(id)}`),
    status: () => request('/exercises/status'),
    sync: () => request('/exercises/sync', { method: 'POST', body: {} }),
  },
  routines: {
    list: () => request('/routines'),
    detail: (id, period = '3m') => request(`/routines/${id}?period=${period}`),
    create: (payload) => request('/routines', { method: 'POST', body: payload }),
    update: (id, payload) =>
      request(`/routines/${id}`, { method: 'PUT', body: payload }),
    remove: (id) => request(`/routines/${id}`, { method: 'DELETE' }),
    duplicate: (id) =>
      request(`/routines/${id}/duplicate`, { method: 'POST', body: {} }),
    start: (id) =>
      request(`/routines/${id}/start`, { method: 'POST', body: {} }),
  },
  workouts: {
    list: (limit = 20, offset = 0) =>
      request(`/workouts?limit=${limit}&offset=${offset}`),
    active: () => request('/workouts/active'),
    detail: (id) => request(`/workouts/${id}`),
    create: (payload = {}) =>
      request('/workouts', { method: 'POST', body: payload }),
    update: (id, payload) =>
      request(`/workouts/${id}`, { method: 'PATCH', body: payload }),
    finish: (id, payload = {}) =>
      request(`/workouts/${id}/finish`, { method: 'POST', body: payload }),
    remove: (id) => request(`/workouts/${id}`, { method: 'DELETE' }),
    addExercise: (id, payload) =>
      request(`/workouts/${id}/exercises`, { method: 'POST', body: payload }),
    updateExercise: (id, weId, payload) =>
      request(`/workouts/${id}/exercises/${weId}`, {
        method: 'PATCH',
        body: payload,
      }),
    removeExercise: (id, weId) =>
      request(`/workouts/${id}/exercises/${weId}`, { method: 'DELETE' }),
    reorderExercises: (id, exerciseIds) =>
      request(`/workouts/${id}/exercises/order`, {
        method: 'PUT',
        body: { exerciseIds },
      }),
    addToSuperset: (id, weId, otherWorkoutExerciseId) =>
      request(`/workouts/${id}/exercises/${weId}/superset`, {
        method: 'POST',
        body: { otherWorkoutExerciseId },
      }),
    removeFromSuperset: (id, weId) =>
      request(`/workouts/${id}/exercises/${weId}/superset`, {
        method: 'DELETE',
      }),
    replaceExercise: (id, weId, payload) =>
      request(`/workouts/${id}/exercises/${weId}/replace`, {
        method: 'POST',
        body: payload,
      }),
    addSet: (id, weId, payload = {}) =>
      request(`/workouts/${id}/exercises/${weId}/sets`, {
        method: 'POST',
        body: payload,
      }),
    updateSet: (id, setId, payload) =>
      request(`/workouts/${id}/sets/${setId}`, {
        method: 'PATCH',
        body: payload,
      }),
    removeSet: (id, setId) =>
      request(`/workouts/${id}/sets/${setId}`, { method: 'DELETE' }),
  },
  measurements: {
    list: () => request('/measurements'),
    save: (payload) =>
      request('/measurements', { method: 'POST', body: payload }),
    remove: (id) => request(`/measurements/${id}`, { method: 'DELETE' }),
  },
  stats: {
    overview: (period = '3m') => request(`/stats/overview?period=${period}`),
    exercise: (id) => request(`/stats/exercise/${id}`),
  },
  import: {
    hevyCsv: (csv, write = false) =>
      request('/import/hevy/csv', { method: 'POST', body: { csv, write } }),
    hevyApi: (apiKey, write = false) =>
      request('/import/hevy/api', { method: 'POST', body: { apiKey, write } }),
  },
  hevySync: {
    status: () => request('/import/hevy/sync'),
    connect: (apiKey, autoSync = true) =>
      request('/import/hevy/sync/connect', {
        method: 'POST',
        body: { apiKey, autoSync },
      }),
    setAuto: (autoSync) =>
      request('/import/hevy/sync', { method: 'PATCH', body: { autoSync } }),
    run: (full = false) =>
      request('/import/hevy/sync/run', { method: 'POST', body: { full } }),
    disconnect: () => request('/import/hevy/sync', { method: 'DELETE' }),
  },
};

export function errorMessage(error) {
  if (error?.status === 401) return 'Tu sesión ha caducado. Vuelve a entrar.';
  if (error?.status === 0) return 'No hay conexión con el servidor';
  return error?.message || 'Algo salió mal';
}
