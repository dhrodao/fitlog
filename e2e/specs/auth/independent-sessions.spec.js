import { test, expect } from '../../fixtures/index.js';

test.describe('Independent sessions', () => {
  test('logging out in one browser context keeps the other signed in', async ({
    browser,
    login,
    page,
  }) => {
    await page.goto('/#/profile');
    await expect(page.getByRole('heading', { name: 'Información' })).toBeVisible();
    const origin = new URL(page.url()).origin;

    const otherContext = await browser.newContext({ baseURL: origin });
    try {
      await otherContext.request.post('/api/auth/dev');
      const otherPage = await otherContext.newPage();
      await otherPage.goto('/#/profile');
      await expect(
        otherPage.getByRole('heading', { name: 'Información' })
      ).toBeVisible();

      await page.getByRole('button', { name: 'Cerrar sesión' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Cerrar sesión' }).click();
      await expect(page.locator('[data-dev-login]')).toBeVisible();

      await otherPage.reload();
      await expect(otherPage).toHaveURL(/#\/profile$/);
      await expect(
        otherPage.getByRole('heading', { name: 'Información' })
      ).toBeVisible();
    } finally {
      await otherContext.close();
    }
  });
});
