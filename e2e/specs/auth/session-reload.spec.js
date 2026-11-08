import { test, expect } from '../../fixtures/index.js';

test.describe('Session persistence across reloads', () => {
  test(
    'keeps the session when reloading home',
    { tag: '@smoke' },
    async ({ login, page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Atleta', exact: true })).toBeVisible();

      await page.reload();

      await expect(page.getByRole('heading', { name: 'Atleta', exact: true })).toBeVisible();
      await expect(page.locator('[data-dev-login]')).toHaveCount(0);
    }
  );

  test(
    'keeps the session when reloading the profile route',
    { tag: '@smoke' },
    async ({ login, page }) => {
      await page.goto('/#/profile');
      await expect(page.getByRole('heading', { name: 'Información' })).toBeVisible();

      await page.reload();

      await expect(page).toHaveURL(/#\/profile$/);
      await expect(page.getByRole('heading', { name: 'Información' })).toBeVisible();
      await expect(page.locator('[data-dev-login]')).toHaveCount(0);
    }
  );
});
