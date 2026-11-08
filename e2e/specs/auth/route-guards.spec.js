import { test, expect } from '../../fixtures/index.js';

test.describe('Authentication route guards', () => {
  test(
    'a signed-out deep link shows login and hides the bottom navigation',
    { tag: '@smoke' },
    async ({ page }) => {
      await page.goto('/#/workouts');

      await expect(page.locator('[data-dev-login]')).toBeVisible();
      await expect(page).toHaveURL(/#\/login$/);
      await expect(
        page.getByRole('navigation', { name: 'Navegación principal' })
      ).toBeHidden();
    }
  );

  test(
    'a signed-in visit to the login route redirects home',
    { tag: '@smoke' },
    async ({ login, page }) => {
      await page.goto('/#/login');

      await expect(page).toHaveURL(/#\/$/);
      await expect(page.getByRole('heading', { name: 'Atleta', exact: true })).toBeVisible();
      await expect(page.locator('[data-dev-login]')).toHaveCount(0);
    }
  );
});
