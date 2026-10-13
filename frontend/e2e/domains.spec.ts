import { test, expect, authenticateAs, api } from './fixtures/auth';
import { mockDomains } from './fixtures/mock-data';

test.describe('Domain management', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, { plan: 'starter' });
    await page.route(api('/domains'), (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, json: mockDomains });
      }
      return route.fallback();
    });
  });

  test('lists existing domains with status badges', async ({ page }) => {
    await page.goto('/dashboard/domains');

    await expect(page.getByText('example.com').first()).toBeVisible();
    await expect(page.getByText('staging.example.com')).toBeVisible();
    await expect(
      page.getByText('Verified', { exact: true }).filter({ visible: true }),
    ).toHaveCount(1);
    await expect(
      page.getByText('Pending', { exact: true }).filter({ visible: true }),
    ).toHaveCount(1);
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

    await page.getByRole('button', { name: 'Add domain' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a domain' });
    await dialog.getByPlaceholder('example.com').fill('new.example.com');
    await dialog.getByRole('button', { name: 'Add domain' }).click();

    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole('cell', { name: /new\.example\.com/ }).first(),
    ).toBeVisible();
    // The new domain's DNS records open right away
    await expect(
      page.getByText('_acme-challenge.new.example.com', { exact: true }),
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

    await page.getByRole('button', { name: 'Verify', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Verify' })).toHaveCount(0);
  });

  test("shows a pending domain's DNS records in an expandable row", async ({
    page,
  }) => {
    await page.goto('/dashboard/domains');

    const toggle = page.getByRole('button', {
      name: 'Show DNS records for staging.example.com',
    });
    await toggle.click();
    await expect(
      page.getByRole('button', { name: 'Copy TXT value' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Copy CNAME target' }),
    ).toBeVisible();
    await page
      .getByRole('button', {
        name: 'Hide DNS records for staging.example.com',
      })
      .click();
    await expect(
      page.getByRole('button', { name: 'Copy TXT value' }),
    ).toHaveCount(0);
  });

  test('can delete a domain after confirming', async ({ page }) => {
    let deleteCalled = false;
    await page.route(api('/domains/dom_001'), (route) => {
      if (route.request().method() === 'DELETE') {
        deleteCalled = true;
        return route.fulfill({ status: 200, json: { affected: 1 } });
      }
      return route.fallback();
    });

    await page.goto('/dashboard/domains');

    // Delete lives in the row's overflow menu
    await page
      .getByRole('button', { name: 'More actions for example.com' })
      .click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
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
      return route.fallback();
    });

    await page.goto('/dashboard/domains');
    await page
      .getByRole('button', { name: 'More actions for example.com' })
      .click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(deleteCalled).toBe(false);
  });
});
