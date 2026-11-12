import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';
import { dragLocator } from '../../fixtures/touch.js';
import {
  addExerciseFromPicker,
  completeSet,
  exerciseBlocks,
  fillSetFieldAndWait,
  repsInput,
  startEmptyWorkout,
  weightInput,
} from '../../fixtures/workout-actions.js';

async function startWithTwoCompletedSets(page, api, prefix) {
  const name = uniqueName(prefix);
  await api.seedExercise(name);
  await startEmptyWorkout(page);
  await addExerciseFromPicker(page, name);

  const block = exerciseBlocks(page).filter({ hasText: name });
  const rows = block.locator('[data-set-id]');
  const total = await rows.count();

  await fillSetFieldAndWait(page, weightInput(rows.nth(0)), '50');
  await fillSetFieldAndWait(page, repsInput(rows.nth(0)), '10');
  await completeSet(page, rows.nth(0));
  await fillSetFieldAndWait(page, weightInput(rows.nth(1)), '40');
  await fillSetFieldAndWait(page, repsInput(rows.nth(1)), '5');
  await completeSet(page, rows.nth(1));

  await expect(page.locator('[data-stat-sets]')).toHaveText('2');
  await expect(page.locator('[data-stat-volume]')).toHaveText('700 kg');
  return { rows, total };
}

test.describe('Swipe to delete a set', () => {
  test(
    'dragging a set row left deletes it and updates the totals',
    { tag: '@mobile' },
    async ({ login, reset, api, page }) => {
      const { rows, total } = await startWithTwoCompletedSets(page, api, 'Swipe Press');
      const firstRow = rows.first();
      const handle = firstRow.locator('[data-set-handle]');

      const deleted = page.waitForResponse(
        (response) =>
          response.request().method() === 'DELETE' &&
          /\/sets\/\d+$/.test(new URL(response.url()).pathname)
      );
      await dragLocator(page, handle, {
        dx: -180,
        start: { x: 0.05, y: 0.5 },
      });
      const response = await deleted;
      expect(response.ok()).toBeTruthy();

      await expect(rows).toHaveCount(total - 1);
      await expect(page.locator('[data-stat-sets]')).toHaveText('1');
      await expect(page.locator('[data-stat-volume]')).toHaveText('200 kg');
    }
  );

  test(
    'a failed delete springs the row back and reports the error',
    { tag: '@mobile' },
    async ({ login, reset, api, page }) => {
      await page.route('**/api/workouts/*/sets/*', (route) => {
        if (route.request().method() !== 'DELETE') return route.fallback();
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'fallo temporal' }),
        });
      });

      const { rows, total } = await startWithTwoCompletedSets(page, api, 'Swipe Fail');
      const handle = rows.first().locator('[data-set-handle]');

      await dragLocator(page, handle, {
        dx: -180,
        start: { x: 0.05, y: 0.5 },
      });

      await expect(page.locator('.toast.error')).toBeVisible();
      await expect(rows).toHaveCount(total);
      await expect
        .poll(() => handle.evaluate((element) => element.style.transform))
        .toBe('translateX(0px)');
    }
  );
});
