import { test, expect, authenticateAs, api } from './fixtures/auth';
import { mockDomains } from './fixtures/mock-data';

test.describe('Domain management', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, { plan: 'starter' });
    await page.route(api('/domains'), (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, json: mockDomains });
      }
      return route.continue();
    });
  });

  test('lists existing domains with status badges', async ({ page }) => {
    await page.goto('/dashboard/domains');

    await expect(page.getByText('example.com').first()).toBeVisible();
    await expect(page.getByText('staging.example.com')).toBeVisible();
    await expect(page.getByText(/verified/i).first()).toBeVisible();
  });

  test('can add a new domain', async ({ page }) => {
    const newDomain = {
      id: 'dom_003',
      hostname: 'new.example.com',
      isVerified: false,
      verificationCode: 'kk-verify-new789',
      userId: 'usr_test_001',
      createdAt: new Date().toISOString(),
      verifiedAt: null,
    };

    await page.route(api('/domains'), (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({ status: 201, json: newDomain });
      }
      return route.fulfill({ status: 200, json: mockDomains });
    });

    await page.goto('/dashboard/domains');

    await page.getByPlaceholder('example.com').fill('new.example.com');
    await page.getByRole('button', { name: /add domain/i }).click();

    await expect(
      page.getByRole('heading', { name: 'new.example.com' }),
    ).toBeVisible();
  });

  test('can verify an unverified domain', async ({ page }) => {
    await page.route(api('/domains/dom_002/verify'), (route) =>
      route.fulfill({
        status: 200,
        json: {
          ...mockDomains[1],
          isVerified: true,
          verifiedAt: new Date().toISOString(),
        },
      }),
    );

    await page.goto('/dashboard/domains');

    await page
      .getByRole('button', { name: /verify/i })
      .first()
      .click();
  });

  test('can delete a domain after confirming', async ({ page }) => {
    let deleteCalled = false;
    await page.route(api('/domains/dom_001'), (route) => {
      if (route.request().method() === 'DELETE') {
        deleteCalled = true;
        return route.fulfill({ status: 200, json: { affected: 1 } });
      }
      return route.continue();
    });

    await page.goto('/dashboard/domains');

    // Click delete on the first domain
    await page
      .getByRole('button', { name: /delete/i })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: 'Delete domain?' });
    await expect(dialog).toContainText('example.com');
    // Cancel has focus, so a stray Enter does not delete
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Delete domain' }).click();

    await expect.poll(() => deleteCalled).toBe(true);
    await expect(dialog).toHaveCount(0);
  });

  test('keeps the domain when the confirmation is canceled', async ({
    page,
  }) => {
    let deleteCalled = false;
    await page.route(api('/domains/dom_001'), (route) => {
      if (route.request().method() === 'DELETE') deleteCalled = true;
      return route.continue();
    });

    await page.goto('/dashboard/domains');
    await page
      .getByRole('button', { name: /delete/i })
      .first()
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(deleteCalled).toBe(false);
  });
});
