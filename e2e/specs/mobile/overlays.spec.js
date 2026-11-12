import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';
import {
  addExerciseFromPicker,
  addSet,
  completeSet,
  exerciseBlocks,
  startEmptyWorkout,
} from '../../fixtures/workout-actions.js';

async function startWithAnExercise(page, api, prefix) {
  const name = uniqueName(prefix);
  await api.seedExercise(name);
  await startEmptyWorkout(page);
  await addExerciseFromPicker(page, name);
  return exerciseBlocks(page).filter({ hasText: name });
}

async function expectPanelInsideViewport(page, dialog) {
  const panel = dialog.locator('.modal-panel');
  const box = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
  // Sheets are anchored to the bottom edge and may extend a few pixels under
  // the safe area; what matters is that their controls stay clickable.
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 10);
}

test.describe('Overlays on a phone viewport', () => {
  test(
    'the rest bar, key actions and sheets stay usable together',
    { tag: '@mobile' },
    async ({ login, reset, api, page }) => {
      const block = await startWithAnExercise(page, api, 'Mobile Overlay');
      const row = block.locator('[data-set-id]').first();
      await addSet(page, block);
      await completeSet(page, row);

      const rest = page.locator('[data-rest-timer]');
      await expect(rest).toBeVisible();

      // The fixed rest bar and bottom navigation must not block these actions.
      await page.locator('[data-rest-add]').click();
      await expect(page.locator('[data-rest-count]')).toBeVisible();
      await page.locator('[data-rest-skip]').click();
      await expect(rest).toBeHidden();

      await page.locator('[data-finish]').click({ trial: true });
      await page.locator('[data-add-set]').first().click({ trial: true });
      await page.locator('[data-add-exercise]').click({ trial: true });

      const initialCatalogLoad = page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          response.url().includes('/api/exercises/search')
      );
      await page.locator('[data-add-exercise]').tap();
      await initialCatalogLoad;
      const picker = page.getByRole('dialog');
      await expect(
        picker.getByRole('heading', { name: 'Añadir ejercicio' })
      ).toBeVisible();
      await expectPanelInsideViewport(page, picker);
      await picker.getByRole('button', { name: 'Cerrar' }).tap();
      await expect(page.getByRole('dialog')).toHaveCount(0);

      await page.locator('[data-discard]').tap();
      const confirm = page.getByRole('dialog');
      await expect(
        confirm.getByRole('heading', { name: 'Descartar entrenamiento' })
      ).toBeVisible();
      await expectPanelInsideViewport(page, confirm);
      await confirm.getByRole('button', { name: 'Cancelar' }).tap();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('[data-add-exercise]')).toBeVisible();
    }
  );

  test(
    'sheets and confirms close with their controls, Escape and the backdrop',
    { tag: '@mobile' },
    async ({ login, reset, api, page }) => {
      const name = uniqueName('Mobile Menu');
      const block = await startWithAnExercise(page, api, name);

      // Picker sheet: close button.
      const initialCatalogLoad = page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          response.url().includes('/api/exercises/search')
      );
      await page.locator('[data-add-exercise]').tap();
      await initialCatalogLoad;
      const picker = page.getByRole('dialog');
      await expect(picker.getByRole('heading', { name: 'Añadir ejercicio' })).toBeVisible();
      await picker.getByRole('button', { name: 'Cerrar' }).tap();
      await expect(page.getByRole('dialog')).toHaveCount(0);

      // Exercise action sheet: Escape.
      await block.locator('[data-exercise-menu]').tap();
      const sheet = page.getByRole('dialog');
      await expect(sheet.getByRole('heading', { name })).toBeVisible();
      await expect(
        sheet.getByRole('button', { name: 'Eliminar Ejercicio' })
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);

      // Confirm dialog: cancel button, then backdrop.
      await page.locator('[data-discard]').tap();
      const confirm = page.getByRole('dialog');
      await expect(
        confirm.getByRole('heading', { name: 'Descartar entrenamiento' })
      ).toBeVisible();
      await confirm.getByRole('button', { name: 'Cancelar' }).tap();
      await expect(page.getByRole('dialog')).toHaveCount(0);

      await page.locator('[data-discard]').tap();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.mouse.click(4, 4);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('[data-add-exercise]')).toBeVisible();
    }
  );
});
