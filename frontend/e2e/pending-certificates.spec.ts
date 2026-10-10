import { test, expect, authenticateAs, api } from './fixtures/auth';

/** A certificate created from names, waiting for a connector's CSR. */
const awaitingCert = {
  id: 41,
  rawCsr: null,
  parsedCsr: null,
  requestedNames: ['app.example.com', 'api.example.com'],
  crtPem: null,
  chainPem: null,
  status: 'awaiting_csr',
  expiresAt: null,
  lastRenewedAt: null,
  autoRenew: false,
  renewalCount: 0,
  lastRenewalAttemptAt: null,
  revocationReason: null,
  failureReason: null,
  revokedAt: null,
  managedBy: 'connector',
  renewAfter: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
  userId: 'usr_test_001',
};

test.describe('Pending certificates', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, { plan: 'starter' });
    await page.route(api('/certs/tls'), (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, json: [awaitingCert] });
      }
      return route.continue();
    });
  });

  test('shows the requested names and the awaiting state', async ({ page }) => {
    await page.goto('/dashboard/certificates');

    await expect(page.getByText('app.example.com').first()).toBeVisible();
    await expect(page.getByText('Awaiting CSR').first()).toBeVisible();
    await expect(
      page.getByText(/Awaiting CSR from connector/).first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /renew/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /revoke/i })).toHaveCount(0);
  });

  test('can delete it', async ({ page }) => {
    let deleted = false;
    await page.route(api('/certs/tls/41'), (route) => {
      if (route.request().method() === 'DELETE') {
        deleted = true;
        return route.fulfill({ status: 200, json: { id: 41 } });
      }
      return route.continue();
    });

    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/dashboard/certificates');
    await page
      .getByRole('button', { name: /delete/i })
      .first()
      .click();
    await expect.poll(() => deleted).toBe(true);
  });
});
