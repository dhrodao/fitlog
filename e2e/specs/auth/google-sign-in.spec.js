import { test, expect } from '../../fixtures/index.js';
import {
  acceptGoogleCredential,
  enableGoogleStub,
  googleStubButton,
  rejectGoogleCredential,
} from '../../fixtures/google-stub.js';

test.describe('Google sign-in', () => {
  test('a stubbed credential lands in a real session', async ({
    context,
    page,
  }) => {
    await enableGoogleStub(page);
    await acceptGoogleCredential(page, context);

    await page.goto('/');
    const button = googleStubButton(page);
    await expect(button).toBeVisible();
    await button.click();

    await expect(page).toHaveURL(/#\/$/);
    await expect(
      page.getByRole('heading', { name: 'Atleta', exact: true })
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Atleta', exact: true })
    ).toBeVisible();
    await expect(page.locator('[data-dev-login]')).toHaveCount(0);
  });

  test('a rejected credential shows the message and keeps the login screen', async ({
    page,
  }) => {
    await enableGoogleStub(page);
    await rejectGoogleCredential(
      page,
      403,
      'Esta cuenta no tiene acceso a esta instancia'
    );

    await page.goto('/');
    await googleStubButton(page).click();

    await expect(page.locator('#login-error .notice.danger')).toContainText(
      'Esta cuenta no tiene acceso a esta instancia'
    );
    await expect(page).toHaveURL(/#\/login$/);
    await expect(googleStubButton(page)).toBeVisible();

    await page.unroute('**/api/auth/google');
    await rejectGoogleCredential(
      page,
      401,
      'No se pudo verificar la cuenta de Google'
    );
    await googleStubButton(page).click();
    // errorMessage() maps every 401 to the session-expired copy, whatever the
    // response body says.
    await expect(page.locator('#login-error .notice.danger')).toContainText(
      'Tu sesión ha caducado. Vuelve a entrar.'
    );
    await expect(page).toHaveURL(/#\/login$/);
  });

  test('a Google script that cannot load falls back to the demo login', async ({
    page,
  }) => {
    await enableGoogleStub(page);
    // Registered last, so it takes precedence over the happy-path stub.
    await page.route('https://accounts.google.com/gsi/client', (route) =>
      route.abort()
    );

    await page.goto('/');
    await expect(page.locator('#login-error .notice.danger')).toContainText(
      'No se pudo cargar el acceso con Google. Puedes usar el modo demo si está disponible.'
    );

    await page.locator('[data-dev-login]').click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(
      page.getByRole('heading', { name: 'Atleta', exact: true })
    ).toBeVisible();
  });
});
