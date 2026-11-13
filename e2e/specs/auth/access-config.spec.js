import { test, expect } from '../../fixtures/index.js';

test.describe('Access configuration', () => {
  test('hides the demo button when the server disables dev login', async ({
    page,
  }) => {
    await page.route('**/api/auth/config', (route) =>
      route.fulfill({
        json: { googleEnabled: false, devLoginEnabled: false },
      })
    );

    await page.goto('/#/login');

    await expect(
      page.getByText(/El acceso no está configurado/)
    ).toBeVisible();
    await expect(page.locator('[data-dev-login]')).toHaveCount(0);
  });

  test('offers a retry instead of the demo button when access cannot be checked', async ({
    page,
  }) => {
    await page.route('**/api/auth/config', (route) =>
      route.fulfill({ status: 500, json: { error: 'config unavailable' } })
    );

    await page.goto('/#/login');

    await expect(
      page.getByRole('heading', { name: 'No se pudo comprobar el acceso' })
    ).toBeVisible();
    await expect(page.locator('[data-dev-login]')).toHaveCount(0);

    await page.unroute('**/api/auth/config');
    await page.getByRole('button', { name: 'Reintentar' }).click();

    await expect(page.locator('[data-dev-login]')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'No se pudo comprobar el acceso' })
    ).toHaveCount(0);
  });
});
