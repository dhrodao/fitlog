import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';

test.describe('Deep navigation', () => {
  test('browser back and forward keep the routine views in step', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const exercise = await api.seedExercise(uniqueName('Back Press'));
    const routine = await api.seedRoutine({
      name: uniqueName('Routine Back'),
      exercises: [{ exerciseId: exercise.id, targetSets: 3 }],
    });
    const detail = new RegExp(`#\\/routines\\/${routine.id}$`);

    await page.goto('/#/routines');
    await expect(
      page.getByRole('heading', { name: 'Entrenamiento', exact: true })
    ).toBeVisible();

    await page.locator(`[data-open-routine="${routine.id}"]`).click();
    await expect(page).toHaveURL(detail);
    await expect(
      page.getByRole('heading', { name: routine.name })
    ).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/#\/routines$/);
    await expect(
      page.getByRole('heading', { name: 'Entrenamiento', exact: true })
    ).toBeVisible();
    await expect(
      page.locator(`[data-open-routine="${routine.id}"]`)
    ).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(detail);
    await expect(
      page.getByRole('heading', { name: routine.name })
    ).toBeVisible();
  });

  test('invalid targets render their own empty states', async ({
    login,
    reset,
    page,
  }) => {
    await page.goto('/#/workouts/999999');
    await expect(
      page.getByRole('heading', { name: 'No se pudo cargar el entrenamiento' })
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Volver' })).toBeVisible();

    await page.goto('/#/workout/active');
    await expect(
      page.getByRole('heading', { name: 'No hay entrenamiento activo' })
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Ir a entrenamientos/ })
    ).toBeVisible();
  });

  test('reloading a deep route restores the same screen with its data', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const exercise = await api.seedExercise(uniqueName('Reload Press'));
    const workoutName = uniqueName('Entreno Recarga');
    const workout = await api.seedWorkout({
      clientId: uniqueName('reload-workout'),
      name: workoutName,
      startedAt: '2026-06-01T10:00:00.000Z',
      finishedAt: '2026-06-01T10:30:00.000Z',
      exercises: [
        {
          exerciseId: exercise.id,
          sets: [{ weightKg: 50, reps: 10, completed: true }],
        },
      ],
    });
    const routine = await api.seedRoutine({
      name: uniqueName('Routine Reload'),
      exercises: [{ exerciseId: exercise.id, targetSets: 2 }],
    });
    await api.startRoutine(routine.id);

    await page.goto(`/#/workouts/${workout.id}`);
    await expect(page.getByRole('heading', { name: workoutName })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: workoutName })).toBeVisible();

    await page.goto(`/#/routines/${routine.id}`);
    await expect(
      page.getByRole('heading', { name: routine.name })
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('heading', { name: routine.name })
    ).toBeVisible();

    await page.goto('/#/exercises');
    await expect(page.locator('.topbar-title')).toHaveText('Ejercicios');
    await page.reload();
    await expect(page.locator('.topbar-title')).toHaveText('Ejercicios');

    await page.goto('/#/workout/active');
    await expect(page.locator('[data-add-exercise]')).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-add-exercise]')).toBeVisible();
    await expect(page.locator('[data-exercises]')).toContainText(exercise.name);
  });
});
