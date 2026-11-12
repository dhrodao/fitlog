import { defineConfig, devices } from '@playwright/test';

// End-to-end tests drive a real browser against a real server instance. They
// live in e2e/ (separate from test/, which is the node --test suite) and run on
// Chromium only for now. The webServer below boots the app with dev login on
// and a throwaway SQLite database, so the browser can sign in without Google
// and nothing touches a real database.
//
// PORT is overridable so parallel local runs can use distinct servers; the DB
// path is unique per run. These match the environment the node --test
// integration suite already uses (ALLOW_DEV_LOGIN=true, no GOOGLE_CLIENT_ID).

const PORT = Number(process.env.E2E_PORT || 3100);
const DB_PATH =
  process.env.E2E_DB_PATH || `/tmp/fitlog-e2e-${process.pid}.db`;

export default defineConfig({
  testDir: 'e2e',
  // The suite shares one dev user and one database: tests reset their own data
  // before running, but must not overlap. Revisit when each worker gets its own
  // server and database.
  workers: 1,
  fullyParallel: false,
  // Fail fast in CI; retry once there to absorb cold-start flakiness.
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    // Pin the locale, time zone and motion so date labels, number formatting
    // and animations do not vary between machines. The stylesheets already
    // honour prefers-reduced-motion.
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    reducedMotion: 'reduce',
    // A controlling service worker makes request mocking and cache state
    // unpredictable. PWA-focused tests opt back in explicitly.
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium',
      // Mobile specs need a touch device descriptor and PWA specs need an
      // active service worker; both run in their own projects below so the
      // desktop suite keeps its pointer/keyboard setup and blocked workers.
      testIgnore: /[\\/]specs[\\/](mobile|pwa)[\\/].*\.spec\.js$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      testMatch: /[\\/]specs[\\/]mobile[\\/].*\.spec\.js$/,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'pwa',
      testMatch: /[\\/]specs[\\/]pwa[\\/].*\.spec\.js$/,
      // Offline behaviour depends on the service worker serving the shell, so
      // these specs opt back in explicitly (the rest of the suite blocks it).
      use: { ...devices['Desktop Chrome'], serviceWorkers: 'allow' },
    },
  ],
  webServer: {
    // Seed a small fixed catalog through the production sync path before boot
    // so no external dataset fetch is triggered and contents are deterministic.
    command: 'node e2e/support/seed-catalog.js && node server/index.js',
    url: `http://127.0.0.1:${PORT}/api/health`,
    // Never attach to a server that is already listening: it could be a dev or
    // real instance and the specs write data.
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: 'test',
      PORT: String(PORT),
      DB_PATH,
      ALLOW_DEV_LOGIN: 'true',
      GOOGLE_CLIENT_ID: '',
      COOKIE_SECURE: 'false',
      // The seeded catalog is fresh at boot, so the server does not attempt a
      // background sync. This value keeps it from going stale during a run.
      CATALOG_SYNC_DAYS: '36500',
    },
  },
});
