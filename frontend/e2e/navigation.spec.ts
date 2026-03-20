import { test, expect } from '@playwright/test';

test.describe('Navigation guards', () => {
  const protectedRoutes = [
    '/dashboard',
    '/dashboard/domains',
    '/dashboard/certificates',
    '/dashboard/api-keys',
    '/dashboard/billing',
    '/dashboard/organizations',
    '/settings',
  ];

  for (const route of protectedRoutes) {
    test(`${route} redirects unauthenticated users to home`, async ({
      page,
    }) => {
      await page.goto(route);
      await expect(page).toHaveURL('/');
    });
  }
});
