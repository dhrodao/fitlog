import { test, expect } from '../../fixtures/index.js';

test.describe('Loading and failure states', () => {
  test('a failed home load offers a retry that recovers once the API works', async ({
    login,
    page,
  }) => {
    await page.route('**/api/stats/overview*', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Fallo de prueba' }),
      })
    );

    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'No se pudo cargar' })
    ).toBeVisible();
    await expect(page.getByText('Fallo de prueba')).toBeVisible();

    await page.unroute('**/api/stats/overview*');
    await page.getByRole('button', { name: 'Reintentar' }).click();

    await expect(
      page.getByRole('heading', { name: 'Atleta', exact: true })
    ).toBeVisible();
    await expect(page.getByText('Esta semana')).toBeVisible();
  });

  test('a slow home load shows the loader until the data arrives', async ({
    login,
    page,
  }) => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await page.route('**/api/stats/overview*', async (route) => {
      await gate;
      await route.continue();
    });

    await page.goto('/');
    const loader = page.locator('.loader-screen');
    await expect(loader).toContainText('Cargando...');

    release();
    await expect(
      page.getByRole('heading', { name: 'Atleta', exact: true })
    ).toBeVisible();
    await expect(loader).toHaveCount(0);
  });
});
