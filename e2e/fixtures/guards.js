// Console and page-error messages that are expected noise rather than a
// user-facing failure. Resource-load failures are emitted by the browser when
// a test intentionally aborts a request (for example the stubbed Google
// script), so they must not fail the guard on their own.
const BENIGN_CONSOLE_PATTERNS = [
  /Failed to load resource/i,
  /net::ERR_/i,
  /favicon\.ico/i,
];

function isBenign(message) {
  return BENIGN_CONSOLE_PATTERNS.some((pattern) => pattern.test(message));
}

export function collectPageErrors(page) {
  const errors = [];

  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`);
  });

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (isBenign(text)) return;
    errors.push(`console.error: ${text}`);
  });

  return errors;
}

/**
 * Rejects any browser request whose origin is not the test server. Requests
 * fulfilled by a more specific route registered inside the test take
 * precedence, so stubs keep working. Server-to-server calls are invisible to
 * this guard by design (Hevy specs mock the browser-facing endpoints).
 */
export async function installExternalHostGuard(page, baseURL) {
  const origin = new URL(baseURL).origin;
  const offenders = [];

  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (!/^https?:/i.test(url)) return route.continue();
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return route.continue();
    }
    if (parsed.origin === origin) return route.continue();
    offenders.push(url);
    return route.abort();
  });

  return offenders;
}
