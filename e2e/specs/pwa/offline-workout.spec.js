import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';
import {
  addOfflineExercise,
  goOffline,
  goOnline,
  startOfflineWorkout,
  warmOfflineCatalog,
} from '../../fixtures/pwa.js';

async function addOfflineSet(page, name, weight, reps) {
  const block = page
    .locator('[data-exercises] [data-we-id]')
    .filter({ hasText: name });
  await block.locator('[data-add-set]').click();
  const row = block.locator('[data-set-id]').first();
  await row.locator('[data-field="weightKg"]').fill(String(weight));
  await row.locator('[data-field="reps"]').fill(String(reps));
  await row.locator('[data-toggle]').click();
  await expect(row.locator('[data-set-handle]')).toHaveClass(/completed/);
}

test.describe('Offline workout', () => {
  test(
    'builds and finishes offline, then uploads exactly once on reconnect',
    { tag: '@pwa' },
    async ({ login, reset, api, context, page }) => {
      const name = uniqueName('Offline Press');
      await api.seedExercise(name);

      await page.goto('/');
      await expect(
        page.getByRole('heading', { name: 'Atleta', exact: true })
      ).toBeVisible();
      await warmOfflineCatalog(page, context);

      await goOffline(context, page);
      await startOfflineWorkout(page);

      const pill = page.locator('[data-offline-state]');
      await expect(pill).toBeVisible();
      await expect(pill).toHaveText('Sin conexión · se sincronizará');

      await addOfflineExercise(page, name);
      await addOfflineSet(page, name, 42.5, 8);

      await page.locator('[data-finish]').click();
      await expect(
        page.getByText(
          'Entreno guardado localmente; se sincronizará al recuperar la conexión'
        )
      ).toBeVisible();
      await expect(page).toHaveURL(/#\/$/);
      await expect(page.getByText('Sin conexión', { exact: true }).first()).toBeVisible();

      // Nothing reached the server while offline.
      expect(await api.listWorkouts()).toHaveLength(0);

      const uploaded = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith('/api/workouts/sync')
      );
      await goOnline(context, page);
      await uploaded;

      await expect.poll(async () => (await api.listWorkouts()).length).toBe(1);
      const [workout] = await api.listWorkouts();
      expect(workout.name).toBe('Entreno');

      const detailResponse = await context.request.get(
        `/api/workouts/${workout.id}`
      );
      const { workout: detail } = await detailResponse.json();
      expect(detail.exercises).toHaveLength(1);
      expect(detail.exercises[0].name).toBe(name);
      expect(detail.exercises[0].sets).toMatchObject([
        { weightKg: 42.5, reps: 8, completed: true },
      ]);

      // It shows up once in history, and repeated online triggers are no-ops.
      await page.evaluate(() => {
        location.hash = '/workouts';
      });
      await expect(page.locator('.workout-card')).toHaveCount(1);
      await expect(page.locator('.workout-card')).toContainText('Entreno');

      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.reload();
      await expect(page.locator('.workout-card')).toHaveCount(1);
    }
  );

  test(
    'reconnecting mid-workout keeps it active and local instead of finishing it',
    { tag: '@pwa' },
    async ({ login, reset, api, context, page }) => {
      const name = uniqueName('Offline Resume Press');
      const exercise = await api.seedExercise(name);
      await api.seedWorkout({
        clientId: uniqueName('offline-previous'),
        name: uniqueName('Sesión anterior'),
        startedAt: '2026-06-01T10:00:00.000Z',
        finishedAt: '2026-06-01T10:30:00.000Z',
        exercises: [
          {
            exerciseId: exercise.id,
            sets: [{ weightKg: 60, reps: 5, completed: true }],
          },
        ],
      });

      await page.goto('/');
      await expect(
        page.getByRole('heading', { name: 'Atleta', exact: true })
      ).toBeVisible();
      await warmOfflineCatalog(page, context);

      await goOffline(context, page);
      await startOfflineWorkout(page);
      await addOfflineExercise(page, name);
      await addOfflineSet(page, name, 42.5, 8);

      const block = page
        .locator('[data-exercises] [data-we-id]')
        .filter({ hasText: name });
      await expect(block.locator('[data-prev-fill]').first()).toHaveText('—');

      const suggestions = page.waitForResponse((response) =>
        response.url().includes('/api/workouts/suggestions')
      );
      await goOnline(context, page);
      await suggestions;

      // Still editing the same local workout; it was not uploaded or finished.
      await expect(page).toHaveURL(/#\/workout\/active$/);
      await expect(page.locator('[data-title]')).toHaveText('Entreno');
      await expect(block.locator('[data-prev-fill]').first()).toHaveText(
        '60kg × 5'
      );
      expect(await api.listWorkouts()).toHaveLength(1);
      await expect(page.locator('[data-offline-state]')).toBeVisible();
    }
  );
});
