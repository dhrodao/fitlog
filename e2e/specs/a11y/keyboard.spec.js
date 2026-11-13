import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';
import {
  addExerciseFromPicker,
  exerciseBlocks,
  isSetWriteResponse,
  saveIndicator,
  startEmptyWorkout,
} from '../../fixtures/workout-actions.js';

test.describe('Keyboard accessibility', () => {
  test('a confirmation dialog takes focus and Escape cancels it', async ({
    login,
    page,
  }) => {
    await page.goto('/#/profile');
    const trigger = page.getByRole('button', { name: 'Cerrar sesión' });
    await trigger.focus();

    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement))
    ).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/#\/profile$/);
    await expect(page.getByText('Hasta pronto')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('logs and completes a set using only the keyboard', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const name = uniqueName('Keyboard Press');
    await api.seedExercise(name);
    await startEmptyWorkout(page);
    await addExerciseFromPicker(page, name);

    const row = exerciseBlocks(page)
      .filter({ hasText: name })
      .locator('[data-set-id]')
      .first();
    const weight = row.getByLabel('Peso en kg');
    const reps = row.getByLabel('Repeticiones');
    const toggle = row.getByRole('button', { name: 'Completar serie' });

    await expect(weight).toBeVisible();
    await expect(reps).toBeVisible();
    await expect(toggle).toBeVisible();

    // Start from the previous-set helper and move forward with Tab only. It is
    // the element immediately before the weight input in the set row.
    await row.locator('[data-prev-fill]').focus();

    await page.keyboard.press('Tab');
    await expect(weight).toBeFocused();
    const weightWrite = page.waitForResponse(isSetWriteResponse);
    await page.keyboard.type('60');
    await weightWrite;
    await expect(saveIndicator(page)).toBeHidden();

    await page.keyboard.press('Tab');
    await expect(reps).toBeFocused();
    const repsWrite = page.waitForResponse(isSetWriteResponse);
    await page.keyboard.type('8');
    await repsWrite;
    await expect(saveIndicator(page)).toBeHidden();

    await page.keyboard.press('Tab');
    await expect(toggle).toBeFocused();
    const completedWrite = page.waitForResponse(isSetWriteResponse);
    await page.keyboard.press('Space');
    await completedWrite;

    await expect(row.locator('[data-set-handle]')).toHaveClass(/completed/);
    await expect(page.locator('[data-stat-volume]')).toHaveText('480 kg');
  });
});
