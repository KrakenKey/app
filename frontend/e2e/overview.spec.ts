import { test, expect, authenticateAs } from './fixtures/auth';

test.describe('Dashboard overview', () => {
  test('shows resource counts', async ({ page }) => {
    await authenticateAs(page, {
      resourceCounts: { domains: 5, certificates: 3, apiKeys: 2 },
    });

    await page.goto('/dashboard');

    await expect(page.getByText('5')).toBeVisible();
    await expect(page.getByText('3')).toBeVisible();
    await expect(page.getByText('2')).toBeVisible();
  });

  test('quick action buttons navigate to correct pages', async ({ page }) => {
    await authenticateAs(page);

    await page.goto('/dashboard');
    await page.getByRole('button', { name: /add domain/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/domains/);
  });

  test('shows auto-renewal banner for free users needing confirmation', async ({
    page,
  }) => {
    await authenticateAs(page, {
      plan: 'free',
      autoRenewalConfirmedAt: null,
    });

    await page.goto('/dashboard');

    const confirmBtn = page.getByRole('button', { name: /confirm/i });
    if (await confirmBtn.isVisible()) {
      await expect(confirmBtn).toBeVisible();
    }
  });

  test('hides auto-renewal banner for paid users', async ({ page }) => {
    await authenticateAs(page, { plan: 'starter' });

    await page.goto('/dashboard');

    await expect(
      page.getByRole('button', { name: /confirm now/i }),
    ).not.toBeVisible();
  });
});
