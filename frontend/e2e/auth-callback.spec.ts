import { test, expect, mockUser } from './fixtures/auth';

test.describe('Auth Callback', () => {
  test('successful callback redirects to dashboard', async ({ page }) => {
    // Mock the token exchange endpoint
    await page.route('**/auth/callback*', (route) => {
      // Only intercept API calls (GET with code param), not page navigation
      if (
        route.request().resourceType() === 'xhr' ||
        route.request().resourceType() === 'fetch'
      ) {
        return route.fulfill({
          status: 200,
          json: {
            access_token: 'fake-access-token',
            id_token:
              'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c3JfdGVzdF8wMDEiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJ0ZXN0dXNlciIsImVtYWlsIjoidGVzdEBleGFtcGxlLmNvbSJ9.fake',
          },
        });
      }
      return route.continue();
    });

    // Mock the profile fetch (called after token is saved)
    await page.route('**/auth/profile', (route) =>
      route.fulfill({ status: 200, json: mockUser }),
    );

    await page.goto('/auth/callback?code=test_auth_code_123');

    // Should redirect to dashboard after successful auth
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
  });

  test('missing code param redirects to home', async ({ page }) => {
    await page.route('**/auth/profile', (route) =>
      route.fulfill({ status: 401, json: { message: 'Unauthorized' } }),
    );

    await page.goto('/auth/callback');

    // Callback component navigates to / when no code is present
    await expect(page).toHaveURL(/localhost:\d+\/?$/, { timeout: 10000 });
  });

  test('failed token exchange redirects to home', async ({ page }) => {
    await page.route('**/auth/callback*', (route) => {
      if (
        route.request().resourceType() === 'xhr' ||
        route.request().resourceType() === 'fetch'
      ) {
        return route.fulfill({
          status: 401,
          json: { message: 'Invalid code' },
        });
      }
      return route.continue();
    });

    await page.route('**/auth/profile', (route) =>
      route.fulfill({ status: 401, json: { message: 'Unauthorized' } }),
    );

    await page.goto('/auth/callback?code=invalid_code');

    // Should redirect to home on error
    await expect(page).toHaveURL(/localhost:\d+\/?$/, { timeout: 10000 });
  });
});
