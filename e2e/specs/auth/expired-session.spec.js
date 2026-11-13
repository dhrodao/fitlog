import { test, expect } from '../../fixtures/index.js';

test.describe('Expired session', () => {
  test(
    'redirects to login without an error screen when the session disappears',
    { tag: '@smoke' },
    async ({ login, context, page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Atleta', exact: true })).toBeVisible();

      await context.clearCookies();
      await page
        .getByRole('navigation', { name: 'Navegación principal' })
        .getByRole('link', { name: 'Entrenar' })
        .click();

      await expect(page.locator('[data-dev-login]')).toBeVisible();
      await expect(page).toHaveURL(/#\/login$/);
      await expect(
        page.getByText('Tu sesión ha caducado. Vuelve a entrar.')
      ).toBeVisible();
      await expect(page.getByText(/No se pudo cargar/)).toHaveCount(0);
    }
  );
});
