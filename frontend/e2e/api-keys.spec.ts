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

    const nameInput = page.getByLabel('Name', { exact: true });
    await nameInput.fill('new-key');
    await page.getByRole('button', { name: /create/i }).click();

    // The newly created key should be shown
    await expect(
      page.getByText('kk_live_abc123xyz789_secretvalue'),
    ).toBeVisible();
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

    await page.goto('/dashboard/api-keys');
    const nameInput = page.getByLabel('Name', { exact: true });
    await nameInput.fill('copy-test');
    await page.getByRole('button', { name: /create/i }).click();

    await expect(page.getByText('kk_live_copy_me')).toBeVisible();

    const copyBtn = page.getByRole('button', { name: /copy/i }).first();
    if (await copyBtn.isVisible()) {
      await copyBtn.click();
    }
  });

  test('shows last use and revoked keys', async ({ page }) => {
    await page.goto('/dashboard/api-keys');

    await expect(page.getByText('203.0.113.7')).toBeVisible();
    await expect(
      page.getByText('Never', { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText(/^Revoked \d/)).toBeVisible();
    await expect(page.getByText('Your API Keys (2)')).toBeVisible();
    // Only the two active keys can be revoked
    await expect(page.getByRole('button', { name: /revoke/i })).toHaveCount(2);
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
    // The GitHub trust policy form on the same page has the same controls.
    const form = page.getByRole('form', { name: 'Create API key' });
    await form.getByLabel('Name', { exact: true }).fill('pfe-renewal');
    await form.getByRole('radio', { name: /certificate renewal/i }).check();
    await form.getByRole('button', { name: /restrictions/i }).click();
    await form.getByLabel(/allowed ips/i).fill('203.0.113.7');
    await form.getByRole('button', { name: /create/i }).click();

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

    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/dashboard/api-keys');
    await page
      .getByRole('button', { name: /revoke/i })
      .first()
      .click();

    await expect.poll(() => revokeCalled).toBe(true);
    await expect(page.getByText(/^Revoked \d/)).toHaveCount(2);
    await expect(page.getByText('Your API Keys (1)')).toBeVisible();
  });
});
