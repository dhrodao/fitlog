import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';
import {
  addExerciseFromPicker,
  addSet,
  exerciseBlocks,
  fillSetFieldAndWait,
  isSetWriteResponse,
  repsInput,
  startEmptyWorkout,
  weightInput,
} from '../../fixtures/workout-actions.js';

async function seedHistoryAndStart(page, api) {
  const name = uniqueName('Prev Press');
  const exercise = await api.seedExercise(name);
  await api.seedWorkout({
    clientId: uniqueName('prev-history'),
    name: uniqueName('Sesión anterior'),
    startedAt: '2026-03-01T10:00:00.000Z',
    finishedAt: '2026-03-01T10:40:00.000Z',
    exercises: [
      {
        exerciseId: exercise.id,
        sets: [
          { weightKg: 60, reps: 8, completed: true },
          { weightKg: 65, reps: 6, completed: true },
        ],
      },
    ],
  });

  await startEmptyWorkout(page);
  await addExerciseFromPicker(page, name);
  return { name, block: exerciseBlocks(page).filter({ hasText: name }) };
}

async function completeFromToggle(page, row) {
  const write = page.waitForResponse(isSetWriteResponse);
  await row.locator('[data-toggle]').click();
  const request = (await write).request();
  await expect(row.locator('[data-set-handle]')).toHaveClass(/completed/);
  return request.postDataJSON();
}

test.describe('Previous session suggestions', () => {
  test('shows each previous set as a placeholder and fills it on tap', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const { name, block } = await seedHistoryAndStart(page, api);
    const rows = block.locator('[data-set-id]');
    const prevButtons = block.locator('[data-prev-fill]');
    await expect(rows).toHaveCount(3);

    await expect(prevButtons.nth(0)).toHaveText('60kg × 8');
    await expect(prevButtons.nth(1)).toHaveText('65kg × 6');
    // A set beyond the previous session repeats its last set.
    await expect(prevButtons.nth(2)).toHaveText('65kg × 6');

    const first = rows.nth(0);
    await expect(weightInput(first)).toHaveAttribute('placeholder', '60');
    await expect(repsInput(first)).toHaveAttribute('placeholder', '8');

    const firstWrite = page.waitForResponse(isSetWriteResponse);
    await prevButtons.nth(0).click();
    const firstRequest = (await firstWrite).request();
    expect(firstRequest.postDataJSON()).toMatchObject({
      weightKg: 60,
      reps: 8,
    });
    await expect(weightInput(first)).toHaveValue('60');
    await expect(repsInput(first)).toHaveValue('8');

    const second = rows.nth(1);
    const secondWrite = page.waitForResponse(isSetWriteResponse);
    await prevButtons.nth(1).click();
    await secondWrite;
    await expect(weightInput(second)).toHaveValue('65');
    await expect(repsInput(second)).toHaveValue('6');

    await addSet(page, block);
    await expect(rows).toHaveCount(4);
    await expect(prevButtons.nth(3)).toHaveText('65kg × 6');
  });

  test('completing an empty set copies history and keeps explicit values', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const { name, block } = await seedHistoryAndStart(page, api);
    const rows = block.locator('[data-set-id]');

    const first = await completeFromToggle(page, rows.nth(0));
    expect(first).toMatchObject({ weightKg: 60, reps: 8, completed: true });
    await expect(weightInput(rows.nth(0))).toHaveValue('60');
    await expect(repsInput(rows.nth(0))).toHaveValue('8');

    const second = await completeFromToggle(page, rows.nth(1));
    expect(second).toMatchObject({ weightKg: 65, reps: 6 });

    // Only the missing field is copied; a typed weight is never overwritten.
    const third = rows.nth(2);
    await fillSetFieldAndWait(page, weightInput(third), '70');
    const thirdCompletion = await completeFromToggle(page, third);
    expect(thirdCompletion).toMatchObject({ weightKg: 70, reps: 6 });
    await expect(weightInput(third)).toHaveValue('70');
    await expect(repsInput(third)).toHaveValue('6');

    // An explicit 0 is a real value, so it is preserved too.
    await addSet(page, block);
    const fourth = rows.nth(3);
    await fillSetFieldAndWait(page, weightInput(fourth), '0');
    const fourthCompletion = await completeFromToggle(page, fourth);
    expect(fourthCompletion).toMatchObject({ weightKg: 0, reps: 6 });
    await expect(weightInput(fourth)).toHaveValue('0');
    await expect(repsInput(fourth)).toHaveValue('6');

    // Copied values are persisted, not just painted.
    await page.reload();
    const reloaded = exerciseBlocks(page)
      .filter({ hasText: name })
      .locator('[data-set-id]');
    await expect(reloaded).toHaveCount(4);
    await expect(weightInput(reloaded.nth(0))).toHaveValue('60');
    await expect(repsInput(reloaded.nth(0))).toHaveValue('8');
    await expect(weightInput(reloaded.nth(3))).toHaveValue('0');
    await expect(repsInput(reloaded.nth(3))).toHaveValue('6');

    // An exercise with no prior sessions has nothing to copy.
    const fresh = uniqueName('Prev Fresh');
    await api.seedExercise(fresh);
    await addExerciseFromPicker(page, fresh);
    const freshBlock = exerciseBlocks(page).filter({ hasText: fresh });
    const freshRow = freshBlock.locator('[data-set-id]').first();
    await expect(freshBlock.locator('[data-prev-fill]').first()).toHaveText('—');
    const freshCompletion = await completeFromToggle(page, freshRow);
    expect(freshCompletion).toMatchObject({ weightKg: null, reps: null });
    await expect(weightInput(freshRow)).toHaveValue('');
    await expect(repsInput(freshRow)).toHaveValue('');
  });
});
