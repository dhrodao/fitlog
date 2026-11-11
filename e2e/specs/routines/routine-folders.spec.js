import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';

test.describe('Routine empty states', () => {
  test('shows the empty list call to action and the empty routine preview', async ({
    login,
    reset,
    api,
    page,
  }) => {
    await page.goto('/#/routines');
    await expect(
      page.getByRole('heading', { name: 'Entrenamiento', exact: true })
    ).toBeVisible();
    await expect(page.getByText('Aún no tienes rutinas')).toBeVisible();
    await expect(
      page.locator('.empty').getByRole('button', { name: 'Nueva rutina' })
    ).toBeVisible();

    const routine = await api.seedRoutine({
      name: uniqueName('Routine Empty'),
      exercises: [],
    });

    await page.reload();
    const card = page
      .locator('.routine-card')
      .filter({ hasText: routine.name });
    await expect(card).toContainText('Sin ejercicios todavía');
    await expect(card).toContainText('0 ejercicios');

    await card.locator('[data-open-routine]').click();
    await expect(page).toHaveURL(new RegExp(`#/routines/${routine.id}$`));
    await expect(
      page.getByRole('heading', { name: routine.name })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Rutina vacía' })
    ).toBeVisible();
    await expect(
      page.getByText('Edita la rutina para añadir ejercicios.')
    ).toBeVisible();
  });
});

test.describe('Routine folders', () => {
  test('groups by folder and keeps a collapsed folder closed after reload', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const exercise = await api.seedExercise(uniqueName('Folder Press'));
    await api.seedRoutine({
      name: uniqueName('Folder Push'),
      folder: 'Empuje',
      exercises: [{ exerciseId: exercise.id, targetSets: 2 }],
    });
    await api.seedRoutine({
      name: uniqueName('Folder Pull'),
      folder: 'Tirón',
      exercises: [{ exerciseId: exercise.id, targetSets: 2 }],
    });
    await api.seedRoutine({
      name: uniqueName('Folder Default'),
      exercises: [{ exerciseId: exercise.id, targetSets: 2 }],
    });

    await page.goto('/#/routines');
    await expect(
      page.getByRole('heading', { name: 'Entrenamiento', exact: true })
    ).toBeVisible();

    expect(
      await page.locator('.folder .folder-head .grow').allTextContents()
    ).toEqual(['Empuje', 'Tirón', 'Mis rutinas']);

    const push = page.locator('[data-folder="Empuje"]');
    await push.locator('[data-folder-toggle]').click();
    await expect(push).toHaveClass(/closed/);

    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Entrenamiento', exact: true })
    ).toBeVisible();
    await expect(page.locator('[data-folder="Empuje"]')).toHaveClass(/closed/);
    await expect(page.locator('[data-folder="Tirón"]')).not.toHaveClass(
      /closed/
    );
  });
});
