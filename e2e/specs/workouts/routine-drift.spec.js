import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';
import {
  completeSet,
  exerciseBlocks,
  pickExerciseInOpenPicker,
  waitForPickerCatalogLoad,
} from '../../fixtures/workout-actions.js';

async function driftWorkout(page, api) {
  const original = await api.seedExercise(uniqueName('Drift Original'));
  const spare = await api.seedExercise(uniqueName('Drift Spare'));
  const routine = await api.seedRoutine({
    name: uniqueName('Rutina drift'),
    exercises: [{ exerciseId: original.id, targetSets: 2 }],
  });
  const workout = await api.startRoutine(routine.id);

  await page.goto('/#/workout/active');
  await completeSet(page, page.locator('[data-set-id]').first());

  const block = exerciseBlocks(page).filter({ hasText: original.name });
  await block.locator('[data-exercise-menu]').click();
  const sheet = page.getByRole('dialog');
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
  await pickExerciseInOpenPicker(page, spare.name);
  await replaced;
  await expect(page.locator('[data-exercises]')).toContainText(spare.name);

  return { routine, workout, original, spare };
}

function waitForFinish(page) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/workouts\/[^/]+\/finish$/.test(new URL(response.url()).pathname)
  );
}

async function routineExerciseNames(page, routineId) {
  const response = await page.request.get(`/api/routines/${routineId}`);
  expect(response.ok()).toBe(true);
  const { routine } = await response.json();
  return routine.exercises.map((item) => item.exercise.name);
}

test.describe('Finishing a workout after changing its routine exercises', () => {
  test('keeps the original routine when the workout is detached', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const { routine, original, spare } = await driftWorkout(page, api);

    const finished = waitForFinish(page);
    await page.getByRole('button', { name: 'Terminar entrenamiento' }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Has modificado la rutina' })
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Mantener original' }).click();
    const request = (await finished).request();
    expect(request.postDataJSON()).toMatchObject({ routineAction: 'detach' });

    await expect(page).toHaveURL(/#\/workouts\/\d+$/);
    await page.getByRole('button', { name: 'Opciones' }).click();
    const menu = page.getByRole('dialog');
    await expect(menu.getByText('Ver rutina')).toHaveCount(0);
    await menu.getByRole('button', { name: 'Cerrar' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    expect(await routineExerciseNames(page, routine.id)).toEqual([original.name]);
    await expect(page.locator('.detail-exercise')).toContainText(spare.name);
  });

  test('overwrites the routine with the workout exercises when chosen', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const { routine, original, spare } = await driftWorkout(page, api);

    const finished = waitForFinish(page);
    await page.getByRole('button', { name: 'Terminar entrenamiento' }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Has modificado la rutina' })
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Sobreescribir rutina' }).click();
    const request = (await finished).request();
    expect(request.postDataJSON()).toMatchObject({ routineAction: 'overwrite' });

    await expect(page).toHaveURL(/#\/workouts\/\d+$/);
    await page.getByRole('button', { name: 'Opciones' }).click();
    const menu = page.getByRole('dialog');
    await expect(menu.getByText('Ver rutina')).toBeVisible();
    await menu.getByRole('button', { name: 'Cerrar' }).click();

    expect(await routineExerciseNames(page, routine.id)).toEqual([spare.name]);
    await expect(page.locator('.detail-exercise')).toContainText(spare.name);
    await expect(page.locator('.detail-exercise')).not.toContainText(
      original.name
    );
  });

  test('keeps the workout active when the user cancels the dialog', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const { workout, routine, original } = await driftWorkout(page, api);

    await page.getByRole('button', { name: 'Terminar entrenamiento' }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Has modificado la rutina' })
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/workout\/active$/);
    const active = await api.getActiveWorkout();
    expect(active?.id).toBe(workout.id);
    expect(await routineExerciseNames(page, routine.id)).toEqual([original.name]);
  });

  test('finishes without a dialog when the routine structure is unchanged', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const original = await api.seedExercise(uniqueName('Drift Control'));
    const routine = await api.seedRoutine({
      name: uniqueName('Rutina estable'),
      exercises: [{ exerciseId: original.id, targetSets: 2 }],
    });
    const workout = await api.startRoutine(routine.id);

    await page.goto('/#/workout/active');
    await completeSet(page, page.locator('[data-set-id]').first());

    const finished = waitForFinish(page);
    await page.getByRole('button', { name: 'Terminar entrenamiento' }).click();
    const request = (await finished).request();
    expect(request.postDataJSON()?.routineAction).toBeUndefined();

    await expect(page).toHaveURL(new RegExp(`#/workouts/${workout.id}$`));
    await page.getByRole('button', { name: 'Opciones' }).click();
    const menu = page.getByRole('dialog');
    await expect(menu.getByText('Ver rutina')).toBeVisible();
    await menu.getByRole('button', { name: 'Cerrar' }).click();

    expect(await routineExerciseNames(page, routine.id)).toEqual([original.name]);
  });
});
