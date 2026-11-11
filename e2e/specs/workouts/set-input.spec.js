import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';
import {
  addExerciseFromPicker,
  completeSet,
  exerciseBlocks,
  fillSetFieldAndWait,
  repsInput,
  startEmptyWorkout,
  weightInput,
} from '../../fixtures/workout-actions.js';

async function startWithExercise(page, api, name) {
  await api.seedExercise(name);
  await startEmptyWorkout(page);
  await addExerciseFromPicker(page, name);
  return exerciseBlocks(page).filter({ hasText: name }).locator('[data-set-id]').first();
}

test.describe('Numeric input on the active workout', () => {
  test('flags invalid weight and clamps negative reps', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const name = uniqueName('Input Press');
    let firstSet = await startWithExercise(page, api, name);

    await weightInput(firstSet).fill('5kg');
    await expect(weightInput(firstSet)).toHaveClass(/input-error/);

    // Invalid input is never persisted.
    await page.reload();
    firstSet = exerciseBlocks(page)
      .filter({ hasText: name })
      .locator('[data-set-id]')
      .first();
    await expect(weightInput(firstSet)).toHaveValue('');

    // Negative reps are clamped to zero and saved as such.
    const write = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        /\/sets\/\d+$/.test(new URL(response.url()).pathname)
    );
    await repsInput(firstSet).fill('-3');
    await write;
    await expect(repsInput(firstSet)).toHaveValue('0');

    await page.reload();
    firstSet = exerciseBlocks(page)
      .filter({ hasText: name })
      .locator('[data-set-id]')
      .first();
    await expect(repsInput(firstSet)).toHaveValue('0');
  });

  test('accepts a decimal comma and a decimal point', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const name = uniqueName('Decimal Press');
    let firstSet = await startWithExercise(page, api, name);

    await fillSetFieldAndWait(page, weightInput(firstSet), '72,5');
    await page.reload();
    firstSet = exerciseBlocks(page)
      .filter({ hasText: name })
      .locator('[data-set-id]')
      .first();
    await expect(weightInput(firstSet)).toHaveValue('72.5');

    await fillSetFieldAndWait(page, weightInput(firstSet), '72.5');
    await fillSetFieldAndWait(page, repsInput(firstSet), '8');
    await completeSet(page, firstSet);
    await expect(page.locator('[data-stat-volume]')).toHaveText('580 kg');

    await page.reload();
    firstSet = exerciseBlocks(page)
      .filter({ hasText: name })
      .locator('[data-set-id]')
      .first();
    await expect(weightInput(firstSet)).toHaveValue('72.5');
    await expect(repsInput(firstSet)).toHaveValue('8');
    await expect(page.locator('[data-stat-volume]')).toHaveText('580 kg');
  });
});
