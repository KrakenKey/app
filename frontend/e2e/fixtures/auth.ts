import { test as base, type Page } from '@playwright/test';

/** Default mock user returned by /auth/profile */
export const mockUser = {
  id: 'usr_test_001',
  username: 'testuser',
  email: 'test@example.com',
  displayName: 'Test User',
  groups: [],
  plan: 'free',
  createdAt: '2025-01-01T00:00:00.000Z',
  autoRenewalConfirmedAt: new Date().toISOString(),
  resourceCounts: { domains: 2, certificates: 1, apiKeys: 3 },
  role: null,
  organizationId: null,
};

/**
 * Set up auth state: inject a fake token into localStorage and
 * intercept /auth/profile to return the given user.
 */
export async function authenticateAs(
  page: Page,
  userOverrides: Record<string, unknown> = {},
) {
  const user = { ...mockUser, ...userOverrides };

  // Seed localStorage with a token before any navigation
  await page.addInitScript((token) => {
    localStorage.setItem('access_token', token);
  }, 'fake-jwt-token-for-e2e');

  // Intercept profile endpoint
  await page.route('**/auth/profile', (route) =>
    route.fulfill({ status: 200, json: user }),
  );

  return user;
}

/** Extended test fixture that provides an authenticated page */
export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, run) => {
    await authenticateAs(page);
    await run(page);
  },
});

/**
 * API route prefix. Use this to scope page.route() patterns so they only
 * intercept API calls (to api-dev.krakenkey.io) and NOT Vite page navigation
 * (localhost:5173). Usage: `page.route(api('/domains'), handler)`
 */
export function api(path: string): string {
  return `**/api-dev.krakenkey.io${path}`;
}

export { expect } from '@playwright/test';
