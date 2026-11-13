import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';
import {
  addOfflineExercise,
  goOffline,
  startOfflineWorkout,
  waitForServiceWorkerControl,
  warmOfflineCatalog,
} from '../../fixtures/pwa.js';

test.describe('Offline cold start', () => {
  test(
    'reopens for the last user and keeps an in-progress workout reachable',
    { tag: '@pwa' },
    async ({ login, reset, api, context, page }) => {
      const name = uniqueName('Cold Offline Press');
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

      // Warm the offline caches and leave a workout in progress on this device.
      await warmOfflineCatalog(page, context);
      await goOffline(context, page);
      await startOfflineWorkout(page);
      await addOfflineExercise(page, name);

      await page.evaluate(() => {
        location.hash = '/';
      });
      await expect(
        page.getByRole('heading', { name: 'Atleta', exact: true })
      ).toBeVisible();

      // A full reload with no network is a cold boot served by the worker.
      await page.reload();

      await expect(
        page.getByRole('heading', { name: 'Atleta', exact: true })
      ).toBeVisible();
      await expect(
        page.getByRole('navigation', { name: 'Navegación principal' })
      ).toBeVisible();
      await expect(page.locator('[data-dev-login]')).toHaveCount(0);
      await expect(
        page.getByText(
          'Tus estadísticas e historial aparecerán cuando vuelvas a estar en línea.'
        )
      ).toBeVisible();

      // The local workout is still reachable and editable.
      await expect(page.getByText('Entrenamiento en curso')).toBeVisible();
      await page.locator('[data-open-active]').click();
      await expect(page).toHaveURL(/#\/workout\/active$/);
      await expect(page.locator('[data-offline-state]')).toBeVisible();
      await expect(page.locator('[data-exercises]')).toContainText(name);
    }
  );
});
