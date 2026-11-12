import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';
import {
  addOfflineExercise,
  goOffline,
  startOfflineWorkout,
  warmOfflineCatalog,
} from '../../fixtures/pwa.js';

test.describe('Server-only actions while offline', () => {
  test(
    'reorder, replace, superset and new routine degrade with a clear message',
    { tag: '@pwa' },
    async ({ login, reset, api, context, page }) => {
      const first = uniqueName('Offline Limit A');
      const second = uniqueName('Offline Limit B');
      await api.seedExercise(first);
      await api.seedExercise(second);

      await page.goto('/');
      await expect(
        page.getByRole('heading', { name: 'Atleta', exact: true })
      ).toBeVisible();
      await warmOfflineCatalog(page, context);

      await goOffline(context, page);
      await startOfflineWorkout(page);
      await addOfflineExercise(page, first);
      await addOfflineExercise(page, second);

      const notAvailable = page.getByText('No disponible sin conexión', {
        exact: true,
      });
      const block = page
        .locator('[data-exercises] [data-we-id]')
        .filter({ hasText: first });

      for (const label of [
        'Reordenar Ejercicios',
        'Reemplazar Ejercicio',
        'Agregar a Superserie',
      ]) {
        await block.locator('[data-exercise-menu]').click();
        await page
          .getByRole('dialog')
          .getByRole('button', { name: label })
          .click();
        await expect(notAvailable.last()).toBeVisible();
        // Let the toast clear so the next one is unambiguous.
        await expect(notAvailable).toHaveCount(0, { timeout: 5000 });
      }

      // The workout is untouched by the refused actions.
      await expect(page.locator('[data-exercises]')).toContainText(first);
      await expect(page.locator('[data-exercises]')).toContainText(second);

      await page.evaluate(() => {
        location.hash = '/routines';
      });
      await page.locator('[data-new-routine]').first().click();
      await expect(
        page.getByText('Necesitas conexión para crear una rutina')
      ).toBeVisible();
      await expect(page).toHaveURL(/#\/routines$/);
      await expect(page.locator('[data-start-empty]')).toBeVisible();
    }
  );
});
