import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';

test.describe('Exercise detail from a finished workout', () => {
  test('shows progression, every session and the catalog guide', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const exercise = await api.seedCatalogExercise('e2e-chest-01');

    await api.seedWorkout({
      clientId: uniqueName('detail-history-1'),
      name: uniqueName('Sesión 1'),
      startedAt: '2026-05-01T10:00:00.000Z',
      finishedAt: '2026-05-01T10:30:00.000Z',
      exercises: [
        {
          exerciseId: exercise.id,
          sets: [{ weightKg: 60, reps: 8, completed: true }],
        },
      ],
    });
    const latest = await api.seedWorkout({
      clientId: uniqueName('detail-history-2'),
      name: uniqueName('Sesión 2'),
      startedAt: '2026-05-08T10:00:00.000Z',
      finishedAt: '2026-05-08T10:30:00.000Z',
      exercises: [
        {
          exerciseId: exercise.id,
          sets: [{ weightKg: 65, reps: 6, completed: true }],
        },
      ],
    });

    await page.goto(`/#/workouts/${latest.id}`);
    await page
      .locator('[data-exercise-detail]')
      .filter({ hasText: exercise.name })
      .click();

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: exercise.name })
    ).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Resumen' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(dialog.locator('[data-chart] svg')).toBeVisible();
    await expect(dialog.locator('.pr-grid')).toContainText('Peso máximo');
    await expect(dialog.locator('.pr-grid')).toContainText('65 kg');

    await dialog.getByRole('tab', { name: 'Historial' }).click();
    await expect(dialog.getByRole('tab', { name: 'Historial' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    const sessions = dialog.locator('.hist-session');
    await expect(sessions).toHaveCount(2);
    await expect(sessions.first()).toContainText('65 kg × 6');
    await expect(sessions.last()).toContainText('60 kg × 8');

    await dialog.getByRole('tab', { name: 'Indicaciones' }).click();
    await expect(dialog.getByText('Músculos')).toBeVisible();
    await expect(dialog.getByText('Pecho', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Equipamiento')).toBeVisible();
    await expect(dialog.getByText('Barra', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Cómo hacerlo')).toBeVisible();
    await expect(dialog.getByText('Press de pecho.')).toBeVisible();
  });
});
