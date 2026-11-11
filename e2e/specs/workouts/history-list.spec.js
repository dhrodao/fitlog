import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';

function workoutPayload(name, day, exerciseId) {
  const padded = String(day).padStart(2, '0');
  // Split the fixture across two months so the grouping is exercised too.
  const date = day <= 12 ? `2026-01-${padded}` : `2026-02-${String(day - 12).padStart(2, '0')}`;
  return {
    clientId: uniqueName(`history-${padded}`),
    name,
    startedAt: `${date}T10:00:00.000Z`,
    finishedAt: `${date}T10:30:00.000Z`,
    exercises: [
      {
        exerciseId,
        sets: [{ weightKg: 40, reps: 10, completed: true }],
      },
    ],
  };
}

test.describe('Workout history', () => {
  test('shows an empty state that links to starting a routine', async ({
    login,
    reset,
    page,
  }) => {
    await page.goto('/#/workouts');

    await expect(page.getByRole('heading', { name: 'Historial' })).toBeVisible();
    await expect(page.getByText('Sin entrenamientos')).toBeVisible();
    await expect(
      page.getByText('Cuando termines tu primer entreno aparecerá aquí.')
    ).toBeVisible();

    await page.getByRole('link', { name: /Empezar/ }).click();
    await expect(page).toHaveURL(/#\/routines$/);

    await page.goto('/#/');
    await expect(page.getByText('Sin entrenamientos aún')).toBeVisible();
  });

  test('pages through history in chunks without losing the month grouping', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const exercise = await api.seedExercise(uniqueName('History Press'));
    for (let day = 1; day <= 25; day += 1) {
      await api.seedWorkout(
        workoutPayload(`Entreno ${String(day).padStart(2, '0')}`, day, exercise.id)
      );
    }

    await page.goto('/#/workouts');
    const cards = page.locator('.workout-card');
    await expect(cards).toHaveCount(20);
    await expect(cards.first()).toContainText('Entreno 25');
    await expect(page.locator('.history-month')).toHaveCount(2);
    await expect(page.locator('.history-month-title').first()).toContainText(
      '2026'
    );

    const more = page.locator('[data-more]');
    await expect(more).toBeVisible();
    await more.click();

    await expect(cards).toHaveCount(25);
    await expect(cards.last()).toContainText('Entreno 01');
    await expect(more).toHaveCount(0);
  });

  test('deletes a finished workout from its detail screen', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const exercise = await api.seedExercise(uniqueName('History Delete'));
    const name = uniqueName('Entreno a borrar');
    const workout = await api.seedWorkout(workoutPayload(name, 3, exercise.id));

    await page.goto('/#/workouts');
    await page.locator('.workout-card').filter({ hasText: name }).click();
    await expect(page).toHaveURL(new RegExp(`#/workouts/${workout.id}$`));

    await page.getByRole('button', { name: 'Opciones' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Eliminar entrenamiento' })
      .click();

    const confirm = () =>
      page.getByRole('dialog').filter({
        has: page.getByRole('heading', { name: 'Eliminar entrenamiento' }),
      });
    await expect(confirm()).toBeVisible();
    await confirm().getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`#/workouts/${workout.id}$`));

    await page.getByRole('button', { name: 'Opciones' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Eliminar entrenamiento' })
      .click();
    await confirm().getByRole('button', { name: 'Eliminar', exact: true }).click();

    await expect(page).toHaveURL(/#\/workouts$/);
    await expect(page.getByText('Entrenamiento eliminado')).toBeVisible();
    await expect(page.getByText('Sin entrenamientos')).toBeVisible();

    await page.goto('/#/');
    await expect(page.getByText('Sin entrenamientos aún')).toBeVisible();
  });
});
