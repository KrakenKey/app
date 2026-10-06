import { test, expect, authenticateAs, api } from './fixtures/auth';

const REPORT_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'e2eShareToken_e2eShareToken_e2eShareToken_';

const hosts = [
  {
    host: 'old.example.com',
    port: 443,
    status: 'complete',
    severity: 'critical',
    problems: [
      {
        code: 'expired',
        severity: 'critical',
        message: 'Certificate expired on 2026-10-01T00:00:00Z',
      },
    ],
    reachable: true,
    error: null,
    tlsVersion: 'TLS 1.2',
    notAfter: '2026-10-01T00:00:00Z',
    daysLeft: -4,
    issuer: 'CN=X,O=DigiCert Inc,C=US',
    issuerName: 'DigiCert Inc',
    subject: 'CN=old.example.com',
    sans: ['old.example.com'],
    hostnameCovered: true,
    trusted: false,
    chainDepth: 2,
    keyType: 'RSA',
    keySize: 2048,
    letsEncrypt: false,
    scannedAt: '2026-10-05T10:00:30Z',
  },
  {
    host: 'example.com',
    port: 443,
    status: 'complete',
    severity: 'ok',
    problems: [],
    reachable: true,
    error: null,
    tlsVersion: 'TLS 1.3',
    notAfter: '2026-12-20T00:00:00Z',
    daysLeft: 75,
    issuer: "CN=R11,O=Let's Encrypt,C=US",
    issuerName: "Let's Encrypt",
    subject: 'CN=example.com',
    sans: ['example.com'],
    hostnameCovered: true,
    trusted: true,
    chainDepth: 2,
    keyType: 'ECDSA',
    keySize: 256,
    letsEncrypt: true,
    scannedAt: '2026-10-05T10:00:31Z',
  },
];

const summary = {
  totalHosts: 2,
  scannedHosts: 2,
  counts: { critical: 1, warning: 0, notice: 0, ok: 1 },
  issuers: [
    { issuer: 'DigiCert Inc', count: 1 },
    { issuer: "Let's Encrypt", count: 1 },
  ],
  letsEncryptHosts: 1,
  earliestExpiry: {
    host: 'old.example.com',
    port: 443,
    notAfter: '2026-10-01T00:00:00Z',
    daysLeft: -4,
  },
};

const report = {
  id: REPORT_ID,
  name: 'Client sites',
  status: 'complete',
  hostCount: 2,
  completedCount: 2,
  share: null as null | { expiresAt: string; createdAt: string },
  createdAt: '2026-10-05T10:00:00Z',
  completedAt: '2026-10-05T10:01:00Z',
  expiresAt: '2027-01-03T10:00:00Z',
  summary,
  hosts,
};

test.describe('Portfolio reports', () => {
  test('create a report, view it and share it', async ({ page }) => {
    await authenticateAs(page, { plan: 'free' });
    let created: unknown;
    let shared = false;

    await page.route(api('/reports'), (route) => {
      if (route.request().method() === 'POST') {
        created = route.request().postDataJSON();
        return route.fulfill({
          status: 201,
          json: { ...report, status: 'pending', completedCount: 0 },
        });
      }
      return route.fulfill({ status: 200, json: [] });
    });
    await page.route(api(`/reports/${REPORT_ID}`), (route) =>
      route.fulfill({
        status: 200,
        json: {
          ...report,
          share: shared
            ? {
                expiresAt: '2026-11-04T10:00:00Z',
                createdAt: '2026-10-05T10:02:00Z',
              }
            : null,
        },
      }),
    );
    await page.route(api(`/reports/${REPORT_ID}/share`), (route) => {
      shared = true;
      return route.fulfill({
        status: 201,
        json: {
          url: `http://localhost:5173/r/${TOKEN}`,
          token: TOKEN,
          expiresAt: '2026-11-04T10:00:00Z',
        },
      });
    });

    await page.goto('/dashboard');
    await page.getByRole('link', { name: 'Reports' }).click();
    await expect(
      page.getByRole('heading', { name: 'Reports', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('No reports yet')).toBeVisible();

    await page
      .getByLabel('Hosts')
      .fill('example.com\nold.example.com\nexample.com');
    await expect(page.getByTestId('host-count')).toHaveText('2 of 25 hosts');
    await page.getByLabel('Name (optional)').fill('Client sites');
    await page.getByRole('button', { name: /run report/i }).click();

    await expect(page).toHaveURL(
      new RegExp(`/dashboard/reports/${REPORT_ID}$`),
    );
    expect(created).toEqual({
      hosts: ['example.com', 'old.example.com', 'example.com'],
      name: 'Client sites',
    });

    await expect(
      page.getByRole('heading', { name: 'Client sites' }),
    ).toBeVisible();
    await expect(page.getByTestId('count-critical')).toHaveText('1');
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toContainText('old.example.com');
    await expect(rows.first()).toContainText('Certificate expired');

    await page.getByRole('button', { name: 'Critical' }).first().click();
    await expect(rows).toHaveCount(1);

    await page
      .context()
      .grantPermissions(['clipboard-write'])
      .catch(() => {});
    await page.getByRole('button', { name: 'Share' }).click();
    await expect(page.getByLabel('Share link')).toHaveValue(
      `http://localhost:5173/r/${TOKEN}`,
    );
    await expect(page.getByText(/Shared link active until/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Revoke' })).toBeVisible();
  });

  test('shared link works logged out', async ({ page }) => {
    await page.route(api(`/public/reports/${TOKEN}`), (route) => {
      expect(route.request().headers()['authorization']).toBeUndefined();
      return route.fulfill({
        status: 200,
        json: {
          name: 'Client sites',
          status: 'complete',
          hostCount: 2,
          completedCount: 2,
          createdAt: report.createdAt,
          completedAt: report.completedAt,
          shareExpiresAt: '2026-11-04T10:00:00Z',
          summary,
          hosts,
        },
      });
    });

    await page.goto(`/r/${TOKEN}`);
    await expect(
      page.getByRole('heading', { name: 'Client sites' }),
    ).toBeVisible();
    await expect(page.getByText(/This link expires on/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'KrakenKey' })).toHaveAttribute(
      'href',
      'https://krakenkey.io',
    );
    await expect(page.getByRole('button', { name: 'Share' })).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/r/${TOKEN}$`));
  });
});
