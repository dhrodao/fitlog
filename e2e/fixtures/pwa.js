// Helpers shared by the PWA/offline specs. They keep the service-worker and
// connectivity plumbing out of the test bodies so the specs read as user flows.

import { startEmptyWorkout } from './workout-actions.js';

const OFFLINE_DB = 'fitlog-offline';
const CATALOG_STORE = 'catalog';

/** Resolves once a service worker is active and controlling this page. */
export async function waitForServiceWorkerControl(page) {
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) {
      throw new Error('Service workers are unavailable');
    }
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}

/** Returns the signed-in user's id from the shared cookie jar. */
export async function currentUserId(context) {
  const response = await context.request.get('/api/auth/me');
  const { user } = await response.json();
  return user.id;
}

/**
 * Cuts the browser's connectivity and waits until the page agrees, so code
 * paths that check navigator.onLine take the offline branch.
 */
export async function goOffline(context, page) {
  await context.setOffline(true);
  await page.waitForFunction(() => navigator.onLine === false);
}

/** Restores connectivity and waits for the page to observe it. */
export async function goOnline(context, page) {
  await context.setOffline(false);
  await page.waitForFunction(() => navigator.onLine === true);
}

/**
 * Waits until the catalog cache written by refreshCatalogCache is populated.
 * The training view warms it online in the background, so the offline picker
 * has something to search only after this resolves.
 */
export async function waitForCatalogCache(page, userId, timeout = 20_000) {
  await page.waitForFunction(
    ({ dbName, storeName, key }) =>
      new Promise((resolve) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => resolve(false);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.close();
            resolve(false);
            return;
          }
          const get = db
            .transaction(storeName, 'readonly')
            .objectStore(storeName)
            .get(key);
          get.onerror = () => {
            db.close();
            resolve(false);
          };
          get.onsuccess = () => {
            const items = get.result?.items;
            db.close();
            resolve(Array.isArray(items) && items.length > 0);
          };
        };
      }),
    { dbName: OFFLINE_DB, storeName: CATALOG_STORE, key: `${userId}:catalog` },
    { timeout }
  );
}

/**
 * Starts one online workout so the app warms the offline catalog/routines
 * caches, then discards it. Leaves the browser on home with a clean server.
 */
export async function warmOfflineCatalog(page, context) {
  const catalogLoad = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().includes('/api/exercises/search') &&
      response.url().includes('limit=100')
  );
  await startEmptyWorkout(page);
  await catalogLoad;
  const userId = await currentUserId(context);
  await waitForCatalogCache(page, userId);

  await page.locator('[data-discard]').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Descartar' }).click();
  await page.waitForURL(/#\/$/);
  return userId;
}

/** Opens the training view and starts a workout with connectivity already off. */
export async function startOfflineWorkout(page) {
  await page.evaluate(() => {
    location.hash = '/routines';
  });
  await page.locator('[data-start-empty]').click();
  await page.waitForURL(/#\/workout\/active$/);
  await page.locator('[data-add-exercise]').waitFor();
}

/** Adds an exercise from the cached "Mis ejercicios" tab while offline. */
export async function addOfflineExercise(page, name) {
  await page.locator('[data-add-exercise]').click();
  const sheet = page.getByRole('dialog');
  await sheet.locator('[data-tab="mine"]').click();
  await sheet.locator('[data-search]').fill(name);
  await sheet.locator('.picker-item').filter({ hasText: name }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.locator('[data-exercises]').getByText(name).waitFor();
}
