import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';

test.describe('Accessible semantics', () => {
  test('form fields are associated with their labels', async ({
    login,
    reset,
    api,
    page,
  }) => {
    await page.goto('/#/measurements');
    const weight = page.getByLabel('Peso (kg)');
    await expect(weight).toBeVisible();
    await expect(page.getByLabel('Fecha')).toBeVisible();
    await expect(page.getByLabel('Grasa (%)')).toBeVisible();
    await expect(page.getByLabel('Cintura (cm)')).toBeVisible();
    await expect(page.getByLabel('Nota')).toBeVisible();
    await page.getByText('Peso (kg)', { exact: true }).click();
    await expect(weight).toBeFocused();

    const exercise = await api.seedExercise(uniqueName('Semantics'));
    const routine = await api.seedRoutine({
      name: uniqueName('Routine Semantics'),
      exercises: [{ exerciseId: exercise.id, targetSets: 3 }],
    });
    await page.goto(`/#/routines/${routine.id}/edit`);
    const routineName = page.getByLabel('Nombre');
    await expect(routineName).toBeVisible();
    await expect(page.getByLabel('Carpeta (opcional)')).toBeVisible();
    await expect(page.getByLabel('Descripción (opcional)')).toBeVisible();
    await expect(page.getByLabel('Series')).toBeVisible();
    await expect(page.getByLabel('Reps objetivo')).toBeVisible();
    await page.getByText('Nombre', { exact: true }).click();
    await expect(routineName).toBeFocused();

    const workout = await api.seedWorkout({
      clientId: uniqueName('semantics'),
      name: uniqueName('Entreno Semantics'),
      startedAt: '2026-02-10T18:00:00.000Z',
      finishedAt: '2026-02-10T19:00:00.000Z',
      exercises: [
        {
          exerciseId: exercise.id,
          sets: [{ weightKg: 40, reps: 10, completed: true }],
        },
      ],
    });
    await page.goto(`/#/workouts/${workout.id}`);
    await page.getByRole('button', { name: 'Opciones' }).click();
    await page.getByText('Editar entrenamiento').click();
    await expect(
      page.locator('.topbar-title', { hasText: 'Editar entrenamiento' })
    ).toBeVisible();
    const notes = page.getByLabel('Notas (opcional)');
    await expect(page.getByLabel('Nombre')).toBeVisible();
    await expect(page.getByLabel('Ubicación (opcional)')).toBeVisible();
    await expect(notes).toBeVisible();
    await page.getByText('Notas (opcional)', { exact: true }).click();
    await expect(notes).toBeFocused();
  });

  test('toasts are announced through a polite status region', async ({
    login,
    reset,
    page,
  }) => {
    await page.goto('/#/measurements');
    await page.getByLabel('Peso (kg)').fill('71');
    await page.locator('[data-save]').click();

    const status = page.getByRole('status').filter({ hasText: 'Medida guardada' });
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute('aria-live', 'polite');
  });
});
