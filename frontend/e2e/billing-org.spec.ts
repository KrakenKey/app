import { test, expect, authenticateAs, api } from './fixtures/auth';
import { teamSub, orgOwnerUser, orgMemberUser } from './fixtures/mock-data';

test.describe('Billing — org member (read-only)', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, orgMemberUser);
    await page.route(api('/billing/subscription'), (route) =>
      route.fulfill({ status: 200, json: teamSub }),
    );
  });

  test('shows plan badge but no manage/upgrade buttons', async ({ page }) => {
    await page.goto('/dashboard/billing');

    // Wait until the subscription has loaded and the member view rendered.
    // Absence checks pass instantly while the page still shows "Loading...",
    // so they only mean something after these positive checks.
    await expect(page.getByText(/current period ends/i)).toBeVisible();
    await expect(page.getByText(/managed by its owner/i)).toBeVisible();

    // Plan badge in the Current Plan card shows the org's plan
    const planCard = page
      .getByRole('heading', { name: 'Current Plan' })
      .locator('..');
    await expect(planCard.getByText('Team', { exact: true })).toBeVisible();

    // No billing management buttons for non-owner members
    await expect(
      page.getByRole('button', { name: /manage subscription/i }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: /upgrade/i })).toHaveCount(0);
  });
});

test.describe('Billing — org owner (full controls)', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, orgOwnerUser);
    await page.route(api('/billing/subscription'), (route) =>
      route.fulfill({ status: 200, json: teamSub }),
    );
  });

  test('shows manage subscription button', async ({ page }) => {
    await page.goto('/dashboard/billing');

    await expect(
      page.getByRole('button', { name: /manage subscription/i }),
    ).toBeVisible();
    await expect(page.getByText(/managed by its owner/i)).toHaveCount(0);
  });

  test('manage subscription opens Stripe portal', async ({ page }) => {
    let portalCalled = false;
    await page.route(api('/billing/portal'), (route) => {
      portalCalled = true;
      return route.fulfill({
        status: 200,
        json: { portalUrl: 'https://billing.stripe.com/test_portal' },
      });
    });

    await page.goto('/dashboard/billing');
    await page.getByRole('button', { name: /manage subscription/i }).click();

    await expect.poll(() => portalCalled).toBe(true);
  });
});
