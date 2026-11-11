import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';
import {
  startEmptyWorkout,
  waitForPickerCatalogLoad,
} from '../../fixtures/workout-actions.js';

const pickerItems = (sheet) => sheet.locator('.picker-item .n');

test.describe('Adding a catalog exercise to my exercises', () => {
  test('copies the exercise and makes it available in the workout picker', async ({
    login,
    reset,
    page,
  }) => {
    await page.goto('/#/exercises');
    await expect(page.locator('.topbar-title')).toHaveText('Ejercicios');

    const card = page.locator('[data-exercise="e2e-cardio-01"]');
    await expect(card).toBeVisible();
    await card.click();

    const detail = page.getByRole('dialog');
    await expect(
      detail.getByRole('heading', { name: 'Cardio E2E 01' })
    ).toBeVisible();

    const copied = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/api\/exercises\/from-catalog$/.test(
          new URL(response.url()).pathname
        )
    );
    await detail
      .getByRole('button', { name: 'Añadir a mis ejercicios' })
      .click();
    await copied;

    await expect(
      page.getByText('Cardio E2E 01 añadido a tus ejercicios')
    ).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await startEmptyWorkout(page);
    const initialCatalogLoad = waitForPickerCatalogLoad(page);
    await page.locator('[data-add-exercise]').click();
    const sheet = page.getByRole('dialog');
    await initialCatalogLoad;

    const mineLoad = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes('/api/exercises/mine')
    );
    await sheet.locator('[data-tab="mine"]').click();
    await mineLoad;

    await expect(
      sheet.locator('.picker-item').filter({ hasText: 'Cardio E2E 01' })
    ).toBeVisible();
  });
});

test.describe('Exercise picker filters', () => {
  test('searches, filters by muscle group and picks from my exercises', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const mineName = uniqueName('Picker Mine');
    await api.seedExercise(mineName);

    await startEmptyWorkout(page);
    const initialCatalogLoad = waitForPickerCatalogLoad(page);
    await page.locator('[data-add-exercise]').click();
    const sheet = page.getByRole('dialog');
    await initialCatalogLoad;

    const search = sheet.locator('[data-search]');

    const searchLoad = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes('/api/exercises/search') &&
        new URL(response.url()).searchParams.get('q') === 'Pierna E2E'
    );
    await search.fill('Pierna E2E');
    await searchLoad;

    await expect
      .poll(async () => (await pickerItems(sheet).allTextContents()).sort())
      .toEqual(['Pierna E2E 01', 'Pierna E2E 02']);

    const clearedLoad = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes('/api/exercises/search') &&
        !new URL(response.url()).searchParams.has('q')
    );
    await search.fill('');
    await clearedLoad;

    const categoriesLoad = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes('/api/exercises/categories')
    );
    await sheet.locator('[data-muscle-filter]').click();
    await categoriesLoad;

    const muscleSheet = page.getByRole('dialog').last();
    await expect(
      muscleSheet.getByRole('heading', { name: 'Grupo muscular' })
    ).toBeVisible();

    const filteredLoad = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes('/api/exercises/search') &&
        new URL(response.url()).searchParams.get('category') === 'Pecho'
    );
    await muscleSheet.locator('[data-pick-category="Pecho"]').click();
    await filteredLoad;

    await expect(sheet.locator('[data-muscle-label]')).toHaveText('Pecho');
    await expect
      .poll(async () => {
        const names = await pickerItems(sheet).allTextContents();
        return names.length > 0 && names.every((name) => name.startsWith('Pecho E2E '));
      })
      .toBe(true);

    const mineLoad = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes('/api/exercises/mine')
    );
    await sheet.locator('[data-tab="mine"]').click();
    await mineLoad;
    await expect(sheet.locator('[data-muscle-filter]')).toBeHidden();

    const mineFilteredLoad = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes('/api/exercises/mine') &&
        response.url().includes(encodeURIComponent(mineName))
    );
    await search.fill(mineName);
    await mineFilteredLoad;

    const item = sheet.locator('.picker-item').filter({ hasText: mineName });
    await expect(item).toBeVisible();
    await item.click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-exercises]')).toContainText(mineName);
    await expect(page.getByText(`${mineName} añadido`)).toBeVisible();
  });
});
