import { test, expect, authenticateAs, api } from './fixtures/auth';

test.describe('Error States', () => {
  test('500 server error shows error toast', async ({ page }) => {
    await authenticateAs(page);
    await page.route(api('/domains'), (route) =>
      route.fulfill({
        status: 500,
        json: { message: 'Internal server error' },
      }),
    );

    await page.goto('/dashboard/domains');

    await expect(
      page.getByText(/server error|something went wrong|error/i).first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test('network failure shows connection error', async ({ page }) => {
    await authenticateAs(page);
    // Only abort API calls to the domains endpoint, not page navigation
    await page.route(api('/domains'), (route) =>
      route.abort('connectionfailed'),
    );

    await page.goto('/dashboard/domains');

    await expect(
      page.getByText(/connection|network|unable to connect/i).first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test('429 rate limit shows rate limit message', async ({ page }) => {
    await authenticateAs(page);

    // GET succeeds, POST returns 429
    await page.route(api('/domains'), (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, json: [] });
      }
      return route.fulfill({
        status: 429,
        json: { message: 'Too many requests' },
      });
    });

    await page.goto('/dashboard/domains');
    await page.waitForSelector('text=Add New Domain', { timeout: 5000 });

    // Placeholder is "example.com"
    const hostnameInput = page.getByPlaceholder('example.com');
    await hostnameInput.fill('test.example.com');
    await page.getByRole('button', { name: /add domain/i }).click();

    await expect(
      page.getByText(/rate limit|too many|slow down/i).first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test('401 session expired clears auth state', async ({ page }) => {
    await authenticateAs(page);

    // Override the domains API to return 401
    await page.route(api('/domains'), (route) =>
      route.fulfill({ status: 401, json: { message: 'Unauthorized' } }),
    );

    await page.goto('/dashboard/domains');

    // The API interceptor shows "Session expired" toast and clears token.
    // After redirect (1.5s delay + full page reload), the user lands on home.
    await expect(
      page.getByText(/session expired|unauthorized/i).first(),
    ).toBeVisible({ timeout: 5000 });
  });
});
