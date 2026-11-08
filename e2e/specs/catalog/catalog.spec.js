import { test, expect } from '../../fixtures/index.js';

const results = (page) => page.locator('[data-results]');
const cards = (page) => results(page).locator('[data-exercise]');
const cardNames = (page) => cards(page).locator('.n').allTextContents();

async function openCatalog(page) {
  await page.goto('/#/exercises');
  await expect(page.locator('.topbar-title')).toHaveText('Ejercicios');
  await expect(cards(page).first()).toBeVisible();
}

test.describe('Browsing the exercise catalog', () => {
  test('lists seeded exercises and category chips with counts', async ({
    login,
    page,
  }) => {
    await page.goto('/#/routines');
    await expect(
      page.getByRole('heading', { name: 'Entrenamiento', exact: true })
    ).toBeVisible();

    await page.locator('[data-explore]').click();

    await expect(page.locator('.topbar-title')).toHaveText('Ejercicios');
    await expect(cards(page).first()).toBeVisible();

    await expect(page.locator('[data-category=""]')).toHaveText('Todos');
    await expect(page.locator('[data-category="Pecho"]')).toHaveText(
      'Pecho 45'
    );
    await expect(page.locator('[data-category="Piernas"]')).toHaveText(
      'Piernas 2'
    );
    await expect(page.locator('[data-category="Abdominales"]')).toHaveText(
      'Abdominales 1'
    );
    await expect(page.locator('[data-category="Cardio"]')).toHaveText(
      'Cardio 2'
    );

    await expect(cards(page)).toHaveCount(40);
    await expect(
      page.locator('[data-exercise="e2e-cardio-01"]')
    ).toBeVisible();
    await expect(page.locator('[data-exercise="e2e-core-01"]')).toBeVisible();
    await expect(page.locator('[data-exercise="e2e-chest-01"]')).toBeVisible();
  });

  test('filters by search and shows the empty result state', async ({
    login,
    page,
  }) => {
    await openCatalog(page);
    const search = page.getByPlaceholder('Buscar ejercicio...');

    await search.fill('Pierna E2E');
    await expect(cards(page)).toHaveCount(2);
    expect(await cardNames(page)).toEqual([
      'Pierna E2E 01',
      'Pierna E2E 02',
    ]);

    await search.fill('xyz-no-existe');
    await expect(cards(page)).toHaveCount(0);
    await expect(
      results(page).getByRole('heading', { name: 'Sin resultados' })
    ).toBeVisible();
    await expect(
      results(page).getByText('Prueba con otro término o categoría.')
    ).toBeVisible();
  });

  test('filters by category chip and restores the mixed list', async ({
    login,
    page,
  }) => {
    await openCatalog(page);
    const pecho = page.locator('[data-category="Pecho"]');
    const todos = page.locator('[data-category=""]');

    await pecho.click();

    await expect(pecho).toHaveClass(/\bactive\b/);
    await expect(todos).not.toHaveClass(/\bactive\b/);
    await expect(cards(page)).toHaveCount(40);
    await expect
      .poll(async () => {
        const names = await cardNames(page);
        return names.length > 0 && names.every((name) => name.startsWith('Pecho E2E '));
      })
      .toBe(true);
    await expect(page.locator('[data-exercise="e2e-chest-01"]')).toBeVisible();
    await expect(
      page.locator('[data-exercise="e2e-cardio-01"]')
    ).toHaveCount(0);

    await todos.click();

    await expect(todos).toHaveClass(/\bactive\b/);
    await expect(pecho).not.toHaveClass(/\bactive\b/);
    await expect(
      page.locator('[data-exercise="e2e-cardio-01"]')
    ).toBeVisible();
    await expect(page.locator('[data-exercise="e2e-chest-01"]')).toBeVisible();
  });

  test('loads the whole category while scrolling without duplicates', async ({
    login,
    page,
  }) => {
    await openCatalog(page);
    await page.locator('[data-category="Pecho"]').click();
    await expect(cards(page)).toHaveCount(40);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const count = await cards(page).count();
      if (count === 45) break;

      const sentinel = page.locator('[data-sentinel]');
      if (await sentinel.count()) {
        await sentinel.scrollIntoViewIfNeeded();
      } else {
        await cards(page).last().scrollIntoViewIfNeeded();
      }

      await expect.poll(() => cards(page).count()).toBeGreaterThan(count);
    }

    await expect(cards(page)).toHaveCount(45);
    await expect(page.locator('[data-exercise="e2e-chest-45"]')).toBeVisible();

    const names = await cardNames(page);
    const expected = Array.from(
      { length: 45 },
      (_, index) => `Pecho E2E ${String(index + 1).padStart(2, '0')}`
    );
    expect(names.slice().sort()).toEqual(expected.slice().sort());
    expect(new Set(names).size).toBe(45);
  });
});

test.describe('Catalog API failure states', () => {
  test('search failure shows an inline danger notice', async ({
    login,
    page,
  }) => {
    await page.route('**/api/exercises/search*', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'No se pudo cargar el catálogo' }),
      })
    );

    await page.goto('/#/exercises');
    await expect(page.locator('.topbar-title')).toHaveText('Ejercicios');

    const notice = results(page).locator('.notice.danger');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('No se pudo cargar el catálogo');
  });

  test('detail failure shows an inline notice in the modal', async ({
    login,
    page,
  }) => {
    await openCatalog(page);

    await page.route('**/api/exercises/catalog/*', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Ejercicio no encontrado' }),
      })
    );

    await page.locator('[data-exercise="e2e-cardio-01"]').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('heading', { name: 'Cardio E2E 01' })
    ).toBeVisible();
    const notice = dialog.locator('.notice.danger');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Ejercicio no encontrado');
  });
});
