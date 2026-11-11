import { test as base, expect } from '@playwright/test';
import {
  finishWorkout,
  getActiveWorkout,
  loginViaApi,
  resetData,
  seedCatalogExercise,
  seedExercise,
  seedMeasurement,
  seedRoutine,
  seedWorkout,
  startRoutine,
} from './api.js';
import { collectPageErrors, installExternalHostGuard } from './guards.js';

/**
 * The single import specs need. Fixtures:
 *
 * - `login`: signs in through the real dev-login endpoint using the context
 *   request client, so the session cookie is shared with the page.
 * - `reset`: depends on `login` and deletes the user's workouts, routines and
 *   measurements through the public API before the test runs.
 * - `api`: helpers bound to the context request client for seeding data.
 * - console/external guards are automatic and fail the test at teardown.
 */
export const test = base.extend({
  consoleGuard: [
    async ({ page }, use) => {
      const errors = collectPageErrors(page);
      await use(errors);
      expect(errors, 'the page emitted console/page errors').toEqual([]);
    },
    { auto: true },
  ],

  externalHostGuard: [
    async ({ context, baseURL }, use) => {
      const offenders = await installExternalHostGuard(context, baseURL);
      await use(offenders);
      expect(
        offenders,
        'the browser contacted hosts other than the test server'
      ).toEqual([]);
    },
    { auto: true },
  ],

  login: async ({ context }, use) => {
    await loginViaApi(context);
    await use();
  },

  reset: async ({ context, login }, use) => {
    await resetData(context);
    await use();
  },

  api: async ({ context, login }, use) => {
    await use({
      login: () => loginViaApi(context),
      reset: () => resetData(context),
      getActiveWorkout: () => getActiveWorkout(context),
      seedExercise: (name, options) => seedExercise(context, name, options),
      seedCatalogExercise: (catalogId) => seedCatalogExercise(context, catalogId),
      seedRoutine: (payload) => seedRoutine(context, payload),
      seedWorkout: (payload) => seedWorkout(context, payload),
      seedMeasurement: (payload) => seedMeasurement(context, payload),
      startRoutine: (id) => startRoutine(context, id),
      finishWorkout: (id) => finishWorkout(context, id),
    });
  },
});

export { expect };
