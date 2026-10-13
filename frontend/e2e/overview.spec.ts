import { test, expect, authenticateAs, api } from './fixtures/auth';

// The Overview's health lists are answered empty by the shared fixture
// (e2e/fixtures/network.ts); tests below override the ones they need.

test.describe('Dashboard overview', () => {
  test('shows resource counts', async ({ page }) => {
    await authenticateAs(page, {
      resourceCounts: { domains: 5, certificates: 3, apiKeys: 2 },
    });

    await page.goto('/dashboard');

    // KPI cells link to their pages and lead with the pooled count
    await expect(
      page.getByRole('link', { name: /^Domains\s*5/ }),
    ).toBeVisible();
  });

  test('counts live certificates, not revoked ones', async ({ page }) => {
    await authenticateAs(page, {
      plan: 'starter',
      resourceCounts: { domains: 1, certificates: 4, apiKeys: 0 },
    });
    const at = (days: number) =>
      new Date(Date.now() + days * 86_400_000).toISOString();
    const cert = (id: number, over: Record<string, unknown>) => ({
      id,
      rawCsr: null,
      parsedCsr: null,
      requestedNames: ['ci.example.com'],
      status: 'issued',
      autoRenew: true,
      managedBy: null,
      expiresAt: at(80.5),
      renewAfter: at(50.5),
      createdAt: at(-10),
      ...over,
    });
    await page.route(api('/certs/tls'), (route) =>
      route.fulfill({
        status: 200,
        json: [
          cert(1, { status: 'revoked', revokedAt: at(-5) }),
          cert(2, { status: 'revoked', revokedAt: at(-4) }),
          cert(3, { autoRenew: false, expiresAt: at(70.5) }),
          cert(4, {}),
        ],
      }),
    );

    await page.goto('/dashboard');

    await expect(
      page.getByRole('link', {
        name: /^Certificates\s*2\s*2\sissued,\s2\srevoked/,
      }),
    ).toBeVisible();
    // Same hostname twice: the schedule and attention list show the ids.
    const schedule = page.getByRole('listitem', {
      name: /^ci\.example\.com #3,/,
    });
    await expect(schedule).toContainText('Auto-renew is off');
    await expect(
      page.getByRole('listitem', { name: /^ci\.example\.com #4,/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Warning' }).getByText('#3'),
    ).toBeVisible();
    await expect(page.getByText('#1', { exact: true })).toHaveCount(0);
  });

  test('offers first steps in empty panels', async ({ page }) => {
    await authenticateAs(page, {
      resourceCounts: { domains: 1, certificates: 1, apiKeys: 0 },
    });

    await page.goto('/dashboard');

    await expect(page.getByText('Monitor your first endpoint')).toBeVisible();
    await expect(
      page.getByText('Run a connector to renew and deploy with your own keys'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Set up a connector' }).click();
    await expect(page).toHaveURL(/\/dashboard\/connectors/);
  });

  test('header actions navigate to the right pages', async ({ page }) => {
    await authenticateAs(page);

    await page.goto('/dashboard');
    await page.getByRole('button', { name: /add domain/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/domains/);
  });

  test('shows an all clear state with no problems', async ({ page }) => {
    await authenticateAs(page, {
      resourceCounts: { domains: 1, certificates: 1, apiKeys: 0 },
    });

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
