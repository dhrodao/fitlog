import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';

async function seedDetail(api) {
  const press = await api.seedExercise(uniqueName('Detail Press'));
  const row = await api.seedExercise(uniqueName('Detail Row'));
  const name = uniqueName('Entreno detallado');
  const workout = await api.seedWorkout({
    clientId: uniqueName('detail'),
    name,
    location: 'Gimnasio Centro',
    notes: 'Buenas sensaciones',
    startedAt: '2026-02-10T18:00:00.000Z',
    finishedAt: '2026-02-10T19:00:00.000Z',
    exercises: [
      {
        exerciseId: press.id,
        sets: [
          { weightKg: 60, reps: 8, completed: true },
          { weightKg: 65, reps: 6, completed: true },
        ],
      },
      {
        exerciseId: row.id,
        sets: [{ weightKg: 40, reps: 10, completed: true }],
      },
    ],
  });
  return { workout, name, press, row };
}

test.describe('Finished workout detail', () => {
  test('shows the summary, location, notes and every logged set', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const { workout, name, press, row } = await seedDetail(api);

    await page.goto(`/#/workouts/${workout.id}`);

    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.getByText('Gimnasio Centro')).toBeVisible();
    await expect(page.getByText('Buenas sensaciones')).toBeVisible();
    const setsStat = page.locator('.summary-hero .stat').filter({
      hasText: 'Series',
    });
    await expect(setsStat).toContainText('3');

    const exercises = page.locator('.detail-exercise');
    await expect(exercises).toHaveCount(2);
    const pressBlock = exercises.filter({ hasText: press.name });
    await expect(pressBlock).toContainText('60kg × 8');
    await expect(pressBlock).toContainText('65kg × 6');
    await expect(exercises.filter({ hasText: row.name })).toContainText(
      '40kg × 10'
    );
  });

  test('edits name, location and notes, then removes an exercise with confirmation', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const { workout, name, press, row } = await seedDetail(api);
    const editedName = uniqueName('Entreno editado');

    await page.goto(`/#/workouts/${workout.id}`);
    await page.getByRole('button', { name: 'Opciones' }).click();
    await page.getByText('Editar entrenamiento').click();
    await expect(
      page.locator('.topbar-title', { hasText: 'Editar entrenamiento' })
    ).toBeVisible();

    const saveField = async (field, value) => {
      const response = page.waitForResponse(
        (r) =>
          r.request().method() === 'PATCH' &&
          new URL(r.url()).pathname === `/api/workouts/${workout.id}`
      );
      const input = page.locator(`[data-input="${field}"]`);
      await input.fill(value);
      await input.blur();
      const request = (await response).request();
      expect(request.postDataJSON()).toMatchObject({ [field]: value });
    };

    await saveField('name', editedName);
    await saveField('location', 'Casa');
    await saveField('notes', 'Notas nuevas');

    const exercises = page.locator('[data-exercises] [data-we-id]');
    await expect(exercises).toHaveCount(2);
    await exercises
      .filter({ hasText: row.name })
      .getByRole('button', { name: 'Eliminar ejercicio' })
      .click();

    let dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Eliminar ejercicio' })
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(exercises).toHaveCount(2);

    const removed = page.waitForResponse(
      (r) =>
        r.request().method() === 'DELETE' &&
        /\/api\/workouts\/[^/]+\/exercises\/[^/]+$/.test(
          new URL(r.url()).pathname
        )
    );
    await exercises
      .filter({ hasText: row.name })
      .getByRole('button', { name: 'Eliminar ejercicio' })
      .click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await removed;

    await expect(exercises).toHaveCount(1);
    const pressBlock = exercises.filter({ hasText: press.name });
    await expect(pressBlock).toHaveCount(1);

    // Deleting a single set stays immediate (no confirmation).
    const setsBefore = await pressBlock.locator('[data-set-id]').count();
    const setDeleted = page.waitForResponse(
      (r) =>
        r.request().method() === 'DELETE' &&
        /\/api\/workouts\/[^/]+\/sets\/[^/]+$/.test(new URL(r.url()).pathname)
    );
    await pressBlock.locator('[data-delete-set]').first().click();
    await setDeleted;
    await expect(pressBlock.locator('[data-set-id]')).toHaveCount(setsBefore - 1);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'Listo' }).click();
    await expect(page.getByRole('heading', { name: editedName })).toBeVisible();
    await expect(page.getByText('Casa')).toBeVisible();
    await expect(page.getByText('Notas nuevas')).toBeVisible();
    await expect(page.locator('.detail-exercise')).toHaveCount(1);
    await expect(page.locator('.detail-exercise')).toContainText(press.name);

    await page.reload();
    await expect(page.getByRole('heading', { name: editedName })).toBeVisible();
    await expect(page.getByText('Casa')).toBeVisible();
    await expect(page.getByText('Notas nuevas')).toBeVisible();
    await expect(page.locator('.detail-exercise')).toHaveCount(1);

    await page.goto('/#/workouts');
    await expect(
      page.locator('.workout-card').filter({ hasText: editedName })
    ).toBeVisible();
  });
});
