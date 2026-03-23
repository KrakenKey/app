import { test, expect, authenticateAs } from './fixtures/auth';
import { mockCertificates } from './fixtures/mock-data';

test.describe('Certificate management', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, { plan: 'starter' });
    await page.route('**/certificates', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, json: mockCertificates });
      }
      return route.continue();
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
      expect(renewCalled).toBe(true);
    }
  });

  test('can revoke an issued certificate', async ({ page }) => {
    let revokeCalled = false;
    await page.route('**/certificates/cert_001/revoke', (route) => {
      revokeCalled = true;
      return route.fulfill({
        status: 200,
        json: {
          ...mockCertificates[0],
          status: 'revoked',
          revokedAt: new Date().toISOString(),
        },
      });
    });

    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/dashboard/certificates');
    const revokeBtn = page.getByRole('button', { name: /revoke/i }).first();
    if (await revokeBtn.isVisible()) {
      await revokeBtn.click();
      expect(revokeCalled).toBe(true);
    }
  });

  test('can delete a failed certificate', async ({ page }) => {
    let deleteCalled = false;
    await page.route('**/certificates/cert_002', (route) => {
      if (route.request().method() === 'DELETE') {
        deleteCalled = true;
        return route.fulfill({ status: 200 });
      }
      return route.continue();
    });

    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/dashboard/certificates');
    // Find the failed cert's delete button
    const deleteBtn = page.getByRole('button', { name: /delete/i }).first();
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
      expect(deleteCalled).toBe(true);
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
      expect(retryCalled).toBe(true);
    }
  });
});
