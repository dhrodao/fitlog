/**
 * Google Identity Services stubs. They let the login screen exercise its own
 * Google code path (script load, initialize, button render, credential POST)
 * without contacting Google or relaxing the real server authentication.
 */

const CONFIG = {
  googleEnabled: true,
  googleClientId: 'e2e-client',
  devLoginEnabled: true,
};

// Minimal stand-in for the GIS client. The app stores the callback through
// initialize() and renders the button through renderButton(); our stub button
// invokes that callback with a fake credential when clicked.
const GIS_STUB = `
window.google = {
  accounts: {
    id: {
      initialize(config) {
        window.__fitlogGoogleCallback = config.callback;
      },
      renderButton(parent) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Continuar con Google';
        button.addEventListener('click', () => {
          if (window.__fitlogGoogleCallback) {
            window.__fitlogGoogleCallback({ credential: 'e2e-credential' });
          }
        });
        parent.replaceChildren(button);
      },
    },
  },
};
`;

export function googleStubButton(page) {
  return page.getByRole('button', { name: 'Continuar con Google' });
}

/**
 * Serves a config that enables Google and a fake GIS script, so the login
 * screen renders the stub button. Register it before the first navigation.
 */
export async function enableGoogleStub(page) {
  await page.route('**/api/auth/config', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(CONFIG),
    })
  );
  await page.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: GIS_STUB,
    })
  );
}

/**
 * Handles the credential POST by creating a real dev session through the
 * context request client, then answers the page with that user. The cookie
 * lands in the shared jar, so the browser ends up genuinely authenticated.
 */
export async function acceptGoogleCredential(page, context) {
  await page.route('**/api/auth/google', async (route) => {
    const response = await context.request.post('/api/auth/dev');
    await route.fulfill({
      status: response.status(),
      contentType: 'application/json',
      body: await response.text(),
    });
  });
}

export async function rejectGoogleCredential(page, status, message) {
  await page.route('**/api/auth/google', (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ error: message }),
    })
  );
}
