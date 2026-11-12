import { test, expect } from '../../fixtures/index.js';
import {
  fulfillJson,
  hevyStatus,
  installHevyMock,
} from '../../fixtures/hevy-mocks.js';

function toast(page, text) {
  return page.locator('.toast').filter({ hasText: text }).last();
}

function gate() {
  let release;
  const opened = new Promise((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

test.describe('Hevy sync card', () => {
  test('a manual sync shows the busy state, the totals and the toast', async ({
    login,
    reset,
    page,
  }) => {
    const { opened, release } = gate();
    const requests = await installHevyMock(page, {
      status: hevyStatus(),
      run: async (route) => {
        await opened;
        return fulfillJson(route, 200, {
          ok: true,
          totals: {
            imported: 2,
            exercises: 3,
            sets: 6,
            routinesImported: 1,
            routinesUpdated: 0,
          },
          status: hevyStatus({
            lastSyncAt: '2026-02-11T08:00:00.000Z',
          }),
        });
      },
    });

    await page.goto('/#/profile');
    const card = page.locator('[data-sync-connected]');
    const syncNow = card.getByRole('button', { name: 'Sincronizar ahora' });

    await syncNow.click();
    await expect(card.getByText('Sincronizando…')).toBeVisible();
    await expect(syncNow).toBeDisabled();

    release();

    const result = card.locator('[data-sync-result]');
    await expect(
      result.locator('.import-summary-row').filter({
        hasText: 'Entrenos importados',
      })
    ).toContainText('2');
    await expect(
      result.locator('.import-summary-row').filter({
        hasText: 'Rutinas importadas',
      })
    ).toContainText('1');
    await expect(
      toast(page, 'Sincronizado: +2 entrenos, 1 rutinas')
    ).toBeVisible();
    expect(
      requests.filter((r) => r.path.endsWith('/hevy/sync/run'))
    ).toHaveLength(1);
  });

  test('a sync with nothing new says everything is up to date', async ({
    login,
    reset,
    page,
  }) => {
    await installHevyMock(page, { status: hevyStatus() });

    await page.goto('/#/profile');
    const card = page.locator('[data-sync-connected]');
    await card.getByRole('button', { name: 'Sincronizar ahora' }).click();

    const result = card.locator('[data-sync-result]');
    await expect(result).toContainText('Todo al día');
    await expect(result).toContainText('Sin cambios');
    await expect(toast(page, 'Ya estabas al día')).toBeVisible();
  });

  test('the status line shows errors, warnings or nothing', async ({
    login,
    reset,
    page,
  }) => {
    let status = hevyStatus({
      lastStatus: 'error',
      lastError: 'Fallo de sincronización de prueba',
    });
    await installHevyMock(page, { status: () => status });

    await page.goto('/#/profile');
    const card = page.locator('[data-sync-connected]');
    await expect(card.locator('.import-error')).toHaveText(
      'Fallo de sincronización de prueba'
    );

    status = hevyStatus({
      lastStatus: 'warning',
      lastWarning: 'Sincronización parcial',
    });
    await page.reload();
    await expect(card.locator('.import-warning')).toHaveText(
      'Sincronización parcial'
    );

    status = hevyStatus();
    await page.reload();
    await expect(card.locator('.import-error')).toHaveCount(0);
    await expect(card.locator('.import-warning')).toHaveCount(0);
    await expect(card).toContainText('última sync:');
  });

  test('all card actions stay disabled while a sync is in flight', async ({
    login,
    reset,
    page,
  }) => {
    const { opened, release } = gate();
    const requests = await installHevyMock(page, {
      status: hevyStatus(),
      run: async (route) => {
        await opened;
        return fulfillJson(route, 200, {
          ok: true,
          totals: { imported: 0, exercises: 0, sets: 0 },
          status: hevyStatus(),
        });
      },
    });

    await page.goto('/#/profile');
    const card = page.locator('[data-sync-connected]');
    const syncNow = card.getByRole('button', { name: 'Sincronizar ahora' });

    await syncNow.click();
    await expect(syncNow).toBeDisabled();
    await expect(
      card.getByRole('button', { name: 'Desconectar' })
    ).toBeDisabled();

    release();
    await expect(card.locator('[data-sync-result]')).toContainText(
      'Todo al día'
    );
    expect(
      requests.filter((r) => r.path.endsWith('/hevy/sync/run'))
    ).toHaveLength(1);
  });

  test('the auto-sync toggle reports success and rolls back on failure', async ({
    login,
    reset,
    page,
  }) => {
    let fail = false;
    await installHevyMock(page, {
      status: hevyStatus({ autoSync: true }),
      setAuto: (route, { body }) => {
        if (fail) {
          return fulfillJson(route, 500, {
            error: 'No se pudo guardar la preferencia',
          });
        }
        return fulfillJson(route, 200, {
          ok: true,
          status: hevyStatus({ autoSync: body.autoSync }),
        });
      },
    });

    await page.goto('/#/profile');
    const auto = page.locator('[data-sync-auto]');
    await expect(auto).toBeChecked();

    await auto.uncheck();
    await expect(
      toast(page, 'Sincronización automática desactivada')
    ).toBeVisible();
    await expect(auto).not.toBeChecked();

    fail = true;
    await auto.check();
    await expect(
      toast(page, 'No se pudo guardar la preferencia')
    ).toBeVisible();
    await expect(auto).not.toBeChecked();
  });

  test('the webhook toggle explains when it is unavailable and works when it is', async ({
    login,
    reset,
    page,
  }) => {
    let status = hevyStatus({ webhookAvailable: false });
    await installHevyMock(page, { status: () => status });

    await page.goto('/#/profile');
    const card = page.locator('[data-sync-connected]');
    await expect(card).toContainText('Webhook en tiempo real no disponible');
    await expect(card).toContainText('PUBLIC_URL');

    status = hevyStatus({ webhookAvailable: true, webhookEnabled: false });
    await page.reload();
    const webhook = page.locator('[data-sync-webhook]');
    await expect(webhook).not.toBeChecked();

    await webhook.check();
    await expect(
      toast(page, 'Webhook en tiempo real activado')
    ).toBeVisible();
    await expect(page.locator('[data-sync-webhook]')).toBeChecked();

    await page.locator('[data-sync-webhook]').uncheck();
    await expect(toast(page, 'Webhook desactivado')).toBeVisible();
    await expect(page.locator('[data-sync-webhook]')).not.toBeChecked();
  });
});
