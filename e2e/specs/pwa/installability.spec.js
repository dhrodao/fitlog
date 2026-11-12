import { test, expect } from '../../fixtures/index.js';
import { waitForServiceWorkerControl } from '../../fixtures/pwa.js';

test.describe('PWA installability', () => {
  test(
    'the service worker controls the app and the manifest resolves',
    { tag: '@pwa' },
    async ({ login, context, page }) => {
      await page.goto('/');
      await expect(
        page.getByRole('heading', { name: 'Atleta', exact: true })
      ).toBeVisible();

      await waitForServiceWorkerControl(page);

      // Reload so the document itself is served by the worker, not just
      // controlled after the fact.
      await page.reload();
      await expect(
        page.getByRole('heading', { name: 'Atleta', exact: true })
      ).toBeVisible();
      expect(
        await page.evaluate(() => Boolean(navigator.serviceWorker.controller))
      ).toBe(true);

      const manifestResponse = await context.request.get('/manifest.webmanifest');
      expect(manifestResponse.status()).toBe(200);
      const manifest = await manifestResponse.json();
      expect(manifest.name).toContain('Fitlog');
      expect(manifest.start_url).toBe('/');
      expect(manifest.icons.length).toBeGreaterThan(0);

      for (const icon of manifest.icons) {
        const iconResponse = await context.request.get(icon.src);
        expect(iconResponse.status(), `icon ${icon.src}`).toBe(200);
      }
    }
  );
});
