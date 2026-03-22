import { test, expect, authenticateAs, mockUser } from './fixtures/auth';

const fullProfile = {
  ...mockUser,
  displayName: 'Test User',
  notificationPreferences: {},
};

test.describe('Settings', () => {
  test('displays profile information', async ({ page }) => {
    await authenticateAs(page, fullProfile);

    await page.goto('/settings');

    await expect(page.getByText('Account Settings')).toBeVisible();
    // Profile card shows username and email (also in sidebar, so use .first())
    await expect(page.getByRole('main').getByText('testuser')).toBeVisible();
    await expect(
      page.getByRole('main').getByText('test@example.com'),
    ).toBeVisible();
  });

  test('can update display name', async ({ page }) => {
    let patchCalled = false;
    let patchBody: Record<string, unknown> = {};

    // Set up auth first, then override with method-aware handler
    await authenticateAs(page, fullProfile);
    await page.unrouteAll({ behavior: 'wait' });
    await page.route('**/auth/profile', (route) => {
      if (route.request().method() === 'PATCH') {
        patchCalled = true;
        patchBody = route.request().postDataJSON();
        return route.fulfill({
          status: 200,
          json: { ...fullProfile, displayName: 'New Name' },
        });
      }
      return route.fulfill({ status: 200, json: fullProfile });
    });

    await page.goto('/settings');
    await page.waitForSelector('text=Display Name', { timeout: 10000 });

    const nameInput = page.getByPlaceholder(/display name/i);
    await nameInput.clear();
    await nameInput.fill('New Name');
    await page.getByRole('button', { name: /save/i }).first().click();

    expect(patchCalled).toBe(true);
    expect(patchBody.displayName).toBe('New Name');
  });

  test('can toggle a notification preference', async ({ page }) => {
    let patchCalled = false;

    await authenticateAs(page, fullProfile);
    await page.unrouteAll({ behavior: 'wait' });
    await page.route('**/auth/profile', (route) => {
      if (route.request().method() === 'PATCH') {
        patchCalled = true;
        return route.fulfill({
          status: 200,
          json: {
            ...fullProfile,
            notificationPreferences: { cert_issued: false },
          },
        });
      }
      return route.fulfill({ status: 200, json: fullProfile });
    });

    await page.goto('/settings');
    await page.waitForSelector('text=Email Notifications', { timeout: 10000 });

    const toggle = page.getByRole('switch').first();
    await toggle.click();

    expect(patchCalled).toBe(true);
  });

  test('account deletion requires username confirmation', async ({ page }) => {
    await authenticateAs(page, fullProfile);

    await page.goto('/settings');
    await page.waitForSelector('text=Danger Zone', { timeout: 10000 });

    await page.getByRole('button', { name: /delete account/i }).click();

    const confirmBtn = page.getByRole('button', {
      name: /permanently delete/i,
    });
    await expect(confirmBtn).toBeDisabled();

    const confirmInput = page.getByPlaceholder(mockUser.username);
    await confirmInput.fill('wrong-text');
    await expect(confirmBtn).toBeDisabled();

    await confirmInput.clear();
    await confirmInput.fill(mockUser.username);
    await expect(confirmBtn).toBeEnabled();
  });
});
