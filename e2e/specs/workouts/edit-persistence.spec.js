import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';
import {
  addExerciseFromPicker,
  exerciseBlocks,
  fillSetFieldAndWait,
  isSetWriteResponse,
  repsInput,
  saveIndicator,
  startEmptyWorkout,
  weightInput,
} from '../../fixtures/workout-actions.js';

async function startWithExercise(page, api, name) {
  await api.seedExercise(name);
  await startEmptyWorkout(page);
  await addExerciseFromPicker(page, name);
  return exerciseBlocks(page).filter({ hasText: name });
}

test.describe('Editing sets while a workout is active', () => {
  test('edits survive a reload and do not show a saving notice', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const name = uniqueName('Persist Press');
    const block = await startWithExercise(page, api, name);
    const firstSet = block.locator('[data-set-id]').first();

    await fillSetFieldAndWait(page, weightInput(firstSet), '50');
    await fillSetFieldAndWait(page, repsInput(firstSet), '10');
    await expect(saveIndicator(page)).toBeHidden();

    await page.reload();

    const reloadedSet = exerciseBlocks(page)
      .filter({ hasText: name })
      .locator('[data-set-id]')
      .first();
    await expect(weightInput(reloadedSet)).toHaveValue('50');
    await expect(repsInput(reloadedSet)).toHaveValue('10');
    await expect(saveIndicator(page)).toBeHidden();
  });

  test('an edit made just before leaving is flushed instead of dropped', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const name = uniqueName('Flush Press');
    const block = await startWithExercise(page, api, name);
    const firstSet = block.locator('[data-set-id]').first();

    const write = page.waitForResponse(isSetWriteResponse);
    await weightInput(firstSet).fill('42');
    await page
      .getByRole('navigation', { name: 'Navegación principal' })
      .getByRole('link', { name: 'Inicio' })
      .click();
    await write;

    await expect(page).toHaveURL(/#\/$/);
    await page.goto('/#/workout/active');

    const reloadedSet = exerciseBlocks(page)
      .filter({ hasText: name })
      .locator('[data-set-id]')
      .first();
    await expect(weightInput(reloadedSet)).toHaveValue('42');
  });
});
