import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';
import {
  addExerciseFromPicker,
  addSet,
  completeSet,
  exerciseBlocks,
  startEmptyWorkout,
} from '../../fixtures/workout-actions.js';

test.describe('Rest timer', () => {
  test('counts down, extends, skips and stays disabled after a reload', async ({
    login,
    reset,
    api,
    page,
  }) => {
    await page.clock.install();

    const name = uniqueName('Rest Press');
    await api.seedExercise(name);
    await startEmptyWorkout(page);
    await addExerciseFromPicker(page, name);

    let block = exerciseBlocks(page).filter({ hasText: name });
    let rows = block.locator('[data-set-id]');
    const rest = page.locator('[data-rest-timer]');
    const count = page.locator('[data-rest-count]');
    const toggle = page.locator('[data-rest-toggle]');

    await completeSet(page, rows.first());
    await expect(rest).toBeVisible();
    await expect(count).toHaveText('1:30');

    await page.clock.fastForward(5_000);
    await expect(count).toHaveText('1:25');

    await page.locator('[data-rest-add]').click();
    await expect(count).toHaveText('1:40');

    await page.locator('[data-rest-skip]').click();
    await expect(rest).toBeHidden();

    // Turning it off means later completions start no countdown.
    await expect(toggle).toHaveClass(/active/);
    await toggle.click();
    await expect(toggle).not.toHaveClass(/active/);
    await expect(page.getByText('Temporizador de descanso desactivado')).toBeVisible();

    await addSet(page, block);
    await completeSet(page, rows.nth(1));
    await expect(rest).toBeHidden();

    // The preference survives a reload.
    await page.reload();
    await expect(toggle).not.toHaveClass(/active/);
    block = exerciseBlocks(page).filter({ hasText: name });
    rows = block.locator('[data-set-id]');
    await addSet(page, block);
    await completeSet(page, rows.last());
    await expect(rest).toBeHidden();
  });
});
