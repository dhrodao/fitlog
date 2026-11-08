import { test, expect } from '../../fixtures/index.js';

test.describe('Starting a workout', () => {
  test('starts an empty workout and shows it in progress on home', async ({
    login,
    reset,
    page,
  }) => {
    await page.goto('/#/routines');
    await expect(page.getByRole('heading', { name: 'Entrenamiento', exact: true })).toBeVisible();

    await page.locator('[data-start-empty]').click();

    await expect(page.locator('[data-add-exercise]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sin ejercicios' })).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Navegación principal' })
      .getByRole('link', { name: 'Inicio' })
      .click();

    await expect(page.getByText('Entrenamiento en curso')).toBeVisible();
    await expect(page.getByText('Empezar a entrenar')).toHaveCount(0);
  });
});
