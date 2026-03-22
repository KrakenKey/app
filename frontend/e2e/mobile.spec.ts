import { test, expect, authenticateAs } from './fixtures/auth';

const API = '**/api-dev.krakenkey.io/';

test.describe('Mobile Responsive', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page);
  });

  test('sidebar is hidden by default on mobile', async ({ page }) => {
    await page.goto('/dashboard');

    // The hamburger "Open menu" button should be visible on mobile
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
  });

  test('hamburger menu opens sidebar', async ({ page }) => {
    await page.goto('/dashboard');

    await page.getByRole('button', { name: 'Open menu' }).click();

    // Sidebar should now be visible with nav links
    await expect(
      page.getByRole('link', { name: /domains/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /certificates/i }).first(),
    ).toBeVisible();
  });

  test('clicking a nav link navigates and closes sidebar', async ({ page }) => {
    await page.route(`${API}domains`, (route) =>
      route.fulfill({ status: 200, json: [] }),
    );

    await page.goto('/dashboard');

    // Open menu
    await page.getByRole('button', { name: 'Open menu' }).click();

    // Click domains link
    await page
      .getByRole('link', { name: /domains/i })
      .first()
      .click();

    // Should navigate
    await expect(page).toHaveURL(/\/dashboard\/domains/);
  });
});
