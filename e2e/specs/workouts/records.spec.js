import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';
import {
  addExerciseFromPicker,
  completeSet,
  exerciseBlocks,
  fillSetFieldAndWait,
  isSetWriteResponse,
  repsInput,
  startEmptyWorkout,
  weightInput,
} from '../../fixtures/workout-actions.js';

test.describe('Personal records while training', () => {
  test('flags the record set live and keeps it on the finished workout', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const name = uniqueName('Record Press');
    const exercise = await api.seedExercise(name);
    await api.seedWorkout({
      clientId: uniqueName('record-history'),
      name: uniqueName('Sesión previa'),
      startedAt: '2026-04-01T10:00:00.000Z',
      finishedAt: '2026-04-01T10:30:00.000Z',
      exercises: [
        {
          exerciseId: exercise.id,
          sets: [{ weightKg: 60, reps: 5, completed: true }],
        },
      ],
    });

    await startEmptyWorkout(page);
    await addExerciseFromPicker(page, name);
    const rows = exerciseBlocks(page)
      .filter({ hasText: name })
      .locator('[data-set-id]');

    // Below the previous weight and estimated max: not a record.
    const first = rows.nth(0);
    await fillSetFieldAndWait(page, weightInput(first), '50');
    await fillSetFieldAndWait(page, repsInput(first), '5');
    await completeSet(page, first);
    await expect(first.locator('[data-record]')).toBeHidden();

    // Heavier than the previous best: the set is flagged and announced.
    const second = rows.nth(1);
    await fillSetFieldAndWait(page, weightInput(second), '70');
    await fillSetFieldAndWait(page, repsInput(second), '5');
    await completeSet(page, second);
    await expect(second.locator('[data-record]')).toBeVisible();
    await expect(page.getByText('¡Récord batido!')).toBeVisible();

    // Unchecking and re-checking the set repaints the trophy with the state.
    const uncheck = page.waitForResponse(isSetWriteResponse);
    await second.locator('[data-toggle]').click();
    await uncheck;
    await expect(second.locator('[data-record]')).toBeHidden();

    const recheck = page.waitForResponse(isSetWriteResponse);
    await second.locator('[data-toggle]').click();
    await recheck;
    await expect(second.locator('[data-record]')).toBeVisible();

    const finished = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        /\/api\/workouts\/[^/]+\/finish$/.test(new URL(r.url()).pathname)
    );
    await page.getByRole('button', { name: 'Terminar entrenamiento' }).click();
    await finished;

    await expect(page).toHaveURL(/#\/workouts\/\d+$/);
    await expect(page.locator('.summary-hero .badge')).toContainText('1 récord');
    const recordChips = page.locator('.detail-exercise .set-chip.record');
    await expect(recordChips).toHaveCount(1);
    await expect(recordChips).toContainText('70kg × 5');
  });
});
