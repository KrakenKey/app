import type { Page } from '@playwright/test';
import { test, expect, authenticateAs, api } from './fixtures/auth';

/** The Overview's health lists, answered empty so the page renders at once. */
async function mockHealthLists(page: Page) {
  for (const path of [
    '/certs/tls',
    '/domains',
    '/endpoints',
    '/endpoints/probes/mine',
    '/connectors',
  ]) {
    await page.route(api(path), (route) =>
      route.fulfill({ status: 200, json: [] }),
    );
  }
}

test.describe('Dashboard overview', () => {
  test('shows resource counts', async ({ page }) => {
    await authenticateAs(page, {
      resourceCounts: { domains: 5, certificates: 3, apiKeys: 2 },
    });
    await mockHealthLists(page);

    await page.goto('/dashboard');

    // KPI cells link to their pages and lead with the pooled count
    await expect(
      page.getByRole('link', { name: /^Domains\s*5/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /^Certificates\s*3/ }),
    ).toBeVisible();
  });

  test('header actions navigate to the right pages', async ({ page }) => {
    await authenticateAs(page);
    await mockHealthLists(page);

    await page.goto('/dashboard');
    await page.getByRole('button', { name: /add domain/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/domains/);
  });

  test('shows an all clear state with no problems', async ({ page }) => {
    await authenticateAs(page, {
      resourceCounts: { domains: 1, certificates: 1, apiKeys: 0 },
    });
    await mockHealthLists(page);

    await page.goto('/dashboard');

    await expect(page.getByText('All clear')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /needs attention/i }),
    ).toBeVisible();
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
