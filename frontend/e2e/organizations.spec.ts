import { test, expect, authenticateAs } from './fixtures/auth';
import {
  mockOrg,
  dissolvingOrg,
  orgMemberUser,
  orgMixedDomains,
} from './fixtures/mock-data';

test.describe('Organizations — free plan (upsell)', () => {
  test('shows upgrade prompt for free users without an org', async ({
    page,
  }) => {
    await authenticateAs(page, { plan: 'free', organizationId: null });
    await page.goto('/dashboard/organizations');

    await expect(page.getByText(/upgrade|team/i).first()).toBeVisible();
  });
});

test.describe('Organizations — eligible plan, no org yet', () => {
  test('can create a new organization', async ({ page }) => {
    const user = await authenticateAs(page, {
      plan: 'team',
      organizationId: null,
    });

    let createCalled = false;
    await page.route('**/organizations', (route) => {
      if (route.request().method() === 'POST') {
        createCalled = true;
        return route.fulfill({
          status: 201,
          json: {
            ...mockOrg,
            name: 'My New Org',
            members: [mockOrg.members[0]],
          },
        });
      }
      return route.continue();
    });

    // After creation, profile refetch shows the org
    let profileCallCount = 0;
    await page.route('**/auth/profile', (route) => {
      profileCallCount++;
      // After create, return user with org
      if (profileCallCount > 1) {
        return route.fulfill({
          status: 200,
          json: {
            ...user,
            organizationId: mockOrg.id,
            role: 'owner',
          },
        });
      }
      return route.fulfill({ status: 200, json: user });
    });

    await page.route('**/organizations/' + mockOrg.id, (route) =>
      route.fulfill({
        status: 200,
        json: { ...mockOrg, name: 'My New Org', members: [mockOrg.members[0]] },
      }),
    );

    await page.goto('/dashboard/organizations');

    await page.getByPlaceholder(/name/i).fill('My New Org');
    await page.getByRole('button', { name: /create/i }).click();

    expect(createCalled).toBe(true);
  });
});

test.describe('Organizations — owner managing org', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, {
      plan: 'team',
      organizationId: mockOrg.id,
      role: 'owner',
    });
    await page.route('**/organizations/' + mockOrg.id, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, json: mockOrg });
      }
      return route.continue();
    });
  });

  test('displays org name and all members', async ({ page }) => {
    await page.goto('/dashboard/organizations');

    await expect(page.getByText('Acme Corp')).toBeVisible();
    await expect(page.getByText('test@example.com')).toBeVisible();
    await expect(page.getByText('jane@example.com')).toBeVisible();
    await expect(page.getByText('bob@example.com')).toBeVisible();
  });

  test('can invite a new member', async ({ page }) => {
    let inviteCalled = false;
    let inviteBody: Record<string, string> = {};
    await page.route('**/organizations/*/members', (route) => {
      if (route.request().method() === 'POST') {
        inviteCalled = true;
        inviteBody = route.request().postDataJSON();
        return route.fulfill({ status: 201 });
      }
      return route.continue();
    });

    // Refetch org after invite includes new member
    await page.goto('/dashboard/organizations');
    await page.getByRole('button', { name: /invite/i }).click();

    await page.getByPlaceholder(/email/i).fill('newuser@example.com');
    // Select role if there's a dropdown
    const roleSelect = page.locator('select').first();
    if (await roleSelect.isVisible()) {
      await roleSelect.selectOption('member');
    }

    await page
      .getByRole('button', { name: /invite/i })
      .last()
      .click();

    expect(inviteCalled).toBe(true);
    expect(inviteBody.email).toBe('newuser@example.com');
  });

  test('can remove a member', async ({ page }) => {
    let removeCalled = false;
    await page.route('**/organizations/*/members/usr_member_003', (route) => {
      if (route.request().method() === 'DELETE') {
        removeCalled = true;
        return route.fulfill({ status: 200 });
      }
      return route.continue();
    });

    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/dashboard/organizations');

    // Find Bob's row and click remove
    const bobRow = page.getByText('bob@example.com').locator('..');
    const removeBtn = bobRow.getByRole('button', { name: /remove|delete/i });
    if (await removeBtn.isVisible()) {
      await removeBtn.click();
    } else {
      // Might be a generic delete button in the row
      await bobRow.locator('button').last().click();
    }

    expect(removeCalled).toBe(true);
  });

  test('can rename the organization', async ({ page }) => {
    let renameCalled = false;
    await page.route('**/organizations/' + mockOrg.id, (route) => {
      if (route.request().method() === 'PATCH') {
        renameCalled = true;
        return route.fulfill({
          status: 200,
          json: { ...mockOrg, name: 'Acme Inc' },
        });
      }
      return route.fulfill({ status: 200, json: mockOrg });
    });

    await page.goto('/dashboard/organizations');
    await page.getByRole('button', { name: /rename/i }).click();

    const nameInput = page.locator('input[type="text"]').last();
    await nameInput.clear();
    await nameInput.fill('Acme Inc');
    await page.getByRole('button', { name: /save/i }).click();

    expect(renameCalled).toBe(true);
  });

  test('can transfer ownership', async ({ page }) => {
    let transferCalled = false;
    await page.route('**/organizations/*/transfer-ownership', (route) => {
      transferCalled = true;
      return route.fulfill({ status: 200 });
    });

    await page.goto('/dashboard/organizations');
    await page.getByRole('button', { name: /transfer/i }).click();

    await page.getByPlaceholder(/email/i).last().fill('jane@example.com');
    await page
      .getByRole('button', { name: /transfer/i })
      .last()
      .click();

    expect(transferCalled).toBe(true);
  });

  test('can delete the organization with confirmation', async ({ page }) => {
    let deleteCalled = false;
    await page.route('**/organizations/' + mockOrg.id, (route) => {
      if (route.request().method() === 'DELETE') {
        deleteCalled = true;
        return route.fulfill({ status: 200 });
      }
      return route.fulfill({ status: 200, json: mockOrg });
    });

    await page.goto('/dashboard/organizations');
    await page
      .getByRole('button', { name: /delete/i })
      .first()
      .click();

    // Type org name to confirm
    const confirmInput = page
      .getByPlaceholder(/type/i)
      .or(page.locator('input[type="text"]').last());
    await confirmInput.fill('Acme Corp');
    await page
      .getByRole('button', { name: /delete/i })
      .last()
      .click();

    expect(deleteCalled).toBe(true);
  });
});

test.describe('Organizations — member (non-owner)', () => {
  test('cannot see owner-only settings (transfer, delete)', async ({
    page,
  }) => {
    await authenticateAs(page, {
      id: 'usr_member_002',
      plan: 'team',
      organizationId: mockOrg.id,
      role: 'admin',
    });
    await page.route('**/organizations/' + mockOrg.id, (route) =>
      route.fulfill({ status: 200, json: mockOrg }),
    );

    await page.goto('/dashboard/organizations');

    await expect(page.getByText('Acme Corp')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /transfer/i }),
    ).not.toBeVisible();
  });
});

test.describe('Organizations — invite rejection', () => {
  test('invite calls endpoint and receives 409 for paid user', async ({
    page,
  }) => {
    await authenticateAs(page, {
      plan: 'team',
      organizationId: mockOrg.id,
      role: 'owner',
    });
    await page.route('**/organizations/' + mockOrg.id, (route) =>
      route.fulfill({ status: 200, json: mockOrg }),
    );

    let inviteStatus = 0;
    await page.route('**/organizations/*/members', (route) => {
      if (route.request().method() === 'POST') {
        inviteStatus = 409;
        return route.fulfill({
          status: 409,
          json: {
            message:
              'This user has an active starter subscription. They must cancel it before joining your organization.',
          },
        });
      }
      return route.continue();
    });

    await page.goto('/dashboard/organizations');
    await page.getByRole('button', { name: /invite/i }).click();

    const emailInput = page
      .getByPlaceholder(/email/i)
      .or(
        page
          .locator('dialog input[type="email"], dialog input[type="text"]')
          .first(),
      );
    await emailInput.fill('paid-user@example.com');

    await page
      .getByRole('button', { name: /invite/i })
      .last()
      .click();

    // The API interceptor shows the error as a toast.
    // We verify the endpoint was called and returned 409.
    expect(inviteStatus).toBe(409);
  });
});

test.describe('Organizations — dissolving state', () => {
  // NOTE: Frontend doesn't render dissolving status yet.
  // This test verifies the org page loads with dissolving data without errors.
  // Once the frontend shows a dissolving banner, add assertion for it.
  test('org page loads with dissolving org data', async ({ page }) => {
    await authenticateAs(page, {
      plan: 'team',
      organizationId: mockOrg.id,
      role: 'owner',
    });
    await page.route('**/organizations/' + mockOrg.id, (route) =>
      route.fulfill({ status: 200, json: dissolvingOrg }),
    );

    await page.goto('/dashboard/organizations');

    // Org still renders (dissolving is backend-enforced, not frontend-displayed yet)
    await expect(page.getByText('Acme Corp')).toBeVisible();
  });
});

test.describe('Organizations — cross-member domain visibility', () => {
  test('org member sees domains from all members', async ({ page }) => {
    await authenticateAs(page, orgMemberUser);
    await page.route('**/domains', (route) =>
      route.fulfill({ status: 200, json: orgMixedDomains }),
    );

    await page.goto('/dashboard/domains');

    // Should see own domains AND other member's domain
    await expect(page.getByText('example.com')).toBeVisible();
    await expect(page.getByText('other-member.io')).toBeVisible();
  });
});

test.describe('Organizations — pooled resource counts', () => {
  test('overview shows pooled counts for org members', async ({ page }) => {
    await authenticateAs(page, orgMemberUser);

    await page.goto('/dashboard');

    // Pooled counts from orgMemberUser: 12 domains, 8 certs, 6 keys
    await expect(page.getByText('12')).toBeVisible();
    await expect(page.getByText('8')).toBeVisible();
    await expect(page.getByText('6')).toBeVisible();
  });
});
