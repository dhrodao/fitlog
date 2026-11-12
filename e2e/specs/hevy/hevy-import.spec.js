import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../fixtures/index.js';
import { uniqueName } from '../../fixtures/data.js';

const CSV_PATH = fileURLToPath(
  new URL('../../support/hevy-workouts.fixture.csv', import.meta.url)
);

function toast(page, text) {
  return page.locator('.toast').filter({ hasText: text }).last();
}

async function openImportModal(page) {
  await page.getByRole('button', { name: 'Importar de Hevy' }).click();
  const modal = page.getByRole('dialog');
  await expect(
    modal.getByRole('heading', { name: 'Importar de Hevy' })
  ).toBeVisible();
  return modal;
}

async function selectCsv(modal) {
  await modal.locator('[data-csv-file]').setInputFiles(CSV_PATH);
  // The change handler reads the file asynchronously; wait until the name is
  // rendered before any action can run the import.
  await expect(modal.locator('[data-csv-name]')).toContainText('KB');
}

test.describe('Hevy CSV import', () => {
  test('previews a CSV without writing, then imports it', async ({
    login,
    reset,
    api,
    page,
  }) => {
    await page.goto('/#/profile');
    const modal = await openImportModal(page);
    await selectCsv(modal);

    await modal.getByRole('button', { name: 'Previsualizar' }).click();
    const rows = modal.locator('.import-summary-row');
    await expect(
      rows.filter({ hasText: 'Entrenos a importar' })
    ).toContainText('2');
    await expect(rows.filter({ hasText: 'Ejercicios' })).toContainText('2');
    await expect(rows.filter({ hasText: 'Series' })).toContainText('3');
    expect(await api.listWorkouts()).toHaveLength(0);

    await modal.getByRole('button', { name: 'Importar' }).click();
    await expect(toast(page, 'Importados 2 entrenos')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    expect(await api.listWorkouts()).toHaveLength(2);
    await page.goto('/#/workouts');
    const cards = page.locator('.workout-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.filter({ hasText: 'Hevy E2E Push' })).toHaveCount(1);
    await expect(cards.filter({ hasText: 'Hevy E2E Pull' })).toHaveCount(1);
  });

  test('importing the same CSV again reports duplicates and creates nothing', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const csv = await readFile(CSV_PATH, 'utf8');
    const first = await api.importHevyCsv(csv, true);
    expect(first.totals.imported).toBe(2);
    expect(await api.listWorkouts()).toHaveLength(2);

    await page.goto('/#/profile');
    const modal = await openImportModal(page);
    await selectCsv(modal);
    await modal.getByRole('button', { name: 'Importar' }).click();

    const duplicates = modal
      .locator('.import-summary-row')
      .filter({ hasText: 'Omitidos (duplicados)' });
    await expect(duplicates).toContainText('2 (2)');
    await expect(toast(page, 'Importados 0 entrenos')).toBeVisible();
    expect(await api.listWorkouts()).toHaveLength(2);
  });

  test('deleting imported data keeps workouts that were logged by hand', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const csv = await readFile(CSV_PATH, 'utf8');
    await api.importHevyCsv(csv, true);

    const exercise = await api.seedExercise(uniqueName('Manual Delete'));
    await api.seedWorkout({
      clientId: uniqueName('manual-workout'),
      name: 'Manual E2E',
      startedAt: '2026-01-10T10:00:00.000Z',
      finishedAt: '2026-01-10T10:30:00.000Z',
      exercises: [
        {
          exerciseId: exercise.id,
          sets: [{ weightKg: 40, reps: 8, completed: true }],
        },
      ],
    });

    await page.goto('/#/profile');
    const flush = page.getByRole('button', {
      name: /Eliminar datos importados de Hevy/,
    });
    await expect(flush).toContainText('2 entrenos');

    await flush.click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Eliminar datos de Hevy' })
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /Eliminar datos importados de Hevy/ })
    ).toBeVisible();

    await page
      .getByRole('button', { name: /Eliminar datos importados de Hevy/ })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Eliminar', exact: true })
      .click();

    await expect(toast(page, 'Eliminados 2 entrenos de Hevy')).toBeVisible();
    await page.goto('/#/workouts');
    const cards = page.locator('.workout-card');
    await expect(cards).toHaveCount(1);
    await expect(cards.filter({ hasText: 'Manual E2E' })).toHaveCount(1);
    await expect(cards.filter({ hasText: 'Hevy E2E Push' })).toHaveCount(0);
  });

  test('an imported workout is read-only and cannot be edited', async ({
    login,
    reset,
    api,
    page,
  }) => {
    const csv = await readFile(CSV_PATH, 'utf8');
    await api.importHevyCsv(csv, true);

    const workouts = await api.listWorkouts();
    const imported = workouts.find((w) => w.name === 'Hevy E2E Push');
    expect(imported).toBeTruthy();

    await page.goto(`/#/workouts/${imported.id}`);
    await expect(
      page.getByText('Importado de Hevy · solo lectura')
    ).toBeVisible();

    await page.getByRole('button', { name: 'Opciones' }).click();
    const sheet = page.getByRole('dialog');
    await expect(
      sheet.getByRole('button', { name: 'Editar entrenamiento' })
    ).toHaveCount(0);
    await expect(
      sheet.getByRole('button', { name: 'Eliminar entrenamiento' })
    ).toBeVisible();
  });

  test('an imported routine blocks the editor when opened by URL', async ({
    login,
    page,
  }) => {
    await page.route('**/api/routines/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          routine: {
            id: 999,
            name: 'Rutina Hevy',
            source: 'hevy',
            description: '',
            folder: null,
            exercises: [],
          },
        }),
      })
    );

    await page.goto('/#/routines/999/edit');
    await expect(
      page.getByRole('heading', { name: 'Rutina de solo lectura' })
    ).toBeVisible();
    await expect(
      page.getByText(/no se puede editar/)
    ).toBeVisible();
  });
});
