import { test, expect } from '../../fixtures/index.js';
import { startEmptyWorkout } from '../../fixtures/workout-actions.js';

test.describe('Finishing without completed sets', () => {
  test('asks for confirmation when every set is empty', async ({
    login,
    reset,
    page,
  }) => {
    await startEmptyWorkout(page);

    await page.locator('[data-finish]').click();
    let dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Terminar sin series' })
    ).toBeVisible();

    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/workout\/active$/);

    await page.locator('[data-finish]').click();
    dialog = page.getByRole('dialog');
    const finished = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/finish$/.test(new URL(response.url()).pathname)
    );
    await dialog.getByRole('button', { name: 'Terminar', exact: true }).click();
    await finished;

    await expect(page).toHaveURL(/#\/workouts\/\d+$/);
    await expect(page.locator('.summary-hero .stat .value').nth(2)).toHaveText('0');
  });
});

test.describe('Discarding an active workout', () => {
  test('confirms, removes the workout and lets the user start again', async ({
    login,
    reset,
    api,
    page,
  }) => {
    await startEmptyWorkout(page);

    await page.locator('[data-discard]').click();
    let dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Descartar entrenamiento' })
    ).toBeVisible();

    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/workout\/active$/);

    await page.locator('[data-discard]').click();
    dialog = page.getByRole('dialog');
    const removed = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        /\/api\/workouts\/\d+$/.test(new URL(response.url()).pathname)
    );
    await dialog.getByRole('button', { name: 'Descartar', exact: true }).click();
    await removed;

    await expect(page.getByText('Entrenamiento descartado')).toBeVisible();
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.locator('[data-start]')).toBeVisible();
    expect(await api.getActiveWorkout()).toBeNull();
  });
});
