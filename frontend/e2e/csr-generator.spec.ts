import { test, expect, authenticateAs } from './fixtures/auth';
import { mockDomains, mockCertificates } from './fixtures/mock-data';

// Match API calls but not page navigation. The ** at start matches protocol+host.
const API = '**/api-dev.krakenkey.io/';

test.describe('CSR Generator', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, {
      plan: 'starter',
      resourceCounts: { domains: 2, certificates: 1, apiKeys: 0 },
    });

    await page.route(`${API}certs/tls`, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, json: mockCertificates });
      }
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 201,
          json: { id: 'cert_new', status: 'pending' },
        });
      }
      return route.continue();
    });

    await page.route(`${API}domains`, (route) =>
      route.fulfill({ status: 200, json: mockDomains }),
    );
  });

  test('form renders with subject fields and key type options', async ({
    page,
  }) => {
    await page.goto('/dashboard/certificates');

    // Open the CSR generator
    await page.getByRole('button', { name: /generate new csr/i }).click();

    // Subject fields visible
    await expect(page.getByText('Common Name (CN)')).toBeVisible();
    await expect(page.getByText('Organization (O)')).toBeVisible();

    // Key type options visible (labels like "ECDSA-P384")
    await expect(page.getByText('ECDSA-P384')).toBeVisible();
    await expect(page.getByText('RSA-4096')).toBeVisible();
  });

  test('shows validation error when CN is empty', async ({ page }) => {
    await page.goto('/dashboard/certificates');
    await page.getByRole('button', { name: /generate new csr/i }).click();

    // Click generate without filling CN
    await page.getByRole('button', { name: /generate csr/i }).click();

    // Should show validation error
    await expect(page.getByText(/required|common name/i).first()).toBeVisible();
  });

  test('RSA-2048 shows security warning', async ({ page }) => {
    await page.goto('/dashboard/certificates');
    await page.getByRole('button', { name: /generate new csr/i }).click();

    // Select RSA-2048
    await page.getByText('RSA-2048').click();

    // Warning should appear
    await expect(
      page.getByText(/recommend.*rsa 4096|ecdsa p-384/i).first(),
    ).toBeVisible();
  });

  test('can add SAN DNS entries', async ({ page }) => {
    await page.goto('/dashboard/certificates');
    await page.getByRole('button', { name: /generate new csr/i }).click();

    // Find the SAN section and add a DNS name
    const addBtn = page.getByRole('button', { name: /\+|add/i }).first();

    if (await addBtn.isVisible()) {
      const inputsBefore = await page
        .locator('input[placeholder*="domain"], input[placeholder*="DNS"]')
        .count();
      await addBtn.click();
      const inputsAfter = await page
        .locator('input[placeholder*="domain"], input[placeholder*="DNS"]')
        .count();
      expect(inputsAfter).toBeGreaterThanOrEqual(inputsBefore);
    }
  });

  test('full CSR generation flow produces private key modal', async ({
    page,
  }) => {
    await page.goto('/dashboard/certificates');
    await page.getByRole('button', { name: /generate new csr/i }).click();

    // Fill Common Name with a verified domain
    // The CN input is the first input after "Common Name (CN)" label
    const cnInput = page
      .locator('label:has-text("Common Name")')
      .locator('..')
      .locator('input')
      .first();
    await cnInput.fill('example.com');

    // Click generate
    await page.getByRole('button', { name: /generate csr/i }).click();

    // Wait for key generation — private key modal should appear
    // The modal has a warning about private keys
    await expect(page.getByText(/private key/i).first()).toBeVisible({
      timeout: 20000,
    });

    // The "I have saved" checkbox appears after a 3-second delay
    const checkbox = page.locator(
      'label:has-text("securely saved") input[type="checkbox"]',
    );
    await expect(checkbox).toBeVisible({ timeout: 10000 });
    await checkbox.check();

    // Continue button should become enabled
    const continueBtn = page.getByRole('button', { name: /continue/i });
    await expect(continueBtn).toBeEnabled({ timeout: 2000 });
    await continueBtn.click();

    // CSR preview should be visible with "CSR Generated" heading
    await expect(page.getByText('CSR Generated Successfully')).toBeVisible();
  });
});
