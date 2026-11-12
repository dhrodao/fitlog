import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';
import {
  addExerciseFromPicker,
  exerciseBlocks,
  startEmptyWorkout,
} from '../../fixtures/workout-actions.js';

async function assertHittable(page, selector, message) {
  const locator = page.locator(selector);
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box, message).not.toBeNull();
  const hit = await page.evaluate(
    ({ x, y, target }) =>
      document.elementFromPoint(x, y)?.closest(target) != null,
    {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      target: selector,
    }
  );
  expect(hit, message).toBe(true);
}

const key = (page, name) => page.locator(`.keypad [data-key="${name}"]`);

test.describe('Core loop on a phone viewport', () => {
  test(
    'logs and finishes a workout with the touch keypad',
    { tag: '@mobile' },
    async ({ login, reset, api, page }) => {
      const name = uniqueName('Mobile Press');
      await api.seedExercise(name);

      await startEmptyWorkout(page);
      await addExerciseFromPicker(page, name);

      const row = exerciseBlocks(page)
        .filter({ hasText: name })
        .locator('[data-set-id]')
        .first();

      await row.locator('[data-field="weightKg"]').tap();
      await expect(page.locator('.keypad')).toHaveClass(/open/);
      for (const digit of ['6', '0']) await key(page, digit).tap();
      await key(page, 'action').tap();
      await expect(row.locator('[data-field="reps"]')).toBeFocused();
      await key(page, '8').tap();
      await key(page, 'action').tap();

      await expect(row.locator('[data-toggle]')).toHaveClass(/checked/);
      await expect(page.locator('[data-stat-sets]')).toHaveText('1');
      await expect(page.locator('[data-stat-volume]')).toHaveText('480 kg');

      // Completing a set leaves the keypad ready on the next one; hide it
      // before checking that the fixed bars do not cover the next actions.
      await key(page, 'hide').tap();
      await expect(page.locator('.keypad')).not.toHaveClass(/open/);

      // The rest bar and the bottom navigation must not cover the actions the
      // user needs next.
      await expect(page.locator('[data-rest-timer]')).toBeVisible();
      await assertHittable(
        page,
        '[data-finish]',
        'the finish button is reachable above the overlays'
      );
      await assertHittable(
        page,
        '[data-add-exercise]',
        'the add-exercise button is reachable above the bottom navigation'
      );

      const finished = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          /\/finish$/.test(new URL(response.url()).pathname)
      );
      await page.locator('[data-finish]').tap();
      await finished;

      await expect(page.getByText('¡Entrenamiento guardado!')).toBeVisible();
      await expect(page).toHaveURL(/#\/workouts\/\d+$/);
      await expect(page.locator('.summary-hero')).toContainText('480 kg');
      await expect(page.locator('.summary-hero .stat .value').nth(2)).toHaveText('1');
    }
  );
});
