import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';
import {
  addExerciseFromPicker,
  completeSet,
  exerciseBlocks,
  openExerciseMenu,
  startEmptyWorkout,
} from '../../fixtures/workout-actions.js';

test.describe('One active workout at a time', () => {
  test('starting again reopens the existing workout instead of creating another', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const exercise = await api.seedExercise(uniqueName('Active Rule Press'));
    const routine = await api.seedRoutine({
      name: uniqueName('Active Rule Routine'),
      exercises: [{ exerciseId: exercise.id, targetSets: 2 }],
    });

    await startEmptyWorkout(page);
    const original = await api.getActiveWorkout();
    expect(original).not.toBeNull();

    await page.goto('/#/routines');
    await page.locator('[data-start-empty]').click();
    await expect(page).toHaveURL(/#\/workout\/active$/);

    await page.goto('/#/routines');
    await page.locator(`[data-start-routine="${routine.id}"]`).click();
    await expect(page).toHaveURL(/#\/workout\/active$/);

    const stillActive = await api.getActiveWorkout();
    expect(stillActive.id).toBe(original.id);

    // The home banner opens the same workout.
    await page.goto('/#/');
    await page.locator('[data-open-active]').click();
    await expect(page).toHaveURL(/#\/workout\/active$/);
    await expect(page.locator('[data-title]')).toHaveText(original.name);
  });
});

test.describe('Removing an exercise from the active workout', () => {
  test('deletes it immediately and updates the totals', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const keep = uniqueName('Keep Press');
    const remove = uniqueName('Remove Press');
    await api.seedExercise(keep);
    await api.seedExercise(remove);

    await startEmptyWorkout(page);
    await addExerciseFromPicker(page, remove);
    await addExerciseFromPicker(page, keep);

    const removeBlock = exerciseBlocks(page).filter({ hasText: remove });
    await completeSet(page, removeBlock.locator('[data-set-id]').first());
    await expect(page.locator('[data-stat-sets]')).toHaveText('1');

    const sheet = await openExerciseMenu(page, remove);
    const deleted = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        /\/exercises\/\d+$/.test(new URL(response.url()).pathname)
    );
    await sheet.getByRole('button', { name: 'Eliminar Ejercicio' }).click();
    await deleted;

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(exerciseBlocks(page)).toHaveCount(1);
    await expect(page.locator('[data-exercises]')).toContainText(keep);
    await expect(page.locator('[data-exercises]')).not.toContainText(remove);
    await expect(page.locator('[data-stat-sets]')).toHaveText('0');
  });
});
