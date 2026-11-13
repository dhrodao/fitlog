import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';
import {
  finishOfflineWorkout,
  goOffline,
  goOnline,
  waitForServiceWorkerControl,
  warmOfflineCatalog,
} from '../../fixtures/pwa.js';

const LOST_WARNING =
  'Tienes un entrenamiento pendiente que se perderá si cierras sesión. ¿Quieres salir igualmente?';
const UPLOAD_NOTICE =
  'Se subirá el entrenamiento pendiente antes de cerrar sesión. ¿Quieres salir?';

/** Signs in, primes the offline caches and leaves a finished-offline workout. */
async function prepareFinishedOfflineWorkout({ api, context, page }, name) {
  await api.seedExercise(name);

  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Atleta', exact: true })
  ).toBeVisible();
  await waitForServiceWorkerControl(page);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Atleta', exact: true })
  ).toBeVisible();

  await warmOfflineCatalog(page, context);
  await goOffline(context, page);
  await finishOfflineWorkout(page, name);
  await expect(page).toHaveURL(/#\/$/);
  // Wait for the home render to settle before navigating again; the router
  // discards stale work but an in-flight view can still finish painting.
  await expect(
    page.getByRole('heading', { name: 'Atleta', exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(
      'Tus estadísticas e historial aparecerán cuando vuelvas a estar en línea.'
    )
  ).toBeVisible();
}

async function openProfile(page) {
  await page.evaluate(() => {
    location.hash = '/profile';
  });
  await expect(
    page.getByRole('heading', { name: 'Información' })
  ).toBeVisible();
}

test.describe('Logout with a pending offline workout', () => {
  test(
    'logging out online uploads the pending workout before leaving',
    { tag: '@pwa' },
    async ({ login, reset, api, context, page }) => {
      const name = uniqueName('Logout Upload Press');
      await prepareFinishedOfflineWorkout({ api, context, page }, name);

      // Make the automatic reconnect upload fail once so the workout stays
      // pending long enough to reach the logout path.
      let aborted = 0;
      const blockFirstSync = async (route) => {
        if (route.request().method() === 'POST' && aborted === 0) {
          aborted += 1;
          return route.abort();
        }
        return route.continue();
      };
      await page.route('**/api/workouts/sync', blockFirstSync);

      await goOnline(context, page);
      await expect.poll(() => aborted).toBe(1);
      expect(await api.listWorkouts()).toHaveLength(0);
      await page.unroute('**/api/workouts/sync', blockFirstSync);

      await openProfile(page);
      await page.locator('[data-logout]').click();

      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText(UPLOAD_NOTICE)).toBeVisible();
      await dialog.getByRole('button', { name: 'Cerrar sesión' }).click();
      await expect(page).toHaveURL(/#\/login$/);

      await api.login();
      await expect.poll(async () => (await api.listWorkouts()).length).toBe(1);
    }
  );

  test(
    'cancelling the warning keeps the pending workout',
    { tag: '@pwa' },
    async ({ login, reset, api, context, page }) => {
      const name = uniqueName('Logout Cancel Press');
      await prepareFinishedOfflineWorkout({ api, context, page }, name);

      await openProfile(page);
      await page.locator('[data-logout]').click();

      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText(LOST_WARNING)).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancelar' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(
        page.getByRole('navigation', { name: 'Navegación principal' })
      ).toBeVisible();

      const uploaded = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith('/api/workouts/sync')
      );
      await goOnline(context, page);
      await uploaded;
      await expect.poll(async () => (await api.listWorkouts()).length).toBe(1);
    }
  );

  test(
    'confirming the warning discards the local workout for good',
    { tag: '@pwa' },
    async ({ login, reset, api, context, page }) => {
      const name = uniqueName('Logout Discard Press');
      await prepareFinishedOfflineWorkout({ api, context, page }, name);

      await openProfile(page);
      await page.locator('[data-logout]').click();

      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText(LOST_WARNING)).toBeVisible();
      await dialog.getByRole('button', { name: 'Cerrar sesión' }).click();
      await expect(page).toHaveURL(/#\/login$/);

      // Reconnecting must not upload the discarded workout later.
      await goOnline(context, page);
      await api.login();
      expect(await api.listWorkouts()).toHaveLength(0);

      await page.goto('/');
      await expect(
        page.getByRole('heading', { name: 'Atleta', exact: true })
      ).toBeVisible();
      await expect(page.getByText('Entrenamiento en curso')).toHaveCount(0);
      await expect(page.getByText('Sin entrenamientos aún')).toBeVisible();
    }
  );
});
