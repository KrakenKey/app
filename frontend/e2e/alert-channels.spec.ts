import { test, expect, authenticateAs, api } from './fixtures/auth';

const slackChannel = {
  id: 'ch_001',
  type: 'slack',
  name: 'Ops alerts',
  urlMasked: 'https://hooks.slack.com/…wxyz',
  events: [
    'cert.failed',
    'cert.expiring',
    'cert.revoked',
    'cert.replacement_requested',
    'domain.verification_failed',
    'endpoint.scan_failed',
    'deploy.failed',
    'connector.stale',
  ],
  enabled: true,
  hasSecret: false,
  lastDeliveryAt: null,
  lastDeliveryStatus: null,
  lastError: null,
  createdAt: '2026-10-05T12:00:00.000Z',
  updatedAt: '2026-10-05T12:00:00.000Z',
};

test.describe('Alert channels', () => {
  test('creates a Slack channel and sends a test alert', async ({ page }) => {
    let createBody: Record<string, unknown> = {};
    let testCalled = false;

    await authenticateAs(page, { notificationPreferences: {} });
    await page.route(api('/notifications/channels'), (route) => {
      if (route.request().method() === 'POST') {
        createBody = route.request().postDataJSON();
        return route.fulfill({ status: 201, json: slackChannel });
      }
      return route.fulfill({ status: 200, json: [] });
    });
    await page.route(api('/notifications/channels/ch_001/test'), (route) => {
      testCalled = true;
      return route.fulfill({
        status: 200,
        json: { ok: true, status: 200, error: null },
      });
    });

    await page.goto('/settings');
    await expect(
      page.getByRole('heading', { name: 'Alert Channels' }),
    ).toBeVisible();
    await expect(
      page.getByText('0 of 10 channels used', { exact: false }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Add channel' }).click();
    const form = page.getByRole('form', { name: 'Add alert channel' });
    await form.getByLabel('Type').selectOption('slack');
    await form.getByLabel('Name').fill('Ops alerts');
    await form
      .getByLabel('URL')
      .fill('https://hooks.slack.com/services/T000/B000/abcdwxyz');
    await form.getByRole('button', { name: 'Add channel' }).click();

    const row = page.getByTestId('alert-channel-ch_001');
    await expect(row).toBeVisible();
    await expect(row.getByText('https://hooks.slack.com/…wxyz')).toBeVisible();
    expect(createBody).toEqual({
      type: 'slack',
      name: 'Ops alerts',
      url: 'https://hooks.slack.com/services/T000/B000/abcdwxyz',
      events: slackChannel.events,
    });

    await row.getByRole('button', { name: /send test/i }).click();
    await expect(row.getByRole('status')).toHaveText(
      'Test alert delivered (HTTP 200).',
    );
    expect(testCalled).toBe(true);
  });
});
