import { test, expect } from '@playwright/test';

test.describe('Home page', () => {
  test('renders branding and auth buttons', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: 'KrakenKey' }),
    ).toBeVisible();
    await expect(page.getByText('Certificate Automagick')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign Up' })).toBeVisible();
  });

  test('has link to marketing site', async ({ page }) => {
    await page.goto('/');

    const link = page.getByRole('link', { name: /learn more/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://krakenkey.io');
  });

  test('unauthenticated user visiting /dashboard is redirected to home', async ({
    page,
  }) => {
    await page.goto('/dashboard');

    // Should redirect back to home since not authenticated
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
  });
});
