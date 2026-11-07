import { defineConfig, devices } from '@playwright/test';

// End-to-end tests drive a real browser against a real server instance. They
// live in e2e/ (separate from test/, which is the node --test suite) and run on
// Chromium only for now. The webServer below boots the app with dev login on
// and a throwaway SQLite database, so the browser can sign in without Google
// and nothing touches a real database.
//
// PORT is overridable so the gate can avoid clashing with a dev server; the DB
// path is unique per run. These match the environment the node --test
// integration suite already uses (ALLOW_DEV_LOGIN=true, no GOOGLE_CLIENT_ID).

const PORT = Number(process.env.E2E_PORT || 3100);
const DB_PATH = process.env.E2E_DB_PATH || `/tmp/fitlog-e2e-${process.pid}.db`;

export default defineConfig({
  testDir: 'e2e',
  // Fail fast in CI; retry once there to absorb cold-start flakiness.
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node server/index.js',
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
      // Keeps the catalog from going stale during a run. NOTE: this does NOT
      // stop the boot-time catalog fetch on a fresh database (an empty catalog
      // is always treated as stale by server/index.js), so the first start
      // still tries to reach the network; the flows under test do not depend
      // on it.
      CATALOG_SYNC_DAYS: '36500',
    },
  },
});
