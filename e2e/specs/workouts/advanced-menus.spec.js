import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';
import {
  addExercisesFromPicker,
  exerciseBlocks,
  openExerciseMenu,
  pickExerciseInOpenPicker,
  startEmptyWorkout,
  waitForPickerCatalogLoad,
} from '../../fixtures/workout-actions.js';

async function startWithThreeExercises(page, api) {
  const names = [
    uniqueName('Menu Press A'),
    uniqueName('Menu Press B'),
    uniqueName('Menu Press C'),
  ];
  for (const name of names) await api.seedExercise(name);
  await startEmptyWorkout(page);
  await addExercisesFromPicker(page, names);
  return names;
}

const blockOrder = (page) => exerciseBlocks(page).locator('.name').allTextContents();

test.describe('Reordering exercises', () => {
  test('persists the new order after saving', async ({ login, reset, api, page }) => {
    const [a, b, c] = await startWithThreeExercises(page, api);
    expect(await blockOrder(page)).toEqual([a, b, c]);

    const sheet = await openExerciseMenu(page, a);
    await sheet.getByRole('button', { name: 'Reordenar Ejercicios' }).click();

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Reordenar ejercicios' })
    ).toBeVisible();

    // Move the last exercise to the top.
    await dialog.locator('[data-reorder-index="2"] [data-reorder-dir="up"]').click();
    await dialog.locator('[data-reorder-index="1"] [data-reorder-dir="up"]').click();

    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        /\/exercises\/order$/.test(new URL(response.url()).pathname)
    );
    await dialog.getByRole('button', { name: 'Guardar orden' }).click();
    await saved;

    await expect(page.getByText('Orden actualizado')).toBeVisible();
    await expect.poll(() => blockOrder(page)).toEqual([c, a, b]);

    await page.reload();
    await expect.poll(() => blockOrder(page)).toEqual([c, a, b]);
  });
});

test.describe('Supersets', () => {
  test('adds two exercises to a superset and removes it again', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const [a, b] = await startWithThreeExercises(page, api);
    const bId = await exerciseBlocks(page)
      .filter({ hasText: b })
      .getAttribute('data-we-id');

    const sheet = await openExerciseMenu(page, a);
    await sheet.getByRole('button', { name: 'Agregar a Superserie' }).click();

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Agregar a superserie' })
    ).toBeVisible();

    const added = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/superset$/.test(new URL(response.url()).pathname)
    );
    await dialog.locator(`[data-superset-pick="${bId}"]`).click();
    await added;

    await expect(page.locator('[data-exercises] .superset-chip')).toHaveCount(2);

    const menu = await openExerciseMenu(page, a);
    const removed = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        /\/superset$/.test(new URL(response.url()).pathname)
    );
    await menu.getByRole('button', { name: 'Quitar de Superserie' }).click();
    await removed;

    await expect(page.locator('[data-exercises] .superset-chip')).toHaveCount(0);
  });
});

test.describe('Replacing an exercise', () => {
  test('swaps the exercise and keeps the workout editable', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const [a] = await startWithThreeExercises(page, api);
    const spare = uniqueName('Menu Press Spare');
    await api.seedExercise(spare);

    const sheet = await openExerciseMenu(page, a);
    const initialCatalogLoad = waitForPickerCatalogLoad(page);
    await sheet.getByRole('button', { name: 'Reemplazar Ejercicio' }).click();
    await initialCatalogLoad;
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: 'Reemplazar ejercicio' })
    ).toBeVisible();

    const replaced = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/replace$/.test(new URL(response.url()).pathname)
    );
    await pickExerciseInOpenPicker(page, spare);
    await replaced;

    await expect(page.getByText(`${spare} reemplazado`)).toBeVisible();
    await expect(page.locator('[data-exercises]')).toContainText(spare);
    await expect(page.locator('[data-exercises]')).not.toContainText(a);
    await expect(page.locator('[data-add-exercise]')).toBeVisible();
  });
});
