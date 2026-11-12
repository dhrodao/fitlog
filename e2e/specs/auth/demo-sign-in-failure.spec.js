import { test, expect } from '../../fixtures/index.js';

test.describe('Demo sign-in failure', () => {
  test('shows the server error and re-enables the demo button', async ({
    context,
    page,
  }) => {
    await context.clearCookies();
    await page.route('**/api/auth/dev', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'No se pudo iniciar sesión' }),
      })
    );

    await page.goto('/');
    const button = page.locator('[data-dev-login]');
    await expect(button).toBeVisible();
    await button.click();

    await expect(page.locator('#login-error .notice.danger')).toContainText(
      'No se pudo iniciar sesión'
    );
    await expect(button).toBeEnabled();
    await expect(button).toContainText('Entrar en modo demo');
    await expect(page).toHaveURL(/#\/login$/);

    await page.unroute('**/api/auth/dev');
    await page.route('**/api/auth/dev', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Acceso demo deshabilitado' }),
      })
    );
    await button.click();
    await expect(page.locator('#login-error .notice.danger')).toContainText(
      'Acceso demo deshabilitado'
    );
    await expect(button).toBeEnabled();
    await expect(page).toHaveURL(/#\/login$/);
  });
});
