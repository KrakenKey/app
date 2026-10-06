import { test, expect, authenticateAs, api } from './fixtures/auth';
import { mockApiKeys, mockGithubOidcTrusts } from './fixtures/mock-data';

const TRUSTS = api('/auth/github-oidc/trusts');

test.describe('GitHub Actions trust policies', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, { plan: 'starter' });
    await page.route(api('/auth/api-keys') + '*', (route) =>
      route.fulfill({ status: 200, json: mockApiKeys }),
    );
  });

  test('creates a policy and shows the workflow snippet', async ({ page }) => {
    let body: Record<string, unknown> | undefined;
    await page.route(TRUSTS, (route) => {
      if (route.request().method() === 'POST') {
        body = route.request().postDataJSON();
        return route.fulfill({
          status: 201,
          json: {
            ...mockGithubOidcTrusts[0],
            id: '6f0c1a2b-0000-4000-8000-000000000002',
            name: body?.name,
            repository: body?.repository,
            repositoryId: null,
            allowedRefs: body?.allowedRefs ?? null,
            environment: null,
            scopes: body?.scopes ?? null,
            lastUsedAt: null,
            lastUsedRef: null,
          },
        });
      }
      return route.fulfill({ status: 200, json: mockGithubOidcTrusts });
    });

    await page.goto('/dashboard/api-keys');
    const section = page.getByRole('region', {
      name: 'GitHub Actions (no stored key)',
    });
    await expect(section.getByText('pinned to repo id 123456')).toBeVisible();

    const form = section.getByRole('form', { name: 'Add GitHub trust policy' });
    await form.getByLabel('Policy name').fill('api renewal');
    await form.getByLabel('Repository').fill('octo/api');
    await form.getByLabel(/branches or tags/i).fill('refs/heads/main');
    await form.getByRole('radio', { name: /certificate renewal/i }).check();
    await form.getByRole('button', { name: /add trust policy/i }).click();

    const snippet = section.getByLabel('Workflow snippet');
    await expect(snippet).toContainText('id-token: write');
    await expect(snippet).toContainText('krakenkey/cert-action@v1');
    await expect(snippet).not.toContainText('trust-id');
    await expect(section.getByText('not used yet')).toBeVisible();

    expect(body).toMatchObject({
      name: 'api renewal',
      repository: 'octo/api',
      allowedRefs: ['refs/heads/main'],
    });
    expect([...(body?.scopes as string[])].sort()).toEqual([
      'account:read',
      'certs:read',
      'certs:renew',
    ]);
  });
});
