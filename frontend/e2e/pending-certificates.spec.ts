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
    // Destructive actions live in the row's overflow menu
    await page
      .getByRole('button', { name: /More actions for app\.example\.com/ })
      .click();
    await page.getByRole('menuitem', { name: /delete/i }).click();
    await expect.poll(() => deleted).toBe(true);
  });

  test('creates a pending certificate from names', async ({ page }) => {
    let posted: unknown = null;
    await page.route(api('/certs/tls'), (route) => {
      if (route.request().method() === 'POST') {
        posted = route.request().postDataJSON();
        return route.fulfill({
          status: 201,
          json: { id: 43, status: 'awaiting_csr' },
        });
      }
      return route.fulfill({ status: 200, json: [awaitingCert] });
    });

    await page.goto('/dashboard/certificates');
    await page.getByRole('button', { name: 'Request certificate' }).click();
    await page.getByRole('radio', { name: /Issued by a connector/ }).check();
    await page
      .getByRole('textbox', { name: 'Names' })
      .fill('Shop.example.com\nwww.shop.example.com');
    await page
      .getByRole('button', { name: 'Create Pending Certificate' })
      .click();

    await expect
      .poll(() => posted)
      .toEqual({
        names: ['shop.example.com', 'www.shop.example.com'],
        managedBy: 'connector',
      });
    await expect(
      page.getByText(/Pending certificate #43 created/),
    ).toBeVisible();
  });

  test('shows where a connector deployed a certificate', async ({ page }) => {
    let calls = 0;
    await page.route(api('/connectors/deployments') + '*', (route) => {
      calls++;
      return route.fulfill({
        status: 200,
        json: [
          {
            connectorId: '3f1c2b9e-1111-4111-8111-111111111111',
            connectorName: 'web-01',
            certificateId: 41,
            label: 'nginx-main',
            state: 'pending',
            serial: null,
            error: null,
            updatedAt: new Date().toISOString(),
            reportedAt: new Date().toISOString(),
          },
        ],
      });
    });

    await page.goto('/dashboard/certificates');
    await expect(page.getByText('app.example.com').first()).toBeVisible();
    expect(calls).toBe(0);

    await page.getByRole('button', { name: 'Show details' }).click();
    await page.getByRole('button', { name: /Deployed to/ }).click();
    await expect(page.getByRole('link', { name: 'web-01' })).toBeVisible();
    await expect(page.getByText('nginx-main')).toBeVisible();
    await expect(page.getByText('Pending', { exact: true })).toBeVisible();
    expect(calls).toBe(1);
  });
});
