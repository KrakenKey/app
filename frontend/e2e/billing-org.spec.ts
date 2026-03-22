import { test, expect, authenticateAs } from './fixtures/auth';
import { teamSub, orgOwnerUser, orgMemberUser } from './fixtures/mock-data';

test.describe('Billing — org member (read-only)', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, orgMemberUser);
    await page.route('**/billing/subscription', (route) =>
      route.fulfill({ status: 200, json: teamSub }),
    );
  });

  test('shows plan badge but no manage/upgrade buttons', async ({ page }) => {
    await page.goto('/dashboard/billing');

    // Plan badge should be visible
    await expect(page.getByText(/team/i).first()).toBeVisible();

    // No billing management buttons for non-owner members
    await expect(
      page.getByRole('button', { name: /manage subscription/i }),
    ).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: /upgrade/i }),
    ).not.toBeVisible();
  });
});

test.describe('Billing — org owner (full controls)', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, orgOwnerUser);
    await page.route('**/billing/subscription', (route) =>
      route.fulfill({ status: 200, json: teamSub }),
    );
  });

  test('shows manage subscription button', async ({ page }) => {
    await page.goto('/dashboard/billing');

    await expect(
      page.getByRole('button', { name: /manage subscription/i }),
    ).toBeVisible();
  });

  test('manage subscription opens Stripe portal', async ({ page }) => {
    let portalCalled = false;
    await page.route('**/billing/portal', (route) => {
      portalCalled = true;
      return route.fulfill({
        status: 200,
        json: { portalUrl: 'https://billing.stripe.com/test_portal' },
      });
    });

    await page.goto('/dashboard/billing');
    await page.getByRole('button', { name: /manage subscription/i }).click();

    expect(portalCalled).toBe(true);
  });
});
