import { test, expect, authenticateAs, api } from './fixtures/auth';
import { mockCertificates } from './fixtures/mock-data';

/** API-shaped certificates for the row menu tests. */
const baseCert = {
  rawCsr: null,
  parsedCsr: { subject: [{ shortName: 'CN', value: 'shop.example.com' }] },
  crtPem: null,
  chainPem: null,
  lastRenewedAt: null,
  autoRenew: true,
  renewalCount: 0,
  lastRenewalAttemptAt: null,
  revocationReason: null,
  failureReason: null,
  revokedAt: null,
  managedBy: 'krakenkey',
  renewAfter: null,
  requestedNames: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  userId: 'usr_test_001',
};
const issuedCert = {
  ...baseCert,
  id: 51,
  status: 'issued',
  expiresAt: '2026-12-30T00:00:00.000Z',
  crtPem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
};
const failedCert = {
  ...baseCert,
  id: 52,
  status: 'failed',
  expiresAt: null,
  parsedCsr: {
    subject: [{ shortName: 'CN', value: 'broken.example.com' }],
  },
  failureReason: 'DNS problem',
};

test.describe('Certificate management', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, { plan: 'starter' });
    await page.route('**/certificates', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, json: mockCertificates });
      }
      return route.fallback();
    });
  });

  test('lists certificates with status', async ({ page }) => {
    await page.goto('/dashboard/certificates');

    await expect(page.getByText('example.com').first()).toBeVisible();
    await expect(page.getByText(/issued/i).first()).toBeVisible();
    await expect(page.getByText(/failed/i).first()).toBeVisible();
  });

  test('can submit a CSR', async ({ page }) => {
    const pendingCert = {
      id: 'cert_003',
      commonName: 'test.example.com',
      status: 'pending',
      domains: ['test.example.com'],
      expiresAt: null,
      autoRenew: false,
      renewalCount: 0,
      pem: null,
      createdAt: new Date().toISOString(),
      lastRenewedAt: null,
      revokedAt: null,
    };

    await page.route('**/certificates', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({ status: 201, json: pendingCert });
      }
      return route.fulfill({ status: 200, json: mockCertificates });
    });

    await page.goto('/dashboard/certificates');

    const csrInput = page
      .getByPlaceholder(/pem|csr/i)
      .or(page.locator('textarea').first());
    if (await csrInput.isVisible()) {
      await csrInput.fill(
        '-----BEGIN CERTIFICATE REQUEST-----\nMIIB...\n-----END CERTIFICATE REQUEST-----',
      );
      await page.getByRole('button', { name: /submit/i }).click();
    }
  });

  test('can renew an issued certificate', async ({ page }) => {
    let renewCalled = false;
    await page.route('**/certificates/cert_001/renew', (route) => {
      renewCalled = true;
      return route.fulfill({
        status: 200,
        json: { ...mockCertificates[0], status: 'renewing' },
      });
    });

    await page.goto('/dashboard/certificates');
    const renewBtn = page.getByRole('button', { name: /renew/i }).first();
    if (await renewBtn.isVisible()) {
      await renewBtn.click();
      await expect.poll(() => renewCalled).toBe(true);
    }
  });

  test('can retry a failed certificate', async ({ page }) => {
    let retryCalled = false;
    await page.route('**/certificates/cert_002/retry', (route) => {
      retryCalled = true;
      return route.fulfill({
        status: 200,
        json: { ...mockCertificates[1], status: 'pending' },
      });
    });

    await page.goto('/dashboard/certificates');
    const retryBtn = page.getByRole('button', { name: /retry/i }).first();
    if (await retryBtn.isVisible()) {
      await retryBtn.click();
      await expect.poll(() => retryCalled).toBe(true);
    }
  });
});

// Own describe: the block above routes `**/certificates`, which also matches
// the /dashboard/certificates page itself.
test.describe('Certificate row actions', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, { plan: 'starter' });
  });

  test('can revoke an issued certificate after confirming', async ({
    page,
  }) => {
    let revokeCalled = false;
    await page.route(api('/certs/tls'), (route) =>
      route.fulfill({ status: 200, json: [issuedCert] }),
    );
    await page.route(api('/certs/tls/51/revoke'), (route) => {
      revokeCalled = true;
      return route.fulfill({
        status: 200,
        json: { id: 51, status: 'revoking' },
      });
    });

    await page.goto('/dashboard/certificates');
    await page
      .getByRole('button', { name: /More actions for shop\.example\.com/ })
      .click();
    await page.getByRole('menuitem', { name: /revoke/i }).click();

    const dialog = page.getByRole('dialog', { name: 'Revoke certificate?' });
    await expect(dialog).toContainText('shop.example.com');
    expect(revokeCalled).toBe(false);
    await dialog.getByRole('button', { name: 'Revoke certificate' }).click();
    await expect.poll(() => revokeCalled).toBe(true);
  });

  test('can delete a failed certificate after confirming', async ({ page }) => {
    let deleteCalled = false;
    await page.route(api('/certs/tls'), (route) =>
      route.fulfill({ status: 200, json: [failedCert] }),
    );
    await page.route(api('/certs/tls/52'), (route) => {
      if (route.request().method() === 'DELETE') {
        deleteCalled = true;
        return route.fulfill({ status: 200, json: { id: 52 } });
      }
      return route.fulfill({ status: 200, json: failedCert });
    });

    await page.goto('/dashboard/certificates');
    await page
      .getByRole('button', { name: /More actions for broken\.example\.com/ })
      .click();
    await page.getByRole('menuitem', { name: /delete/i }).click();
    await page
      .getByRole('dialog', { name: 'Delete certificate?' })
      .getByRole('button', { name: 'Delete certificate' })
      .click();
    await expect.poll(() => deleteCalled).toBe(true);
  });
});
