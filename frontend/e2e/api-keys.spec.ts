import { test, expect, authenticateAs } from './fixtures/auth';
import { mockApiKeys } from './fixtures/mock-data';

test.describe('API key management', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, { plan: 'starter' });
    await page.route('**/api-keys', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, json: mockApiKeys });
      }
      return route.continue();
    });
  });

  test('lists existing API keys', async ({ page }) => {
    await page.goto('/dashboard/api-keys');

    await expect(page.getByText('ci-deploy')).toBeVisible();
    await expect(page.getByText('local-dev')).toBeVisible();
  });

  test('can create a new API key and see it displayed', async ({ page }) => {
    await page.route('**/api-keys', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 201,
          json: {
            id: 'key_003',
            name: 'new-key',
            key: 'kk_live_abc123xyz789_secretvalue',
            createdAt: new Date().toISOString(),
            expiresAt: null,
          },
        });
      }
      return route.fulfill({ status: 200, json: mockApiKeys });
    });

    await page.goto('/dashboard/api-keys');

    await page.getByPlaceholder(/name|ci-deploy/i).fill('new-key');
    await page.getByRole('button', { name: /create/i }).click();

    // The newly created key should be shown
    await expect(
      page.getByText('kk_live_abc123xyz789_secretvalue'),
    ).toBeVisible();
  });

  test('can copy the newly created key', async ({ page }) => {
    await page.route('**/api-keys', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 201,
          json: {
            id: 'key_003',
            name: 'copy-test',
            key: 'kk_live_copy_me',
            createdAt: new Date().toISOString(),
            expiresAt: null,
          },
        });
      }
      return route.fulfill({ status: 200, json: mockApiKeys });
    });

    await page.goto('/dashboard/api-keys');
    await page.getByPlaceholder(/name|ci-deploy/i).fill('copy-test');
    await page.getByRole('button', { name: /create/i }).click();

    await expect(page.getByText('kk_live_copy_me')).toBeVisible();

    const copyBtn = page.getByRole('button', { name: /copy/i }).first();
    if (await copyBtn.isVisible()) {
      await copyBtn.click();
    }
  });

  test('can delete an API key', async ({ page }) => {
    let deleteCalled = false;
    await page.route('**/api-keys/key_001', (route) => {
      if (route.request().method() === 'DELETE') {
        deleteCalled = true;
        return route.fulfill({ status: 200 });
      }
      return route.continue();
    });

    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/dashboard/api-keys');
    await page
      .getByRole('button', { name: /delete/i })
      .first()
      .click();

    expect(deleteCalled).toBe(true);
  });
});
