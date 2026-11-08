import { test, expect } from '../../fixtures/index.js';

test.describe('Demo sign-in', () => {
  test(
    'signs in through the real demo button',
    { tag: '@smoke' },
    async ({ reset, context, page }) => {
      // The reset fixture signs in through the API to clear data; start the
      // browser explicitly signed out afterwards.
      await context.clearCookies();
      await page.goto('/');

      await expect(page.locator('[data-dev-login]')).toBeVisible();
      await page.locator('[data-dev-login]').click();

      await expect(page.getByText('Hola, Atleta Demo')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Atleta', exact: true })).toBeVisible();
      await expect(
        page.getByRole('navigation', { name: 'Navegación principal' })
      ).toBeVisible();
    }
  );
});
