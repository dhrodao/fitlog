import { test, expect } from '../../fixtures/index.js';

test.describe('Logout', () => {
  test(
    'confirms logout, shows the farewell toast and blocks protected routes',
    { tag: '@smoke' },
    async ({ login, page }) => {
      await page.goto('/#/profile');
      await expect(page.getByRole('heading', { name: 'Información' })).toBeVisible();

      // Cancelling keeps the session.
      await page.getByRole('button', { name: 'Cerrar sesión' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancelar' }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('heading', { name: 'Información' })).toBeVisible();

      // Confirming signs out.
      await page.getByRole('button', { name: 'Cerrar sesión' }).click();
      const confirmDialog = page.getByRole('dialog');
      await expect(confirmDialog).toBeVisible();
      await confirmDialog.getByRole('button', { name: 'Cerrar sesión' }).click();

      await expect(page.getByText('Hasta pronto')).toBeVisible();
      await expect(page.locator('[data-dev-login]')).toBeVisible();
      await expect(page).toHaveURL(/#\/login$/);

      // A direct visit to the home hash must stay on the login screen.
      await page.goto('/#/');
      await expect(page.locator('[data-dev-login]')).toBeVisible();
      await expect(page).toHaveURL(/#\/login$/);
    }
  );
});
