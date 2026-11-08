import { expect } from './index.js';

// Reusable actions for the active-workout screen. Kept as plain functions
// (no Page Object classes) so specs stay close to the user flow.

const SET_WRITE_PATH = /\/api\/workouts\/[^/]+\/sets\/[^/]+$/;

export function isSetWriteResponse(response) {
  const request = response.request();
  return (
    request.method() === 'PATCH' &&
    SET_WRITE_PATH.test(new URL(request.url()).pathname)
  );
}

export function exerciseBlocks(page) {
  return page.locator('[data-exercises] [data-we-id]');
}

export function setRows(page) {
  return page.locator('[data-exercises] [data-set-id]');
}

export function weightInput(row) {
  return row.locator('[data-field="weightKg"]');
}

export function repsInput(row) {
  return row.locator('[data-field="reps"]');
}

export function saveIndicator(page) {
  return page.locator('[data-save-state]');
}

export async function gotoActiveWorkout(page) {
  await page.goto('/#/workout/active');
  await expect(page.locator('[data-add-exercise]')).toBeVisible();
}

export async function startEmptyWorkout(page) {
  await page.goto('/#/routines');
  await page.locator('[data-start-empty]').click();
  await expect(page).toHaveURL(/#\/workout\/active$/);
  await expect(page.locator('[data-add-exercise]')).toBeVisible();
}

export async function addExerciseFromPicker(page, name) {
  const initialCatalogLoad = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().includes('/api/exercises/search')
  );

  await page.locator('[data-add-exercise]').click();
  const sheet = page.getByRole('dialog');
  await expect(
    sheet.getByRole('heading', { name: 'Añadir ejercicio' })
  ).toBeVisible();
  // The picker starts a catalog load as soon as it opens. Wait for it so the
  // tab switch below is not dropped while that request is still in flight.
  await initialCatalogLoad;

  const mineLoad = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().includes('/api/exercises/mine')
  );
  await sheet.locator('[data-tab="mine"]').click();
  await mineLoad;

  // Search for the unique name so the pick never depends on how many custom
  // exercises accumulated in the shared database across runs.
  const filteredLoad = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().includes('/api/exercises/mine') &&
      response.url().includes(encodeURIComponent(name))
  );
  await sheet.locator('[data-search]').fill(name);
  await filteredLoad;

  const item = sheet.locator('.picker-item').filter({ hasText: name });
  await expect(item).toBeVisible();
  await item.click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-exercises]')).toContainText(name);
}

export async function addSet(page, block) {
  const rows = block.locator('[data-set-id]');
  const count = await rows.count();
  await block.locator('[data-add-set]').click();
  await expect(rows).toHaveCount(count + 1);
}

export async function fillSetFieldAndWait(page, input, value) {
  const write = page.waitForResponse(isSetWriteResponse);
  await input.fill(value);
  await write;
  await expect(saveIndicator(page)).toBeHidden();
}

export async function completeSet(page, row) {
  const write = page.waitForResponse(isSetWriteResponse);
  await row.locator('[data-toggle]').click();
  await write;
  await expect(row.locator('[data-set-handle]')).toHaveClass(/completed/);
}

export async function openExerciseMenu(page, name) {
  const block = exerciseBlocks(page).filter({ hasText: name });
  await block.locator('[data-exercise-menu]').click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name })).toBeVisible();
  return sheet;
}

export async function chooseDialogAction(page, { title, action }) {
  const dialog = page.getByRole('dialog');
  if (title) {
    await expect(dialog.getByRole('heading', { name: title })).toBeVisible();
  }
  await dialog.getByRole('button', { name: action, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
