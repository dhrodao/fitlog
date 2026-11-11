import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';
import {
  exerciseBlocks,
  pickExerciseInOpenPicker,
  waitForPickerCatalogLoad,
} from '../../fixtures/workout-actions.js';

test.describe('Creating a routine', () => {
  test('saves the name, folder and a picked exercise and lists it under its folder', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const exercise = await api.seedExercise(uniqueName('Routine Press'));
    const name = uniqueName('Routine Creation');

    await page.goto('/#/routines');
    await page.locator('[data-new-routine]').last().click();
    await expect(page).toHaveURL(/#\/routines\/new$/);

    await page.locator('[data-input="name"]').fill(name);
    await page.locator('[data-input="folder"]').fill('Empuje');

    const initialCatalogLoad = waitForPickerCatalogLoad(page);
    await page.locator('[data-add]').click();
    const sheet = page.getByRole('dialog');
    await initialCatalogLoad;
    await expect(
      sheet.getByRole('heading', { name: 'Añadir ejercicio' })
    ).toBeVisible();
    await pickExerciseInOpenPicker(page, exercise.name);
    await expect(page.locator('[data-list]')).toContainText(exercise.name);

    const created = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/api\/routines$/.test(new URL(response.url()).pathname)
    );
    await page.locator('[data-save]').click();
    await created;

    await expect(page.getByText('Rutina guardada')).toBeVisible();
    await expect(page).toHaveURL(/#\/routines\/\d+$/);
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.locator('.routine-exercise')).toContainText(
      exercise.name
    );

    await page.goto('/#/routines');
    const folder = page.locator('[data-folder="Empuje"]');
    await expect(folder).toContainText(name);
    await expect(folder).toContainText('1 ejercicios');
  });
});

test.describe('Starting a workout from a routine', () => {
  test('opens the active screen with both exercises and their target sets', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const first = await api.seedExercise(uniqueName('Routine Start A'));
    const second = await api.seedExercise(uniqueName('Routine Start B'));
    const routine = await api.seedRoutine({
      name: uniqueName('Routine Start'),
      exercises: [
        { exerciseId: first.id, targetSets: 4 },
        { exerciseId: second.id, targetSets: 2 },
      ],
    });

    await page.goto('/#/routines');
    await page.locator(`[data-start-routine="${routine.id}"]`).click();
    await expect(page).toHaveURL(/#\/workout\/active$/);

    const blocks = exerciseBlocks(page);
    await expect(blocks).toHaveCount(2);
    await expect(
      blocks.filter({ hasText: first.name }).locator('[data-set-id]')
    ).toHaveCount(4);
    await expect(
      blocks.filter({ hasText: second.name }).locator('[data-set-id]')
    ).toHaveCount(2);

    const started = await api.getActiveWorkout();
    expect(started).not.toBeNull();

    await page.goto('/#/routines');
    await page.locator(`[data-start-routine="${routine.id}"]`).click();
    await expect(page).toHaveURL(/#\/workout\/active$/);

    const stillActive = await api.getActiveWorkout();
    expect(stillActive.id).toBe(started.id);
  });
});

test.describe('Duplicating a routine', () => {
  test('creates an editable copy with the same exercises', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const exercise = await api.seedExercise(uniqueName('Routine Dup Press'));
    const routine = await api.seedRoutine({
      name: uniqueName('Routine Dup'),
      exercises: [{ exerciseId: exercise.id, targetSets: 2 }],
    });

    await page.goto('/#/routines');
    await page.locator(`[data-routine-menu="${routine.id}"]`).click();
    const sheet = page.getByRole('dialog');
    await expect(
      sheet.getByRole('heading', { name: routine.name })
    ).toBeVisible();

    const duplicated = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/duplicate$/.test(new URL(response.url()).pathname)
    );
    await sheet.getByRole('button', { name: /Duplicar/ }).click();
    await duplicated;

    await expect(page.getByText('Rutina duplicada')).toBeVisible();
    const copy = page
      .locator('.routine-card')
      .filter({ hasText: `${routine.name} (copia)` });
    await expect(copy).toBeVisible();
    await expect(copy).toContainText('1 ejercicios');
  });
});

test.describe('Deleting a routine', () => {
  test('asks for confirmation and keeps past workouts from it', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const exercise = await api.seedExercise(uniqueName('Routine Del Press'));
    const routine = await api.seedRoutine({
      name: uniqueName('Routine Del'),
      exercises: [{ exerciseId: exercise.id, targetSets: 2 }],
    });
    const workout = await api.startRoutine(routine.id);
    await api.finishWorkout(workout.id);

    await page.goto('/#/routines');
    const card = page.locator(`[data-open-routine="${routine.id}"]`);
    await expect(card).toBeVisible();

    await page.locator(`[data-routine-menu="${routine.id}"]`).click();
    await page.getByRole('button', { name: 'Eliminar' }).click();
    let dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Eliminar rutina' })
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(card).toBeVisible();

    await page.locator(`[data-routine-menu="${routine.id}"]`).click();
    await page.getByRole('button', { name: 'Eliminar' }).click();
    dialog = page.getByRole('dialog');
    const removed = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        /\/api\/routines\/\d+$/.test(new URL(response.url()).pathname)
    );
    await dialog.getByRole('button', { name: 'Eliminar' }).click();
    await removed;

    await expect(page.getByText('Rutina eliminada')).toBeVisible();
    await expect(card).toHaveCount(0);

    await page.goto('/#/workouts');
    await expect(
      page.locator(`[data-link="/workouts/${workout.id}"]`)
    ).toBeVisible();
  });
});
