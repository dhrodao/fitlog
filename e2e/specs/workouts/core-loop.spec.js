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

test.describe('Core workout loop', () => {
  test(
    'logging and finishing a workout keeps detail, history and home in agreement',
    { tag: '@smoke' },
    async ({ login, reset, api, page }) => {
      const name = uniqueName('Core Press');
      await api.seedExercise(name);

      await startEmptyWorkout(page);
      await addExerciseFromPicker(page, name);

      const block = exerciseBlocks(page).filter({ hasText: name });
      const firstSet = block.locator('[data-set-id]').first();
      await fillSetFieldAndWait(page, weightInput(firstSet), '60');
      await fillSetFieldAndWait(page, repsInput(firstSet), '8');
      await completeSet(page, firstSet);

      await expect(page.locator('[data-stat-sets]')).toHaveText('1');
      await expect(page.locator('[data-stat-volume]')).toHaveText('480 kg');

      const finished = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          /\/finish$/.test(new URL(response.url()).pathname)
      );
      await page.locator('[data-finish]').click();
      await finished;

      await expect(page.getByText('¡Entrenamiento guardado!')).toBeVisible();
      await expect(page).toHaveURL(/#\/workouts\/\d+$/);
      const match = page.url().match(/#\/workouts\/(\d+)$/);
      const workoutId = Number(match[1]);

      // Finished workout detail shows the totals.
      await expect(page.locator('.summary-hero h1')).toHaveText('Entreno');
      await expect(page.locator('.summary-hero')).toContainText('480 kg');
      await expect(page.locator('.summary-hero .stat .value').nth(2)).toHaveText('1');

      // History lists the same workout with the same numbers.
      await page.goto('/#/workouts');
      const historyCard = page.locator(`[data-link="/workouts/${workoutId}"]`);
      await expect(historyCard).toBeVisible();
      await expect(historyCard).toContainText('480 kg');
      await expect(historyCard).toContainText('1 series');

      // Home's recent list agrees and the active banner is gone.
      await page.goto('/#/');
      const homeCard = page.locator(`[data-link="/workouts/${workoutId}"]`);
      await expect(homeCard).toBeVisible();
      await expect(homeCard).toContainText('480 kg');
      await expect(page.getByText('Entrenamiento en curso')).toHaveCount(0);
      await expect(page.locator('[data-start]')).toBeVisible();
    }
  );
});
