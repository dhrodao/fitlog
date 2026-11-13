import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';

async function seedWorkoutForEditing(api) {
  const exercise = await api.seedExercise(uniqueName('Edit Numeric Press'));
  const workout = await api.seedWorkout({
    clientId: uniqueName('edit-numeric'),
    name: uniqueName('Entreno numérico'),
    startedAt: '2026-02-10T18:00:00.000Z',
    finishedAt: '2026-02-10T19:00:00.000Z',
    exercises: [
      {
        exerciseId: exercise.id,
        sets: [{ weightKg: 60, reps: 8, completed: true }],
      },
    ],
  });
  return { workout, exercise };
}

test.describe('Finished workout numeric edits', () => {
  test('applies the active screen numeric rules while editing a workout', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const { workout } = await seedWorkoutForEditing(api);

    await page.goto(`/#/workouts/${workout.id}`);
    await page.getByRole('button', { name: 'Opciones' }).click();
    await page.getByText('Editar entrenamiento').click();

    const row = page.locator('[data-exercises] [data-set-id]').first();
    const weight = row.getByLabel('Peso en kg');
    const reps = row.getByLabel('Repeticiones');

    const setPatch = () =>
      page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          /\/api\/workouts\/[^/]+\/sets\/[^/]+$/.test(
            new URL(response.url()).pathname
          )
      );

    const editField = async (input, value, expected) => {
      const response = setPatch();
      await input.fill(value);
      await input.blur();
      const request = (await response).request();
      expect(request.postDataJSON()).toMatchObject(expected);
    };

    await editField(weight, '72.5', { weightKg: 72.5 });
    await editField(weight, '72,5', { weightKg: 72.5 });

    let setPatches = 0;
    const countPatches = (request) => {
      if (
        request.method() === 'PATCH' &&
        /\/api\/workouts\/[^/]+\/sets\/[^/]+$/.test(
          new URL(request.url()).pathname
        )
      ) {
        setPatches += 1;
      }
    };
    page.on('request', countPatches);

    await weight.fill('5kg');
    await weight.blur();
    await expect(weight).toHaveClass(/input-error/);
    const afterInvalid = await page.request.get(`/api/workouts/${workout.id}`);
    const stored = (await afterInvalid.json()).workout.exercises[0].sets[0];
    expect(stored.weightKg).toBe(72.5);
    expect(setPatches).toBe(0);

    await editField(weight, '-3', { weightKg: 0 });
    await expect(weight).toHaveValue('0');

    await editField(reps, '8.4', { reps: 8 });
    await expect(reps).toHaveValue('8');

    page.off('request', countPatches);

    await editField(weight, '72,5', { weightKg: 72.5 });

    await page.getByRole('button', { name: 'Listo' }).click();
    await expect(page.getByRole('heading', { name: workout.name })).toBeVisible();
    const volume = page.locator('.summary-hero .stat').filter({
      hasText: 'Volumen',
    });
    await expect(volume).toContainText('580 kg');
    const sets = page.locator('.summary-hero .stat').filter({ hasText: 'Series' });
    await expect(sets).toContainText('1');

    await page.reload();
    await expect(volume).toContainText('580 kg');

    await page.getByRole('button', { name: 'Opciones' }).click();
    await page.getByText('Editar entrenamiento').click();
    const editedRow = page.locator('[data-exercises] [data-set-id]').first();
    await expect(editedRow.getByLabel('Peso en kg')).toHaveValue('72.5');
    await expect(editedRow.getByLabel('Repeticiones')).toHaveValue('8');
  });
});
