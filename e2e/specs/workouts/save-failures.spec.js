import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';
import {
  addExerciseFromPicker,
  completeSet,
  exerciseBlocks,
  fillSetFieldAndWait,
  isSetWriteResponse,
  repsInput,
  saveIndicator,
  startEmptyWorkout,
  weightInput,
} from '../../fixtures/workout-actions.js';

async function startWithExercise(page, api, prefix) {
  const name = uniqueName(prefix);
  await api.seedExercise(name);
  await startEmptyWorkout(page);
  await addExerciseFromPicker(page, name);
  const block = exerciseBlocks(page).filter({ hasText: name });
  return { name, block, row: block.locator('[data-set-id]').first() };
}

test.describe('Active workout write failures', () => {
  test('a failing set write keeps retrying, reports the error and recovers', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const { row } = await startWithExercise(page, api, 'Fail Writes');

    await page.route('**/api/workouts/*/sets/*', (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'No se pudo guardar la serie' }),
      });
    });

    await repsInput(row).fill('12');
    const indicator = saveIndicator(page);
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveText('Reintentando guardar…');

    await expect(
      page.getByText('No se pudo guardar la serie')
    ).toBeVisible({ timeout: 20_000 });

    await page.unroute('**/api/workouts/*/sets/*');
    const recovered = page.waitForResponse(isSetWriteResponse);
    await weightInput(row).fill('30');
    await recovered;
    await expect(indicator).toBeHidden();

    await page.reload();
    const firstSet = exerciseBlocks(page)
      .locator('[data-set-id]')
      .first();
    await expect(weightInput(firstSet)).toHaveValue('30');
    await expect(repsInput(firstSet)).toHaveValue('12');
  });

  test('a failing finish keeps the user editing and the button usable', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const { row } = await startWithExercise(page, api, 'Fail Finish');
    await fillSetFieldAndWait(page, weightInput(row), '40');
    await fillSetFieldAndWait(page, repsInput(row), '8');
    await completeSet(page, row);

    await page.route('**/api/workouts/*/finish', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'No se pudo terminar el entrenamiento' }),
      });
    });

    const finish = page.getByRole('button', {
      name: 'Terminar entrenamiento',
    });
    await finish.click();

    await expect(
      page.getByText('No se pudo terminar el entrenamiento')
    ).toBeVisible();
    await expect(page).toHaveURL(/#\/workout\/active$/);
    await expect(finish).toBeEnabled();

    await page.unroute('**/api/workouts/*/finish');
    await finish.click();
    await expect(page).toHaveURL(/#\/workouts\/\d+$/);
  });
});
