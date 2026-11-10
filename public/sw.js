/* Fitlog service worker.
 *
 * Goals:
 *  - Make the app installable and usable offline for the shell/navigation.
 *  - Never cache API responses (user data must always be fresh and must not
 *    leak across sessions): requests to /api/ bypass the cache entirely.
 *  - Survive deploys: a versioned cache is wiped on activate, and static
 *    assets use stale-while-revalidate so a new deploy is picked up on the
 *    next load without ever serving a half-updated shell.
 *
 * Bump CACHE_VERSION to force clients to drop old caches.
 */
const CACHE_VERSION = 'fitlog-v46';
// Complete first-party shell. Every module is imported statically from app.js
// (no dynamic import()), so the whole graph must be present for an offline cold
// launch to succeed — precaching only app.js left installed clients unable to
// boot offline. Keep this list in sync with the files on disk; a test enforces
// that it is complete and that SHELL_HASH below changes whenever any shell file
// does (so a deploy can never ship a stale CACHE_VERSION).
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/icon.svg',
  '/css/tokens.css',
  '/css/base.css',
  '/css/components.css',
  '/css/views.css',
  '/js/app.js',
  '/js/api.js',
  '/js/ui.js',
  '/js/theme.js',
  '/js/charts.js',
  '/js/format.js',
  '/js/keypad.js',
  '/js/keypad-logic.js',
  '/js/rest-timer.js',
  '/js/view-helpers.js',
  '/js/exercise-picker.js',
  '/js/exercise-detail.js',
  '/js/pending-writes.js',
  '/js/pull-refresh.js',
  '/js/swipe.js',
  '/js/offline/active-store.js',
  '/js/offline/db.js',
  '/js/offline/local-workout.js',
  '/js/offline/active-repo.js',
  '/js/offline/catalog-cache.js',
  '/js/offline/routines-cache.js',
  '/js/offline/sync.js',
  '/js/views/active.js',
  '/js/views/exercises.js',
  '/js/views/history.js',
  '/js/views/home.js',
  '/js/views/login.js',
  '/js/views/measurements.js',
  '/js/views/profile.js',
  '/js/views/routine-editor.js',
  '/js/views/routine.js',
  '/js/views/training.js',
  '/js/views/workout.js',
];
// Fingerprint of the shell contents. The build-less project has no bundler to
// inject a release id, so a test computes the same hash from the files on disk
// and fails if it drifts from this constant — forcing a deliberate bump here
// (and with it CACHE_VERSION) whenever a shell file changes.
const SHELL_HASH = '0cc1acf2f2370478';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // Best-effort precache: a single missing file must not abort install.
      await Promise.allSettled(PRECACHE.map((url) => cache.add(url)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Only handle same-origin requests; let the network handle the rest.
  if (url.origin !== self.location.origin) return;
  // Never cache API or auth traffic — always hit the network.
  if (url.pathname.startsWith('/api/')) return;

  // Navigation requests: network-first, fall back to the cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE_VERSION);
          cache.put('/index.html', fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(CACHE_VERSION);
          return (
            (await cache.match(request)) ||
            (await cache.match('/index.html')) ||
            Response.error()
          );
        }
      })()
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);
      return cached || (await network) || Response.error();
    })()
  );
});
