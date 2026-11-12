import { test, expect } from '../../fixtures/index.js';
import { touchDrag } from '../../fixtures/touch.js';

test.describe('Pull to refresh', () => {
  test(
    'pulling down from the top of home reloads the view',
    { tag: '@mobile' },
    async ({ login, reset, page }) => {
      await page.goto('/#/');
      await expect(
        page.getByRole('heading', { name: 'Atleta', exact: true })
      ).toBeVisible();
      await expect(page.locator('.ptr-indicator')).toHaveCount(1);

      const refreshed = page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          response.url().includes('/api/stats/overview')
      );

      await touchDrag(page, { x: 180, y: 120 }, { x: 180, y: 320 });

      const response = await refreshed;
      expect(response.ok()).toBeTruthy();
      await expect(
        page.getByRole('heading', { name: 'Atleta', exact: true })
      ).toBeVisible();
      // The refreshed view mounts a fresh indicator, back at rest.
      const indicator = page.locator('.ptr-indicator');
      await expect(indicator).toHaveCount(1);
      await expect(indicator).not.toHaveClass(/ptr-spinning/);
      await expect(indicator).toHaveCSS('opacity', '0');
    }
  );
});
