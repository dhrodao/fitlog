import { test, expect } from '../../fixtures/index.js';

const MEASUREMENT_POST = /\/api\/measurements$/;

function weightInput(page) {
  return page.locator('[data-field="weightKg"]');
}

function dateInput(page) {
  return page.locator('[data-field="date"]');
}

async function saveMeasurement(page) {
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      MEASUREMENT_POST.test(new URL(response.url()).pathname)
  );
  await page.locator('[data-save]').click();
  const response = await saved;
  expect(response.ok()).toBeTruthy();
}

test.describe('Measurements', () => {
  test('creates a measurement and lists it newest first', async ({
    login,
    reset,
    api,
    page,
  }) => {
    await api.seedMeasurement({ date: '2026-01-05', weightKg: 70 });

    await page.goto('/#/measurements');
    await expect(
      page.getByRole('heading', { name: 'Nuevo registro' })
    ).toBeVisible();

    await dateInput(page).fill('2026-02-10');
    await weightInput(page).fill('72,5');
    await saveMeasurement(page);

    await expect(page.getByText('Medida guardada')).toBeVisible();

    const rows = page.locator('.measurement-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('72,5 kg');
    await expect(rows.last()).toContainText('70 kg');

    // The form returns to its empty "new record" state.
    await expect(
      page.getByRole('heading', { name: 'Nuevo registro' })
    ).toBeVisible();
    await expect(weightInput(page)).toHaveValue('');
  });

  test('shows the weight chart only once there are two weights', async ({
    login,
    reset,
    page,
  }) => {
    await page.goto('/#/measurements');
    const chartHint = page.getByText(
      'Registra al menos dos pesos para ver tu progreso'
    );
    const chart = page.getByRole('img', { name: 'Gráfico de progreso' });
    await expect(chartHint).toBeVisible();
    await expect(chart).toHaveCount(0);

    await dateInput(page).fill('2026-02-01');
    await weightInput(page).fill('70');
    await saveMeasurement(page);
    await expect(chartHint).toBeVisible();
    await expect(chart).toHaveCount(0);

    await dateInput(page).fill('2026-02-08');
    await weightInput(page).fill('71');
    await saveMeasurement(page);
    await expect(chart).toBeVisible();
    await expect(chartHint).toHaveCount(0);
  });

  test('edits a record by its date without creating a duplicate', async ({
    login,
    reset,
    api,
    page,
  }) => {
    await api.seedMeasurement({ date: '2026-01-20', weightKg: 70 });

    await page.goto('/#/measurements');
    await page
      .locator('.measurement-row')
      .filter({ hasText: '70 kg' })
      .getByRole('button', { name: 'Editar medida' })
      .click();

    await expect(
      page.getByRole('heading', { name: 'Editar registro' })
    ).toBeVisible();
    await expect(dateInput(page)).toHaveValue('2026-01-20');
    await expect(weightInput(page)).toHaveValue('70');

    await weightInput(page).fill('73');
    await saveMeasurement(page);

    await expect(page.getByText('Medida guardada')).toBeVisible();
    const rows = page.locator('.measurement-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('73 kg');
    await expect(
      page.getByRole('heading', { name: 'Nuevo registro' })
    ).toBeVisible();
  });

  test('cancelling an edit restores the new-record form', async ({
    login,
    reset,
    api,
    page,
  }) => {
    await api.seedMeasurement({ date: '2026-01-20', weightKg: 70 });

    await page.goto('/#/measurements');
    await page
      .locator('.measurement-row')
      .getByRole('button', { name: 'Editar medida' })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Editar registro' })
    ).toBeVisible();

    await page.getByRole('button', { name: 'Cancelar' }).click();

    await expect(
      page.getByRole('heading', { name: 'Nuevo registro' })
    ).toBeVisible();
    await expect(weightInput(page)).toHaveValue('');
    await expect(page.locator('.measurement-row')).toContainText('70 kg');
  });

  test('deletes a record only after confirmation', async ({
    login,
    reset,
    api,
    page,
  }) => {
    await api.seedMeasurement({ date: '2026-01-20', weightKg: 70 });

    await page.goto('/#/measurements');
    await page.getByRole('button', { name: 'Eliminar medida' }).click();

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Eliminar medida' })
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.measurement-row')).toContainText('70 kg');

    await page.getByRole('button', { name: 'Eliminar medida' }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Eliminar', exact: true }).click();

    await expect(page.getByText('Medida eliminada')).toBeVisible();
    await expect(page.locator('.measurement-row')).toHaveCount(0);
    await expect(page.getByText('Sin medidas aún')).toBeVisible();
    await expect(
      page.getByText('Registra al menos dos pesos para ver tu progreso')
    ).toBeVisible();
  });

  test('shows the empty state when there are no records', async ({
    login,
    reset,
    page,
  }) => {
    await page.goto('/#/measurements');

    await expect(page.getByText('Sin medidas aún')).toBeVisible();
    await expect(page.getByText('Aún sin registros')).toBeVisible();
    await expect(
      page.getByText('Registra al menos dos pesos para ver tu progreso')
    ).toBeVisible();
  });
});
