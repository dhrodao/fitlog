import { test, expect } from '../../fixtures/index.js';
import {
  fulfillJson,
  hevyStatus,
  installHevyMock,
} from '../../fixtures/hevy-mocks.js';

function toast(page, text) {
  return page.locator('.toast').filter({ hasText: text }).last();
}

test.describe('Hevy connection', () => {
  test('the disconnected card guards empty keys and missing files', async ({
    login,
    reset,
    page,
  }) => {
    const requests = await installHevyMock(page, {
      status: { connected: false },
    });

    await page.goto('/#/profile');
    const card = page.locator('[data-sync-disconnected]');
    await expect(card).toBeVisible();
    await expect(card.locator('[data-sync-key]')).toBeVisible();

    await card.getByRole('button', { name: 'Conectar con Hevy' }).click();
    await expect(toast(page, 'Introduce tu API key')).toBeVisible();
    expect(
      requests.filter((r) => r.path.endsWith('/hevy/sync/connect'))
    ).toHaveLength(0);

    await page.getByRole('button', { name: 'Importar de Hevy' }).click();
    const modal = page.getByRole('dialog');
    await expect(
      modal.getByRole('heading', { name: 'Importar de Hevy' })
    ).toBeVisible();

    await modal.getByRole('button', { name: 'Previsualizar' }).click();
    await expect(toast(page, 'Elige primero el archivo CSV')).toBeVisible();

    await modal.getByRole('button', { name: 'API de Hevy' }).click();
    await modal.getByRole('button', { name: 'Previsualizar' }).click();
    await expect(toast(page, 'Introduce tu API key')).toBeVisible();

    expect(
      requests.filter((r) => /\/hevy\/(csv|api)$/.test(r.path))
    ).toHaveLength(0);
  });

  test('connecting shows the connected card with the masked key', async ({
    login,
    reset,
    page,
  }) => {
    const requests = await installHevyMock(page, {
      status: { connected: false },
      connect: (route) =>
        fulfillJson(route, 200, {
          ok: true,
          status: hevyStatus({ keyMasked: 'hvy-••••-9f2' }),
        }),
    });

    await page.goto('/#/profile');
    const card = page.locator('[data-sync-disconnected]');
    await card.locator('[data-sync-key]').fill('hevy-secret-key');
    await card.getByRole('button', { name: 'Conectar con Hevy' }).click();

    await expect(toast(page, 'Cuenta de Hevy conectada')).toBeVisible();
    const connected = page.locator('[data-sync-connected]');
    await expect(connected).toContainText('Conectado a Hevy');
    await expect(connected).toContainText('hvy-••••-9f2');
    await expect(
      connected.getByRole('button', { name: 'Sincronizar ahora' })
    ).toBeVisible();

    const connect = requests.find((r) =>
      r.path.endsWith('/hevy/sync/connect')
    );
    expect(connect.body).toEqual({
      apiKey: 'hevy-secret-key',
      autoSync: true,
    });
  });

  test('a rejected key shows the error and leaves the card usable', async ({
    login,
    reset,
    page,
  }) => {
    let calls = 0;
    await installHevyMock(page, {
      status: { connected: false },
      connect: (route) => {
        calls += 1;
        if (calls === 1) {
          return fulfillJson(route, 401, {
            error: 'La API key de Hevy no es válida',
          });
        }
        return fulfillJson(route, 429, {
          error: 'Demasiadas solicitudes a Hevy',
        });
      },
    });

    await page.goto('/#/profile');
    const card = page.locator('[data-sync-disconnected]');
    await card.locator('[data-sync-key]').fill('bad-key');
    const button = card.getByRole('button', { name: 'Conectar con Hevy' });

    // A 401 is mapped by the shared API client to the session-expired copy,
    // so that is what the card surfaces for an invalid key.
    await button.click();
    await expect(card.locator('.import-error')).toHaveText(
      'Tu sesión ha caducado. Vuelve a entrar.'
    );
    await expect(button).toBeEnabled();

    await button.click();
    await expect(card.locator('.import-error')).toHaveText(
      'Demasiadas solicitudes a Hevy'
    );
    await expect(page.locator('[data-sync-disconnected]')).toBeVisible();
  });

  test('disconnecting asks first and then shows the connect form', async ({
    login,
    reset,
    page,
  }) => {
    await installHevyMock(page, {
      status: hevyStatus(),
      disconnect: (route) =>
        fulfillJson(route, 200, {
          ok: true,
          status: { connected: false },
        }),
    });

    await page.goto('/#/profile');
    const card = page.locator('[data-sync-connected]');
    await card.getByRole('button', { name: 'Desconectar' }).click();

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Desconectar Hevy' })
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-sync-connected]')).toBeVisible();

    await card.getByRole('button', { name: 'Desconectar' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Desconectar', exact: true })
      .click();

    await expect(toast(page, 'Cuenta de Hevy desconectada')).toBeVisible();
    await expect(page.locator('[data-sync-disconnected]')).toBeVisible();
  });
});
