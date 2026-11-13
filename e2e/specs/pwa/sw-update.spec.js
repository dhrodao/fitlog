import { test, expect } from '../../fixtures/index.js';
import { installExternalHostGuard } from '../../fixtures/guards.js';
import { waitForServiceWorkerControl } from '../../fixtures/pwa.js';
import { startVersionedProxy } from '../../fixtures/versioned-proxy.js';

function cacheVersionFrom(source) {
  const match = source.match(/const CACHE_VERSION = '([^']+)';/);
  expect(match, 'CACHE_VERSION not found in sw.js').not.toBeNull();
  return { definition: match[0], version: match[1] };
}

test.describe('Service worker update', () => {
  test(
    'a newly deployed worker takes over and reloads the page once',
    { tag: '@pwa' },
    async ({ browser, baseURL }) => {
      const proxy = await startVersionedProxy(baseURL);
      const context = await browser.newContext({
        baseURL: proxy.origin,
        locale: 'es-ES',
        timezoneId: 'Europe/Madrid',
        reducedMotion: 'reduce',
        serviceWorkers: 'allow',
      });
      const offenders = await installExternalHostGuard(context, proxy.origin);
      const page = await context.newPage();

      try {
        // Count each document load so the reload triggered by the update can be
        // observed from inside the page after the navigation.
        await page.addInitScript(() => {
          const loads = Number(sessionStorage.getItem('e2e-loads') || '0') + 1;
          sessionStorage.setItem('e2e-loads', String(loads));
        });

        await context.request.post('/api/auth/dev');
        await page.goto('/');
        await expect(
          page.getByRole('heading', { name: 'Atleta', exact: true })
        ).toBeVisible();
        await waitForServiceWorkerControl(page);

        // Reload once so the document itself is served by the worker.
        await page.reload();
        await expect(
          page.getByRole('heading', { name: 'Atleta', exact: true })
        ).toBeVisible();

        const originalResponse = await context.request.get('/sw.js');
        expect(originalResponse.status()).toBe(200);
        const originalBody = await originalResponse.text();
        const previous = cacheVersionFrom(originalBody);
        const nextVersion = `${previous.version}-e2e-update`;

        await expect
          .poll(() => page.evaluate(() => caches.keys()))
          .toContain(previous.version);

        // From now on the proxy answers the worker update request with a
        // version whose cache name differs, like a real deploy would.
        proxy.setWorkerScript(
          originalBody.replace(
            previous.definition,
            `const CACHE_VERSION = '${nextVersion}';`
          )
        );

        // Trigger an update check without navigating; the app reloads itself
        // when the new worker claims the page.
        await page.evaluate(() => {
          sessionStorage.setItem('e2e-loads', '0');
          navigator.serviceWorker.getRegistration().then((registration) => {
            if (registration) registration.update();
          });
        });

        await page.waitForFunction(
          () => sessionStorage.getItem('e2e-loads') === '1',
          undefined,
          { timeout: 20_000 }
        );

        // The new worker activated and deleted the previous versioned cache.
        await page.waitForFunction(
          ({ next, previous }) =>
            caches
              .keys()
              .then(
                (keys) => keys.includes(next) && !keys.includes(previous)
              ),
          { next: nextVersion, previous: previous.version },
          { timeout: 20_000 }
        );

        // The app still works under the updated worker and only reloaded once.
        await expect(
          page.getByRole('heading', { name: 'Atleta', exact: true })
        ).toBeVisible();
        expect(
          await page.evaluate(() => Boolean(navigator.serviceWorker.controller))
        ).toBe(true);
        expect(
          await page.evaluate(() => sessionStorage.getItem('e2e-loads'))
        ).toBe('1');
        expect(offenders, 'the browser contacted external hosts').toEqual([]);
      } finally {
        await context.close();
        await proxy.close();
      }
    }
  );
});
