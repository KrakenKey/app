import {
  MarketplaceApiError,
  MarketplaceFulfillmentClient,
} from './marketplace-fulfillment.client';
import {
  MARKETPLACE_API_BASE,
  MARKETPLACE_RESOURCE_ID,
  type MarketplaceConfig,
} from './marketplace.config';

const SECRET = 'super-secret-value';
const config = {
  tenantId: 'tenant-1',
  clientId: 'client-1',
  clientSecret: SECRET,
} as unknown as MarketplaceConfig;

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('MarketplaceFulfillmentClient', () => {
  let fetchMock: jest.Mock;
  let client: MarketplaceFulfillmentClient;
  let tokenCount: number;

  beforeEach(() => {
    tokenCount = 0;
    fetchMock = jest.fn(async (url: string) => {
      if (url.startsWith('https://login.microsoftonline.com/')) {
        tokenCount += 1;
        return json(200, {
          token_type: 'Bearer',
          expires_in: '3600',
          access_token: `access-${tokenCount}`,
        });
      }
      return json(200, { id: 'sub-1', offerId: 'o', planId: 'p' });
    });
    client = new MarketplaceFulfillmentClient(config, fetchMock as any);
    for (const level of ['log', 'warn', 'error'] as const) {
      jest
        .spyOn((client as any).logger, level)
        .mockImplementation(() => undefined);
    }
  });

  afterEach(() => jest.useRealTimers());

  it('requests a client credentials token for the Marketplace API', async () => {
    await client.getSubscription('sub-1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token',
    );
    const form = new URLSearchParams(init.body as string);
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('client_id')).toBe('client-1');
    expect(form.get('client_secret')).toBe(SECRET);
    expect(form.get('scope')).toBe(`${MARKETPLACE_RESOURCE_ID}/.default`);
  });

  it('caches the token until shortly before it expires', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-13T00:00:00Z') });
    await client.getSubscription('sub-1');
    await client.getSubscription('sub-1');
    expect(tokenCount).toBe(1);

    // 54 minutes later: still cached (refreshes 5 minutes before expiry).
    jest.setSystemTime(new Date('2026-10-13T00:54:00Z'));
    await client.getSubscription('sub-1');
    expect(tokenCount).toBe(1);

    jest.setSystemTime(new Date('2026-10-13T00:56:00Z'));
    await client.getSubscription('sub-1');
    expect(tokenCount).toBe(2);
  });

  it('shares one token request between concurrent calls', async () => {
    await Promise.all([
      client.getSubscription('a'),
      client.getSubscription('b'),
      client.getSubscription('c'),
    ]);
    expect(tokenCount).toBe(1);
  });

  it('resolves with the marketplace token header and the bearer token', async () => {
    await client.resolve('ab+cd/ef');

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(
      `${MARKETPLACE_API_BASE}/subscriptions/resolve?api-version=2018-08-31`,
    );
    expect(init.method).toBe('POST');
    expect(init.headers['x-ms-marketplace-token']).toBe('ab+cd/ef');
    expect(init.headers.authorization).toBe('Bearer access-1');
    expect(init.headers['x-ms-requestid']).toEqual(expect.any(String));
  });

  it('activates and updates operations with the documented paths and bodies', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('login.microsoftonline.com')
        ? json(200, { access_token: 't', expires_in: 3600 })
        : json(200),
    );

    await client.activate('sub-1');
    await client.updateOperation('sub-1', 'op-1', 'Failure');

    const calls = fetchMock.mock.calls.filter(([u]) =>
      String(u).startsWith(MARKETPLACE_API_BASE),
    );
    expect(calls[0][0]).toBe(
      `${MARKETPLACE_API_BASE}/subscriptions/sub-1/activate?api-version=2018-08-31`,
    );
    expect(calls[0][1].method).toBe('POST');
    expect(calls[1][0]).toBe(
      `${MARKETPLACE_API_BASE}/subscriptions/sub-1/operations/op-1?api-version=2018-08-31`,
    );
    expect(calls[1][1].method).toBe('PATCH');
    expect(JSON.parse(calls[1][1].body)).toEqual({ status: 'Failure' });
  });

  it('reads an operation id spelled "id  " like Microsoft\'s example', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('login.microsoftonline.com')
        ? json(200, { access_token: 't', expires_in: 3600 })
        : json(200, {
            'id  ': 'op-1',
            subscriptionId: 'sub-1',
            action: 'ChangePlan',
            status: 'InProgress',
          }),
    );
    await expect(client.getOperation('sub-1', 'op-1')).resolves.toMatchObject({
      id: 'op-1',
      action: 'ChangePlan',
    });
  });

  it('gets a new token once when the API answers 401', async () => {
    let apiCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('login.microsoftonline.com')) {
        tokenCount += 1;
        return json(200, { access_token: `t${tokenCount}`, expires_in: 3600 });
      }
      apiCalls += 1;
      return apiCalls === 1 ? json(401) : json(200, { id: 'sub-1' });
    });

    await expect(client.getSubscription('sub-1')).resolves.toMatchObject({
      id: 'sub-1',
    });
    expect(tokenCount).toBe(2);
  });

  it('throws MarketplaceApiError with the status for API errors', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('login.microsoftonline.com')
        ? json(200, { access_token: 't', expires_in: 3600 })
        : json(400, { error: 'bad token' }),
    );
    const err = await client.resolve('expired').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MarketplaceApiError);
    expect((err as MarketplaceApiError).status).toBe(400);
  });

  it('throws status 0 when Microsoft is unreachable', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('login.microsoftonline.com')) {
        return json(200, { access_token: 't', expires_in: 3600 });
      }
      throw new Error('ECONNRESET');
    });
    const err = await client.getSubscription('x').catch((e: unknown) => e);
    expect((err as MarketplaceApiError).status).toBe(0);
  });

  it('refuses to call Microsoft without credentials', async () => {
    const bare = new MarketplaceFulfillmentClient(
      { tenantId: '', clientId: '', clientSecret: '' } as any,
      fetchMock as any,
    );
    await expect(bare.getSubscription('x')).rejects.toThrow(
      MarketplaceApiError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never logs the secret, the access token or the purchase token', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('login.microsoftonline.com')
        ? json(200, { access_token: 'access-xyz', expires_in: 3600 })
        : json(500),
    );
    await client.resolve('purchase-token-abc').catch(() => undefined);

    const logged = ['log', 'warn', 'error']
      .flatMap((l) => (client as any).logger[l].mock.calls)
      .map((args: unknown[]) => args.join(' '))
      .join('\n');
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain('access-xyz');
    expect(logged).not.toContain('purchase-token-abc');
  });
});
