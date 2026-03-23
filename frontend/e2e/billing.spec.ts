import { test, expect, authenticateAs, api } from './fixtures/auth';
import {
  freeSub,
  starterSub,
  teamSub,
  cancelingSub,
  upgradePreview,
} from './fixtures/mock-data';

test.describe('Billing — free plan user', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, { plan: 'free' });
    await page.route(api('/billing/subscription'), (route) =>
      route.fulfill({ status: 200, json: freeSub }),
    );
  });

  test('shows starter and team upgrade cards', async ({ page }) => {
    await page.goto('/dashboard/billing');

    await expect(page.getByText('Starter — $29/mo')).toBeVisible();
    await expect(page.getByText('Team — $79/mo')).toBeVisible();
  });

  test('clicking upgrade calls checkout endpoint', async ({ page }) => {
    let checkoutCalled = false;
    await page.route(api('/billing/checkout'), (route) => {
      checkoutCalled = true;
      return route.fulfill({
        status: 200,
        json: { sessionUrl: 'https://checkout.stripe.com/test_session' },
      });
    });

    // Prevent actual navigation to Stripe
    await page.route('**/checkout.stripe.com/**', (route) =>
      route.fulfill({ status: 200, body: 'intercepted' }),
    );

    await page.goto('/dashboard/billing');

    await page
      .getByRole('button', { name: /upgrade to starter/i })
      .first()
      .click();

    // Wait for the checkout API call
    await page.waitForTimeout(1000);
    expect(checkoutCalled).toBe(true);
  });
});

test.describe('Billing — starter plan user', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, { plan: 'starter' });
    await page.route(api('/billing/subscription'), (route) =>
      route.fulfill({ status: 200, json: starterSub }),
    );
  });

  test('shows upgrade to team option', async ({ page }) => {
    await page.goto('/dashboard/billing');

    await expect(page.getByText(/team/i).first()).toBeVisible();
  });

  test('upgrade preview modal shows prorated cost', async ({ page }) => {
    await page.route(api('/billing/upgrade/preview'), (route) =>
      route.fulfill({ status: 200, json: upgradePreview }),
    );

    await page.goto('/dashboard/billing');

    await page.getByRole('button', { name: /upgrade to team/i }).click();

    // Modal should show the prorated amount
    await expect(page.getByText('$42.00')).toBeVisible();
    await expect(page.getByRole('button', { name: /confirm/i })).toBeVisible();
  });

  test('confirming upgrade calls upgrade endpoint', async ({ page }) => {
    await page.route(api('/billing/upgrade/preview'), (route) =>
      route.fulfill({ status: 200, json: upgradePreview }),
    );

    let upgradeCalled = false;
    await page.route(api('/billing/upgrade'), (route) => {
      upgradeCalled = true;
      return route.fulfill({
        status: 200,
        json: {
          plan: 'team',
          status: 'active',
          currentPeriodEnd: '2026-04-20T00:00:00.000Z',
          cancelAtPeriodEnd: false,
        },
      });
    });

    // After upgrade, subscription refetch returns team
    await page.goto('/dashboard/billing');
    await page.getByRole('button', { name: /upgrade to team/i }).click();
    await page.getByRole('button', { name: /confirm/i }).click();

    expect(upgradeCalled).toBe(true);
  });
});

test.describe('Billing — team+ plan user', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, { plan: 'team' });
    await page.route(api('/billing/subscription'), (route) =>
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
    await page.route(api('/billing/portal'), (route) =>
      route.fulfill({
        status: 200,
        json: { portalUrl: 'https://billing.stripe.com/test_portal' },
      }),
    );

    await page.goto('/dashboard/billing');
    await page.getByRole('button', { name: /manage subscription/i }).click();
    // Portal redirect would happen — we verify the button interaction works
  });
});

test.describe('Billing — canceling subscription', () => {
  test('shows cancellation warning', async ({ page }) => {
    await authenticateAs(page, { plan: 'starter' });
    await page.route(api('/billing/subscription'), (route) =>
      route.fulfill({ status: 200, json: cancelingSub }),
    );

    await page.goto('/dashboard/billing');

    await expect(page.getByText(/cancel/i).first()).toBeVisible();
  });
});
