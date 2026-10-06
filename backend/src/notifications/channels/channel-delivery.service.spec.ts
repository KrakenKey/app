import { createHmac } from 'crypto';
import * as dns from 'dns';
import {
  ChannelDeliveryService,
  classifyStatus,
  DELIVERY_TIMEOUT_MS,
} from './channel-delivery.service';
import { createPublicOnlyLookup, HttpPostError, postJson } from './http-post';
import type { AlertMessage } from './alert-payloads';
import type { NotificationChannel } from './entities/notification-channel.entity';

jest.mock('./http-post', () => {
  const actual = jest.requireActual('./http-post');
  return { ...actual, postJson: jest.fn() };
});

const mockedPost = postJson as jest.MockedFunction<typeof postJson>;

describe('ChannelDeliveryService', () => {
  const config = {
    get: jest.fn((key: string) =>
      key === 'KK_HMAC_SECRET'
        ? 'test-hmac-secret'
        : key === 'KK_APP_DOMAIN'
          ? 'app.example.test'
          : undefined,
    ),
  };
  const service = new ChannelDeliveryService(config as never);

  const msg: AlertMessage = {
    id: 'delivery-1',
    event: 'cert.revoked',
    createdAt: '2026-10-05T00:00:00.000Z',
    payload: {
      subject: 'example.com',
      resource: { type: 'certificate', id: 9 },
    },
  };

  function channel(
    type: NotificationChannel['type'],
    url: string,
    secret?: string,
  ): NotificationChannel {
    return {
      id: 'c1',
      userId: 'u1',
      type,
      name: 'n',
      urlEncrypted: service.encrypt(url),
      secretEncrypted: secret ? service.encrypt(secret) : null,
      events: [],
      enabled: true,
      lastDeliveryAt: null,
      lastDeliveryStatus: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  beforeEach(() => {
    mockedPost.mockReset();
    jest.spyOn(dns.promises, 'resolve4').mockResolvedValue(['93.184.216.34']);
    jest.spyOn(dns.promises, 'resolve6').mockResolvedValue([]);
  });
  afterEach(() => jest.restoreAllMocks());

  it('posts a Slack message with a dashboard link and a 10s timeout', async () => {
    mockedPost.mockResolvedValue({ status: 200 });
    const url = 'https://hooks.slack.com/services/T0/B0/XYZ';

    const res = await service.deliver(channel('slack', url), msg);

    expect(res).toEqual({
      ok: true,
      status: 200,
      error: null,
      retryable: false,
    });
    const [sentUrl, body, headers, opts] = mockedPost.mock.calls[0];
    expect(sentUrl.href).toBe(url);
    expect(JSON.parse(body).blocks[0].text.text).toContain(
      'https://app.example.test/dashboard/certificates',
    );
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-KrakenKey-Signature']).toBeUndefined();
    expect(opts.timeoutMs).toBe(DELIVERY_TIMEOUT_MS);
    expect(DELIVERY_TIMEOUT_MS).toBe(10_000);
  });

  it('posts a Teams card', async () => {
    mockedPost.mockResolvedValue({ status: 202 });
    const res = await service.deliver(
      channel('teams', 'https://prod.westus.logic.azure.com/workflows/x'),
      msg,
    );
    expect(res.ok).toBe(true);
    expect(JSON.parse(mockedPost.mock.calls[0][1]).type).toBe('message');
  });

  it('signs webhook deliveries so receivers can verify them', async () => {
    mockedPost.mockResolvedValue({ status: 204 });
    const secret = 'whsec_abc';

    await service.deliver(
      channel('webhook', 'https://hooks.example.com/kk', secret),
      msg,
    );

    const [, body, headers] = mockedPost.mock.calls[0];
    expect(headers).toMatchObject({
      'Content-Type': 'application/json',
      'User-Agent': 'KrakenKey-Webhooks/1',
      'X-KrakenKey-Event': 'cert.revoked',
      'X-KrakenKey-Delivery': 'delivery-1',
    });
    const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(
      headers['X-KrakenKey-Signature'],
    );
    expect(match).not.toBeNull();
    const expected = createHmac('sha256', secret)
      .update(`${match![1]}.${body}`)
      .digest('hex');
    expect(match![2]).toBe(expected);
    expect(JSON.parse(body)).toMatchObject({
      id: 'delivery-1',
      type: 'cert.revoked',
    });
  });

  it('re-checks webhook DNS at send time and does not retry private targets', async () => {
    jest.spyOn(dns.promises, 'resolve4').mockResolvedValue(['10.0.0.1']);
    const res = await service.deliver(
      channel('webhook', 'https://rebound.example.com/kk', 'whsec_x'),
      msg,
    );
    expect(res).toMatchObject({ ok: false, retryable: false });
    expect(res.error).toBe('Webhook URL must point to a public address');
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('retries when the webhook host does not resolve', async () => {
    jest.spyOn(dns.promises, 'resolve4').mockRejectedValue(new Error('x'));
    jest.spyOn(dns.promises, 'resolve6').mockRejectedValue(new Error('x'));
    const res = await service.deliver(
      channel('webhook', 'https://gone.example.com/kk', 'whsec_x'),
      msg,
    );
    expect(res).toMatchObject({ ok: false, retryable: true });
  });

  it('reports network errors as retryable without the URL', async () => {
    mockedPost.mockRejectedValue(
      new HttpPostError('Network error (ECONNRESET)', 'ECONNRESET'),
    );
    const url = 'https://hooks.slack.com/services/T0/B0/SECRETTOKEN';
    const res = await service.deliver(channel('slack', url), msg);
    expect(res).toEqual({
      ok: false,
      status: null,
      error: 'Network error (ECONNRESET)',
      retryable: true,
    });
  });

  it('does not retry when the connection is refused for a private address', async () => {
    mockedPost.mockRejectedValue(
      new HttpPostError(
        'Destination resolves to a private address',
        'EPRIVATEADDR',
      ),
    );
    const res = await service.deliver(
      channel('webhook', 'https://hooks.example.com/kk', 'whsec_x'),
      msg,
    );
    expect(res.retryable).toBe(false);
  });

  it('fails without retry when credentials cannot be decrypted', async () => {
    const c = channel('slack', 'https://hooks.slack.com/services/T0/B0/X');
    c.urlEncrypted = 'v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA';
    const res = await service.deliver(c, msg);
    expect(res).toMatchObject({ ok: false, retryable: false });
    expect(mockedPost).not.toHaveBeenCalled();
  });

  describe('classifyStatus', () => {
    it.each([
      [200, true, false],
      [204, true, false],
      [301, false, false],
      [400, false, false],
      [401, false, false],
      [404, false, false],
      [408, false, true],
      [410, false, false],
      [429, false, true],
      [500, false, true],
      [502, false, true],
    ])('HTTP %d -> ok=%s retryable=%s', (status, ok, retryable) => {
      expect(classifyStatus(status)).toMatchObject({ ok, retryable, status });
    });

    it('explains that redirects are not followed', () => {
      expect(classifyStatus(302).error).toBe(
        'HTTP 302 (redirects are not followed)',
      );
    });
  });
});

describe('publicOnlyLookup', () => {
  let lookup = createPublicOnlyLookup(() => undefined);

  function mockLookup(addresses: { address: string; family: number }[]) {
    lookup = createPublicOnlyLookup((_host, opts, cb) => {
      expect(opts.all).toBe(true);
      cb(null, addresses);
    });
  }

  it('passes public addresses through', (done) => {
    mockLookup([{ address: '93.184.216.34', family: 4 }]);
    lookup('example.com', {}, (err, address, family) => {
      expect(err).toBeNull();
      expect(address).toBe('93.184.216.34');
      expect(family).toBe(4);
      done();
    });
  });

  it('returns every address when asked for all', (done) => {
    const list = [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1::1', family: 6 },
    ];
    mockLookup(list);
    lookup('example.com', { all: true }, (err, address) => {
      expect(err).toBeNull();
      expect(address).toEqual(list);
      done();
    });
  });

  it('refuses when any address is private (DNS rebinding)', (done) => {
    mockLookup([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    lookup('example.com', {}, (err) => {
      expect(err?.code).toBe('EPRIVATEADDR');
      done();
    });
  });
});
