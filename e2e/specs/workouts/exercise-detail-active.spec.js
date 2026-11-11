import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';
import {
  addExerciseFromPicker,
  addSet,
  exerciseBlocks,
  startEmptyWorkout,
} from '../../fixtures/workout-actions.js';

test.describe('Exercise detail from the active workout', () => {
  test('opens the read-only detail modal and leaves the workout editable', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const name = uniqueName('Detail Press');
    await api.seedExercise(name);

    await startEmptyWorkout(page);
    await addExerciseFromPicker(page, name);

    const block = exerciseBlocks(page).filter({ hasText: name });
    await block.locator('[data-exercise-detail]').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name })).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Resumen' })).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Historial' })).toBeVisible();
    // A custom exercise has no catalog guide tab.
    await expect(dialog.getByRole('tab', { name: 'Indicaciones' })).toHaveCount(0);
    await expect(dialog.getByText('Récords personales')).toBeVisible();

    await dialog.getByRole('button', { name: 'Cerrar' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Closing the modal must not have opened the exercise action sheet, and the
    // workout stays editable.
    const rows = block.locator('[data-set-id]');
    const before = await rows.count();
    await addSet(page, block);
    await expect(rows).toHaveCount(before + 1);
  });
});
