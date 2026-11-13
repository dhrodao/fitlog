import { test, expect } from '../../fixtures/index.js';

// The second webServer boots the same app with ALLOW_DEV_LOGIN=false, so this
// spec proves the disabled state for real (both the UI and the endpoint).
const NO_DEV_LOGIN_URL =
  process.env.E2E_NO_DEV_LOGIN_URL || 'http://127.0.0.1:3101';

test.use({ baseURL: NO_DEV_LOGIN_URL });

test.describe('Dev login disabled', () => {
  test('the demo button is absent and the endpoint returns 404', async ({
    context,
    page,
  }) => {
    await page.goto('/');

    await expect(
      page.getByText(
        'El acceso no está configurado. Define GOOGLE_CLIENT_ID en el servidor.'
      )
    ).toBeVisible();
    await expect(page.locator('[data-dev-login]')).toHaveCount(0);

    const response = await context.request.post('/api/auth/dev');
    expect(response.status()).toBe(404);
  });
});
