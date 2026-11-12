import { test, expect } from '../../fixtures/index.js';

const MEASUREMENT_POST = /\/api\/measurements$/;

function weightInput(page) {
  return page.locator('[data-field="weightKg"]');
}

function bodyFatInput(page) {
  return page.locator('[data-field="bodyFat"]');
}

function dateInput(page) {
  return page.locator('[data-field="date"]');
}

function saveButton(page) {
  return page.locator('[data-save]');
}

async function saveMeasurement(page) {
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      MEASUREMENT_POST.test(new URL(response.url()).pathname)
  );
  await saveButton(page).click();
  const response = await saved;
  expect(response.ok()).toBeTruthy();
}

test.describe('Measurement validation', () => {
  test('flags invalid numbers and saves nothing', async ({ login, reset, page }) => {
    await page.goto('/#/measurements');

    await weightInput(page).fill('abc');
    await saveButton(page).click();

    await expect(weightInput(page)).toHaveClass(/input-error/);
    await expect(
      page.getByText('Revisa los valores numéricos (usa coma o punto)')
    ).toBeVisible();

    await weightInput(page).fill('-5');
    await saveButton(page).click();
    await expect(weightInput(page)).toHaveClass(/input-error/);

    await expect(page.getByText('Sin medidas aún')).toBeVisible();

    await page.reload();
    await expect(page.getByText('Sin medidas aún')).toBeVisible();
  });

  test('accepts decimal commas and points', async ({ login, reset, page }) => {
    await page.goto('/#/measurements');

    await dateInput(page).fill('2026-03-01');
    await weightInput(page).fill('72,5');
    await bodyFatInput(page).fill('18,2');
    await saveMeasurement(page);

    await dateInput(page).fill('2026-03-02');
    await weightInput(page).fill('72.5');
    await saveMeasurement(page);

    const rows = page.locator('.measurement-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('72,5 kg');
    await expect(rows.last()).toContainText('72,5 kg');
    await expect(rows.last()).toContainText('18,2 % grasa');
  });

  test('requires at least one measure before saving', async ({
    login,
    reset,
    page,
  }) => {
    await page.goto('/#/measurements');

    let posted = false;
    page.on('request', (request) => {
      if (request.method() === 'POST' && MEASUREMENT_POST.test(new URL(request.url()).pathname)) {
        posted = true;
      }
    });

    await page.locator('[data-field="notes"]').fill('Solo una nota');
    await saveButton(page).click();

    await expect(page.getByText('Añade al menos una medida')).toBeVisible();
    await expect(page.getByText('Sin medidas aún')).toBeVisible();
    expect(posted).toBe(false);
  });

  test('defaults the date to the local calendar day, not UTC', async ({
    login,
    reset,
    page,
  }) => {
    // 00:30 in Madrid is still the previous day in UTC.
    await page.clock.install({
      time: new Date('2026-03-04T00:30:00+01:00'),
    });
    await page.clock.setFixedTime(new Date('2026-03-04T00:30:00+01:00'));

    await page.goto('/#/measurements');

    await expect(dateInput(page)).toHaveValue('2026-03-04');
  });
});
