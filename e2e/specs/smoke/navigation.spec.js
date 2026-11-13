import { test, expect } from '../../fixtures/index.js';

test.describe('Navigation', () => {
  test('the bottom navigation changes the route and marks the active tab', async ({
    login,
    page,
  }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Navegación principal' });
    await expect(nav).toBeVisible();

    await nav.getByRole('link', { name: 'Entrenar' }).click();
    await expect(page).toHaveURL(/#\/routines$/);
    await expect(page.getByRole('heading', { name: 'Entrenamiento', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Entrenar' })).toHaveClass(/active/);
    await expect(nav.getByRole('link', { name: 'Entrenar' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    await expect(nav.getByRole('link', { name: 'Inicio' })).not.toHaveClass(/active/);
    await expect(nav.getByRole('link', { name: 'Inicio' })).not.toHaveAttribute(
      'aria-current',
      'page'
    );

    await nav.getByRole('link', { name: 'Perfil' }).click();
    await expect(page).toHaveURL(/#\/profile$/);
    await expect(page.getByRole('heading', { name: 'Información' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Perfil' })).toHaveClass(/active/);
    await expect(nav.getByRole('link', { name: 'Perfil' })).toHaveAttribute(
      'aria-current',
      'page'
    );

    await nav.getByRole('link', { name: 'Inicio' }).click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByRole('heading', { name: 'Atleta', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Inicio' })).toHaveClass(/active/);
    await expect(nav.getByRole('link', { name: 'Inicio' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  test(
    'an unknown hash redirects home',
    { tag: '@smoke' },
    async ({ login, page }) => {
      await page.goto('/#/does-not-exist');

      await expect(page).toHaveURL(/#\/$/);
      await expect(page.getByRole('heading', { name: 'Atleta', exact: true })).toBeVisible();
    }
  );
});
