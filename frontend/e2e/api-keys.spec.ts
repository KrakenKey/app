import { test, expect, authenticateAs, api } from './fixtures/auth';
import { mockApiKeys } from './fixtures/mock-data';

// The list call carries ?includeRevoked=true; `*` stops at the next `/`.
const KEYS = api('/auth/api-keys') + '*';

test.describe('API key management', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, { plan: 'starter' });
    await page.route(KEYS, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, json: mockApiKeys });
      }
      return route.continue();
    });
    await page.route(api('/auth/github-oidc/trusts'), (route) =>
      route.fulfill({ status: 200, json: [] }),
    );
  });

  test('lists existing API keys', async ({ page }) => {
    await page.goto('/dashboard/api-keys');

    await expect(page.getByText('ci-deploy')).toBeVisible();
    await expect(page.getByText('local-dev')).toBeVisible();
  });

  test('can create a new API key and see it displayed', async ({ page }) => {
    await page.route(KEYS, (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 201,
          json: {
            id: 'key_003',
            name: 'new-key',
            apiKey: 'kk_live_abc123xyz789_secretvalue',
            createdAt: new Date().toISOString(),
            expiresAt: null,
          },
        });
      }
      return route.fulfill({ status: 200, json: mockApiKeys });
    });

    await page.goto('/dashboard/api-keys');

    await page.getByRole('button', { name: 'Create API key' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create API key' });
    const nameInput = dialog.getByLabel('Name', { exact: true });
    await expect(nameInput).toBeFocused();
    await nameInput.fill('new-key');
    await dialog.getByRole('button', { name: 'Create key' }).click();

    // The dialog closes and the one-time key is shown on the page
    await expect(dialog).toHaveCount(0);
    const reveal = page.getByRole('status', { name: 'New API key' });
    await expect(
      reveal.getByText('kk_live_abc123xyz789_secretvalue'),
    ).toBeVisible();
    await expect(reveal).toContainText('will not be shown again');
  });

  test('can copy the newly created key', async ({ page }) => {
    await page.route(KEYS, (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 201,
          json: {
            id: 'key_003',
            name: 'copy-test',
            apiKey: 'kk_live_copy_me',
            createdAt: new Date().toISOString(),
            expiresAt: null,
          },
        });
      }
      return route.fulfill({ status: 200, json: mockApiKeys });
    });

    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/dashboard/api-keys');
    await page.getByRole('button', { name: 'Create API key' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create API key' });
    await dialog.getByLabel('Name', { exact: true }).fill('copy-test');
    await dialog.getByRole('button', { name: 'Create key' }).click();

    await expect(page.getByText('kk_live_copy_me')).toBeVisible();
    await page.getByRole('button', { name: 'Copy key' }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('kk_live_copy_me');

    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByText('kk_live_copy_me')).toHaveCount(0);
  });

  test('shows last use and revoked keys', async ({ page }) => {
    await page.goto('/dashboard/api-keys');

    await expect(page.getByText('203.0.113.7')).toBeVisible();
    await expect(
      page
        .getByText('Never', { exact: true })
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await expect(
      page.getByText(/^Revoked [A-Z][a-z]{2} \d/).filter({ visible: true }),
    ).toBeVisible();
    await expect(page.getByText('Your API Keys (2)')).toBeVisible();
    // Only the two active keys have a menu with Revoke
    await expect(
      page.getByRole('button', { name: /^More actions for/ }),
    ).toHaveCount(2);
  });

  test('creates a certificate renewal key limited to an IP', async ({
    page,
  }) => {
    let body: Record<string, unknown> | undefined;
    await page.route(KEYS, (route) => {
      if (route.request().method() === 'POST') {
        body = route.request().postDataJSON();
        return route.fulfill({
          status: 201,
          json: {
            id: 'key_004',
            name: 'pfe-renewal',
            apiKey: 'kk_live_renewal_only',
            scopes: body?.scopes,
            allowedDomainIds: null,
            allowedCertIds: null,
            allowedIps: body?.allowedIps,
          },
        });
      }
      return route.fulfill({ status: 200, json: mockApiKeys });
    });

    await page.goto('/dashboard/api-keys');
    await page.getByRole('button', { name: 'Create API key' }).click();
    const form = page.getByRole('form', { name: 'Create API key' });
    await form.getByLabel('Name', { exact: true }).fill('pfe-renewal');
    await form.getByRole('radio', { name: /certificate renewal/i }).check();
    await form.getByRole('button', { name: /restrictions/i }).click();
    await form.getByLabel(/allowed ips/i).fill('203.0.113.7');
    await page
      .getByRole('dialog', { name: 'Create API key' })
      .getByRole('button', { name: 'Create key' })
      .click();

    await expect(page.getByText('kk_live_renewal_only')).toBeVisible();
    expect(body).toMatchObject({
      name: 'pfe-renewal',
      allowedIps: ['203.0.113.7'],
    });
    expect([...(body?.scopes as string[])].sort()).toEqual([
      'account:read',
      'certs:read',
      'certs:renew',
    ]);
  });

  test('can revoke an API key', async ({ page }) => {
    let revokeCalled = false;
    await page.route(api('/auth/api-keys/key_001'), (route) => {
      if (route.request().method() === 'DELETE') {
        revokeCalled = true;
        return route.fulfill({
          status: 200,
          json: { message: 'API key revoked' },
        });
      }
      return route.continue();
    });

    await page.goto('/dashboard/api-keys');
    await page
      .getByRole('button', { name: /^More actions for/ })
      .first()
      .click();
    await page.getByRole('menuitem', { name: 'Revoke' }).click();
    const dialog = page.getByRole('dialog', { name: 'Revoke API key?' });
    await expect(dialog).toBeVisible();
    expect(revokeCalled).toBe(false);
    await dialog.getByRole('button', { name: 'Revoke key' }).click();

    await expect.poll(() => revokeCalled).toBe(true);
    await expect(
      page.getByText(/^Revoked [A-Z][a-z]{2} \d/).filter({ visible: true }),
    ).toHaveCount(2);
    await expect(page.getByText('Your API Keys (1)')).toBeVisible();
  });
});
