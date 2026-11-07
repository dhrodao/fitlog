import { test, expect } from '@playwright/test';

// Proof-of-concept end-to-end flow driving a real browser against a real
// server (dev login, throwaway DB — see playwright.config.js). It exercises
// the parts no node --test integration test can: client-side routing, the
// session cookie round-trip, and the view rendering in a browser.
//
// The flow deliberately avoids the exercise catalog (synced from an external
// source) so it stays deterministic and offline-safe: it stops at the empty
// active-workout screen rather than adding a catalog exercise.

test('dev login lands on the home view', async ({ page }) => {
  await page.goto('/');

  // Not signed in yet -> the app routes to the login screen with the demo
  // button (dev login is enabled in the E2E environment).
  const devLogin = page.locator('[data-dev-login]');
  await expect(devLogin).toBeVisible();

  await devLogin.click();

  // After login the app navigates to the home view. The quick-start entry
  // point (no active workout yet) confirms we are on the authenticated home.
  await expect(page.locator('[data-start]')).toBeVisible();
});

test('start an empty workout from the training view', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-dev-login]').click();
  await expect(page.locator('[data-start]')).toBeVisible();

  // Go to the training view, which has the "empty workout" entry point.
  await page.goto('/#/routines');
  const startEmpty = page.locator('[data-start-empty]');
  await expect(startEmpty).toBeVisible();

  await startEmpty.click();

  // The active-workout screen renders with its "add exercise" entry point.
  // We stop here: adding an exercise would require the external catalog.
  await expect(page.locator('[data-add-exercise]')).toBeVisible();
});
