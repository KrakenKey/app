import {
  buildSlackBody,
  buildTeamsBody,
  buildWebhookBody,
  dashboardLink,
  signWebhookPayload,
  type AlertMessage,
} from './alert-payloads';

describe('alert payloads', () => {
  const msg: AlertMessage = {
    id: '6f1c1a8e-0000-4000-8000-000000000001',
    event: 'cert.expiring',
    createdAt: '2026-10-05T06:00:00.000Z',
    payload: {
      subject: 'api.example.com',
      resource: { type: 'certificate', id: 42 },
      details: {
        certificateId: 42,
        daysUntilExpiry: 5,
        expiresAt: '2026-10-10T00:00:00.000Z',
        ignored: undefined,
        empty: null,
      },
    },
  };
  const link = 'https://app.krakenkey.io/dashboard/certificates';

  it('links to the dashboard section for the resource', () => {
    expect(dashboardLink('app.krakenkey.io', msg.payload)).toBe(link);
    expect(
      dashboardLink('dev.krakenkey.io', {
        subject: 'x',
        resource: { type: 'endpoint', id: 'e' },
      }),
    ).toBe('https://dev.krakenkey.io/dashboard/endpoints');
    expect(dashboardLink('app.krakenkey.io', { subject: 'x' })).toBe(
      'https://app.krakenkey.io/dashboard',
    );
  });

  it('builds a Slack message with text and a section block', () => {
    const body = buildSlackBody(msg, link);
    expect(body.text).toBe('Certificate expiring soon: api.example.com');
    expect(body.blocks).toHaveLength(1);
    expect(body.blocks[0].type).toBe('section');
    const text = body.blocks[0].text.text;
    expect(text).toContain('*Certificate expiring soon*');
    expect(text).toContain('api.example.com');
    expect(text).toContain('*Days until expiry:* 5');
    expect(text).toContain(`<${link}|Open in KrakenKey>`);
    expect(text).not.toContain('Ignored');
    expect(text).not.toContain('Empty');
  });

  it('escapes Slack control characters in user-supplied text', () => {
    const body = buildSlackBody(
      { ...msg, payload: { subject: '<!channel> & co' } },
      link,
    );
    expect(body.blocks[0].text.text).toContain('&lt;!channel&gt; &amp; co');
  });

  it('builds a Teams Adaptive Card 1.4 message', () => {
    const body = buildTeamsBody(msg, link);
    expect(body.type).toBe('message');
    expect(body.attachments).toHaveLength(1);
    const att = body.attachments[0];
    expect(att.contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(att.content.type).toBe('AdaptiveCard');
    expect(att.content.version).toBe('1.4');
    expect(att.content.body[0]).toMatchObject({
      type: 'TextBlock',
      text: 'Certificate expiring soon',
    });
    expect(att.content.body.every((b) => b.type === 'TextBlock')).toBe(true);
    expect(att.content.body.map((b) => b.text)).toContain(
      '**Days until expiry:** 5',
    );
    expect(att.content.actions).toEqual([
      { type: 'Action.OpenUrl', title: 'Open in KrakenKey', url: link },
    ]);
  });

  it('builds the webhook envelope', () => {
    expect(buildWebhookBody(msg, link)).toEqual({
      id: msg.id,
      type: 'cert.expiring',
      createdAt: msg.createdAt,
      data: {
        title: 'Certificate expiring soon',
        subject: 'api.example.com',
        resource: { type: 'certificate', id: 42 },
        details: {
          certificateId: 42,
          daysUntilExpiry: 5,
          expiresAt: '2026-10-10T00:00:00.000Z',
          empty: null,
        },
        url: link,
      },
    });
  });

  it('builds a test message for every channel type', () => {
    const test: AlertMessage = {
      ...msg,
      event: 'test',
      payload: { subject: 'ok' },
    };
    expect(buildSlackBody(test, link).text).toBe(
      'Test notification from KrakenKey: ok',
    );
    expect(buildWebhookBody(test, link).type).toBe('test');
    expect(buildWebhookBody(test, link).data.resource).toBeNull();
  });

  it('signs "<t>.<body>" with HMAC-SHA256 (fixed vector)', () => {
    const body = '{"id":"d1","type":"test"}';
    expect(signWebhookPayload('whsec_test_secret', body, 1700000000)).toBe(
      't=1700000000,v1=7fb0bb6fd44df0dddcefcd2bec5863606613bcb0de7504ea9ad095b4f0d653b7',
    );
  });

  it('changes the signature when the body or timestamp changes', () => {
    const a = signWebhookPayload('whsec_x', '{}', 1);
    expect(signWebhookPayload('whsec_x', '{ }', 1)).not.toBe(a);
    expect(signWebhookPayload('whsec_x', '{}', 2)).not.toBe(a);
    expect(signWebhookPayload('whsec_y', '{}', 1)).not.toBe(a);
  });
});
