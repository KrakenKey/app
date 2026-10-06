import { ConfigService } from '@nestjs/config';
import { AriService } from './ari.service';

const DIRECTORY = 'https://acme.test/directory';
const RENEWAL_INFO = 'https://acme.test/renewal-info';

function config(env: Record<string, string> = {}) {
  return {
    get: (k: string) => ({ KK_ACME_DIRECTORY_URL: DIRECTORY, ...env })[k],
  } as unknown as ConfigService;
}

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...init.headers },
    ...init,
  });
}

describe('AriService', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });
  afterEach(() => fetchMock.mockRestore());

  it('is on by default and off with KK_ACME_ARI=false', () => {
    expect(new AriService(config()).isEnabled()).toBe(true);
    expect(new AriService(config({ KK_ACME_ARI: 'false' })).isEnabled()).toBe(
      false,
    );
  });

  it('reads the window and Retry-After for a certificate', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ renewalInfo: RENEWAL_INFO }))
      .mockResolvedValueOnce(
        json(
          {
            suggestedWindow: {
              start: '2027-01-01T00:00:00Z',
              end: '2027-01-02T00:00:00Z',
            },
          },
          { headers: { 'retry-after': '7200' } },
        ),
      );
    const svc = new AriService(config());
    await expect(svc.getRenewalInfo('abc.def')).resolves.toEqual({
      window: {
        start: new Date('2027-01-01T00:00:00Z'),
        end: new Date('2027-01-02T00:00:00Z'),
        explanationUrl: null,
      },
      retryAfterSeconds: 7200,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(DIRECTORY);
    expect(fetchMock.mock.calls[1][0]).toBe(`${RENEWAL_INFO}/abc.def`);
  });

  it('caches the directory lookup', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url === DIRECTORY
          ? json({ renewalInfo: RENEWAL_INFO })
          : new Response(null, { status: 404 }),
      ),
    );
    const svc = new AriService(config());
    await svc.getRenewalInfo('a.b');
    await svc.getRenewalInfo('c.d');
    expect(fetchMock.mock.calls.filter((c) => c[0] === DIRECTORY)).toHaveLength(
      1,
    );
  });

  it('returns null when the CA has no info or no ARI support', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ renewalInfo: RENEWAL_INFO }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(
      new AriService(config()).getRenewalInfo('a.b'),
    ).resolves.toBeNull();

    fetchMock.mockResolvedValueOnce(json({ newOrder: 'x' }));
    await expect(
      new AriService(config()).getRenewalInfo('a.b'),
    ).resolves.toBeNull();
  });

  it('throws on server errors and malformed bodies', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ renewalInfo: RENEWAL_INFO }))
      .mockResolvedValueOnce(new Response('oops', { status: 503 }));
    const svc = new AriService(config());
    await expect(svc.getRenewalInfo('a.b')).rejects.toThrow('503');

    fetchMock.mockResolvedValueOnce(json({ suggestedWindow: {} }));
    await expect(svc.getRenewalInfo('a.b')).rejects.toThrow('malformed');
  });

  it('retries the directory after a failed lookup', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const svc = new AriService(config());
    await expect(svc.getRenewalInfoUrl()).rejects.toThrow('network down');
    fetchMock.mockResolvedValueOnce(json({ renewalInfo: RENEWAL_INFO }));
    await expect(svc.getRenewalInfoUrl()).resolves.toBe(RENEWAL_INFO);
  });
});
