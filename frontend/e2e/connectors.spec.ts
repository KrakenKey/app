import type { Page } from '@playwright/test';
import { test, expect, authenticateAs, api } from './fixtures/auth';
import { mockDomains } from './fixtures/mock-data';

const HOUR = 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const ACTIVE_ID = '3f1c2b9e-1111-4111-8111-111111111111';
const WAITING_ID = '3f1c2b9e-2222-4222-8222-222222222222';
const NEW_ID = '3f1c2b9e-5555-4555-8555-555555555555';
const TOKEN = `kkce_${'x'.repeat(43)}`;

/** An issued certificate the connector restriction picker can list. */
const issuedCert = {
  id: 42,
  rawCsr: null,
  parsedCsr: {
    subject: [
      { name: 'commonName', shortName: 'CN', value: 'app.example.com' },
    ],
    attributes: [],
    extensions: [],
    publicKey: { keyType: 'ECDSA', bitLength: 256 },
  },
  requestedNames: null,
  crtPem: null,
  chainPem: null,
  status: 'issued',
  expiresAt: '2027-01-01T00:00:00.000Z',
  lastRenewedAt: null,
  autoRenew: false,
  renewalCount: 0,
  lastRenewalAttemptAt: null,
  revocationReason: null,
  failureReason: null,
  revokedAt: null,
  managedBy: 'connector',
  renewAfter: '2026-12-01T00:00:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
  userId: 'usr_test_001',
};

const deployments = [
  {
    connectorId: ACTIVE_ID,
    connectorName: 'web-01',
    certificateId: 42,
    label: 'haproxy-edge',
    state: 'rolled_back',
    serial: null,
    error: 'verify_failed',
    updatedAt: ago(2 * HOUR),
    reportedAt: ago(HOUR),
  },
  {
    connectorId: ACTIVE_ID,
    connectorName: 'web-01',
    certificateId: 42,
    label: 'nginx-main',
    state: 'verified',
    serial: '04abcdef',
    error: null,
    updatedAt: ago(3 * HOUR),
    reportedAt: ago(HOUR),
  },
];

const activeConnector = {
  id: ACTIVE_ID,
  name: 'web-01',
  clientLabel: 'Acme Corp',
  scopes: ['certs:read', 'certs:renew'],
  allowedCertIds: [42],
  allowedDomainIds: null,
  enrolledAt: ago(48 * HOUR),
  revokedAt: null,
  lastSeenAt: ago(10 * 60 * 1000),
  version: '0.3.0',
  os: 'linux',
  arch: 'amd64',
  createdAt: ago(49 * HOUR),
  deploymentSummary: { certificates: 1, targets: 2, failing: 1 },
};

const waitingConnector = {
  ...activeConnector,
  id: WAITING_ID,
  name: 'db-02',
  clientLabel: null,
  enrolledAt: null,
  lastSeenAt: null,
  version: null,
  os: null,
  arch: null,
  deploymentSummary: { certificates: 0, targets: 0, failing: 0 },
};

/** Mocks every API call the connector pages make. Returns the live list. */
async function mockApi(page: Page) {
  const state = {
    list: [activeConnector, waitingConnector] as Record<string, unknown>[],
    posted: null as Record<string, unknown> | null,
    revoked: [] as string[],
  };

  await page.route(api('/domains'), (route) =>
    route.fulfill({ status: 200, json: mockDomains }),
  );
  await page.route(api('/certs/tls'), (route) =>
    route.fulfill({ status: 200, json: [issuedCert] }),
  );
  await page.route(api('/connectors'), async (route) => {
    if (route.request().method() === 'POST') {
      state.posted = route.request().postDataJSON();
      const connector = {
        ...waitingConnector,
        id: NEW_ID,
        name: state.posted!.name,
        allowedCertIds: state.posted!.allowedCertIds ?? null,
        deploymentSummary: undefined,
      };
      state.list = [
        {
          ...connector,
          deploymentSummary: { certificates: 0, targets: 0, failing: 0 },
        },
        ...state.list,
      ];
      return route.fulfill({
        status: 201,
        json: { connector, enrollmentToken: TOKEN },
      });
    }
    return route.fulfill({ status: 200, json: state.list });
  });
  await page.route(api('/connectors/*'), (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!;
    const connector = state.list.find((c) => c.id === id);
    if (!connector) {
      return route.fulfill({
        status: 404,
        json: { statusCode: 404, message: 'Connector not found' },
      });
    }
    if (route.request().method() === 'DELETE') {
      state.revoked.push(id);
      connector.revokedAt = new Date().toISOString();
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({
      status: 200,
      json: { ...connector, deployments: id === ACTIVE_ID ? deployments : [] },
    });
  });
  return state;
}

test.describe('Connectors', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, { plan: 'starter' });
  });

  test('lists connectors with status and failing targets', async ({ page }) => {
    await mockApi(page);
    await page.goto('/dashboard');
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Connectors' })
      .click();
    await expect(page).toHaveURL('/dashboard/connectors');

    const table = page.getByRole('table');
    await expect(table.getByText('web-01')).toBeVisible();
    await expect(table.getByText('Acme Corp')).toBeVisible();
    await expect(table.getByText('Active')).toBeVisible();
    await expect(table.getByText('Waiting to enroll')).toBeVisible();
    await expect(table.getByText('10 minutes ago')).toBeVisible();
    await expect(table.getByText('1 certificate')).toBeVisible();
    await expect(table.getByText('1 failing')).toBeVisible();
  });

  test('creates a connector and shows its token only once', async ({
    page,
  }) => {
    const state = await mockApi(page);
    await page.goto('/dashboard/connectors');

    await page.getByRole('button', { name: 'New Connector' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill('web-05');
    await dialog
      .getByRole('checkbox', { name: /#42 app\.example\.com/ })
      .check();
    await dialog.getByRole('button', { name: 'Create Connector' }).click();

    await expect(page.getByTestId('enrollment-token')).toHaveText(TOKEN);
    await expect(page.getByText(/It will not be shown again/)).toBeVisible();
    await expect(page.getByLabel('Enroll on the host')).toContainText(
      'krakenkey-connector enroll --config /etc/krakenkey-connector/config.yaml',
    );
    await expect(page.getByLabel('Enroll and run with Docker')).toContainText(
      'ghcr.io/krakenkey/connector',
    );
    expect(state.posted).toEqual({
      name: 'web-05',
      scopes: ['certs:read', 'certs:renew'],
      allowedCertIds: [42],
    });
    await expect(page.getByRole('table').getByText('web-05')).toBeVisible();

    // The token isn't kept anywhere: a reload shows only the connector.
    await page.reload();
    await expect(page.getByRole('table').getByText('web-05')).toBeVisible();
    await expect(page.getByText(TOKEN)).toHaveCount(0);
  });

  test('shows a connector with its deployments', async ({ page }) => {
    await mockApi(page);
    await page.goto('/dashboard/connectors');
    await page.getByRole('link', { name: 'web-01' }).click();
    await expect(page).toHaveURL(`/dashboard/connectors/${ACTIVE_ID}`);

    await expect(page.getByRole('heading', { name: 'web-01' })).toBeVisible();
    await expect(page.getByText('linux/amd64')).toBeVisible();
    const table = page.getByRole('table', { name: 'Deployments' });
    await expect(table.getByText('nginx-main')).toBeVisible();
    await expect(table.getByText('Verified')).toBeVisible();
    await expect(table.getByText('haproxy-edge')).toBeVisible();
    await expect(table.getByText('Rolled back')).toBeVisible();
    await expect(table.getByText('verify_failed')).toBeVisible();
    await expect(page.getByText('1 failing target')).toBeVisible();
    // Enrolled, so no new token.
    await expect(
      page.getByRole('button', { name: /New enrollment token/ }),
    ).toHaveCount(0);
  });

  test('revokes a connector after confirming', async ({ page }) => {
    const state = await mockApi(page);
    await page.goto(`/dashboard/connectors/${ACTIVE_ID}`);

    await page.getByRole('button', { name: 'Revoke', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/stops at its next check/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Revoke Connector' }).click();

    await expect.poll(() => state.revoked).toEqual([ACTIVE_ID]);
    await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Revoke', exact: true }),
    ).toHaveCount(0);
  });

  test('issues a new enrollment token for a connector that has not enrolled', async ({
    page,
  }) => {
    await mockApi(page);
    let issued = 0;
    await page.route(
      api(`/connectors/${WAITING_ID}/enrollment-token`),
      (route) => {
        issued++;
        return route.fulfill({ status: 201, json: { enrollmentToken: TOKEN } });
      },
    );
    await page.goto(`/dashboard/connectors/${WAITING_ID}`);

    await expect(page.getByText(/has not enrolled yet/)).toBeVisible();
    await page.getByRole('button', { name: /New enrollment token/ }).click();
    await expect(page.getByTestId('enrollment-token')).toHaveText(TOKEN);
    expect(issued).toBe(1);
  });
});
