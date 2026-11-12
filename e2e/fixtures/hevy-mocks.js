/**
 * Hevy UI fixtures. The server talks to api.hevyapp.com itself, so the browser
 * cannot intercept those calls. These helpers instead mock the Fitlog
 * `/api/import/hevy/**` endpoints the browser does call, keeping every Tier-1
 * test local and deterministic. The CSV import specs use the real backend.
 */

export function fulfillJson(route, status, body) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

export function hevyStatus(overrides = {}) {
  return {
    connected: true,
    autoSync: true,
    keyMasked: 'abcd••••wxyz',
    lastSyncAt: '2026-02-10T09:00:00.000Z',
    lastStatus: null,
    lastError: null,
    lastWarning: null,
    syncing: false,
    webhookEnabled: false,
    webhookAvailable: true,
    ...overrides,
  };
}

export const EMPTY_SYNC_TOTALS = {
  workouts: 0,
  imported: 0,
  skipped: 0,
  duplicates: 0,
  exercises: 0,
  sets: 0,
  matched: 0,
  custom: 0,
  routinesImported: 0,
  routinesUpdated: 0,
};

function readBody(request) {
  try {
    return request.postDataJSON();
  } catch {
    return null;
  }
}

/**
 * Registers one route for the whole Hevy API surface and returns the list of
 * requests it saw (useful to prove no request was sent, or only one).
 *
 * `status` and `data` may be values or getters, so a test can change the
 * mocked connection state and reload. Each operation accepts a custom handler
 * `(route, context) => ...`; unhandled writes are aborted instead of reaching
 * the real server, which also honours the guard rail of never submitting a key
 * to the backend un-mocked.
 */
export async function installHevyMock(page, options = {}) {
  const {
    status = { connected: false },
    data = { count: 0, routines: 0 },
    connect,
    run,
    setAuto,
    disconnect,
    enableWebhook,
    disableWebhook,
    importCsv,
    importApi,
    flush,
  } = options;

  const requests = [];
  const current = (value) => (typeof value === 'function' ? value() : value);
  const currentStatus = () => current(status);

  await page.route('**/api/import/hevy/**', (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    const body = readBody(request);
    requests.push({ method, path, body });

    if (method === 'GET' && path === '/api/import/hevy/sync') {
      return fulfillJson(route, 200, currentStatus());
    }
    if (method === 'GET' && path === '/api/import/hevy/data') {
      return fulfillJson(route, 200, current(data));
    }
    if (method === 'POST' && path === '/api/import/hevy/sync/connect') {
      if (connect) return connect(route, { body, requests });
      return fulfillJson(route, 200, { ok: true, status: hevyStatus() });
    }
    if (method === 'POST' && path === '/api/import/hevy/sync/run') {
      if (run) return run(route, { body, requests });
      return fulfillJson(route, 200, {
        ok: true,
        totals: EMPTY_SYNC_TOTALS,
        status: hevyStatus(),
      });
    }
    if (method === 'PATCH' && path === '/api/import/hevy/sync') {
      if (setAuto) return setAuto(route, { body, requests });
      return fulfillJson(route, 200, {
        ok: true,
        status: hevyStatus({ autoSync: body?.autoSync }),
      });
    }
    if (method === 'DELETE' && path === '/api/import/hevy/sync') {
      if (disconnect) return disconnect(route, { body, requests });
      return fulfillJson(route, 200, {
        ok: true,
        status: { connected: false },
      });
    }
    if (method === 'POST' && path === '/api/import/hevy/sync/webhook') {
      if (enableWebhook) return enableWebhook(route, { body, requests });
      return fulfillJson(route, 200, {
        ok: true,
        status: hevyStatus({ webhookEnabled: true }),
      });
    }
    if (method === 'DELETE' && path === '/api/import/hevy/sync/webhook') {
      if (disableWebhook) return disableWebhook(route, { body, requests });
      return fulfillJson(route, 200, {
        ok: true,
        status: hevyStatus({ webhookEnabled: false }),
      });
    }
    if (method === 'POST' && path === '/api/import/hevy/csv') {
      if (importCsv) return importCsv(route, { body, requests });
      return route.abort();
    }
    if (method === 'POST' && path === '/api/import/hevy/api') {
      if (importApi) return importApi(route, { body, requests });
      return route.abort();
    }
    if (method === 'DELETE' && path === '/api/import/hevy/data') {
      if (flush) return flush(route, { body, requests });
      return fulfillJson(route, 200, { ok: true, deleted: 0, routines: 0 });
    }
    return route.abort();
  });

  return requests;
}
