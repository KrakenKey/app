import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorService } from '@nestjs/terminus';
import { AuthentikHealthIndicator } from './authentik.health';

describe('AuthentikHealthIndicator', () => {
  let indicator: AuthentikHealthIndicator;
  let mockConfigGet: jest.Mock;

  beforeEach(async () => {
    mockConfigGet = jest
      .fn()
      .mockReturnValue('https://auth.example.com/application/o/krakenkey/');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthentikHealthIndicator,
        HealthIndicatorService,
        {
          provide: ConfigService,
          useValue: { get: mockConfigGet },
        },
      ],
    }).compile();

    indicator = module.get<AuthentikHealthIndicator>(AuthentikHealthIndicator);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns up when the OIDC discovery endpoint returns 200', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    const result = await indicator.isHealthy('auth');
    expect(result['auth'].status).toBe('up');
  });

  it('returns down when the OIDC discovery endpoint returns a non-200 status', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });

    const result = await indicator.isHealthy('auth');
    expect(result['auth'].status).toBe('down');
    expect((result['auth'] as { message?: string }).message).toContain('503');
  });

  it('returns down when fetch throws a network error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await indicator.isHealthy('auth');
    expect(result['auth'].status).toBe('down');
    expect((result['auth'] as { message?: string }).message).toContain(
      'ECONNREFUSED',
    );
  });

  it('returns down when fetch is aborted (timeout)', async () => {
    global.fetch = jest.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), {
        name: 'AbortError',
      }),
    );

    const result = await indicator.isHealthy('auth');
    expect(result['auth'].status).toBe('down');
  });

  it('returns down when KK_AUTHENTIK_ISSUER_URL is not configured', async () => {
    mockConfigGet.mockReturnValue(undefined);
    global.fetch = jest.fn();

    const result = await indicator.isHealthy('auth');
    expect(result['auth'].status).toBe('down');
    expect((result['auth'] as { message?: string }).message).toContain(
      'KK_AUTHENTIK_ISSUER_URL',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls the OIDC discovery URL for the configured issuer', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    await indicator.isHealthy('auth');

    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(mockConfigGet).toHaveBeenCalledWith('KK_AUTHENTIK_ISSUER_URL');
    expect(url).toBe(
      'https://auth.example.com/application/o/krakenkey/.well-known/openid-configuration',
    );
  });

  it('handles an issuer URL without a trailing slash', async () => {
    mockConfigGet.mockReturnValue(
      'https://auth.example.com/application/o/krakenkey',
    );
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    await indicator.isHealthy('auth');

    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toBe(
      'https://auth.example.com/application/o/krakenkey/.well-known/openid-configuration',
    );
  });

  it('clears the abort timeout when fetch throws', async () => {
    const clearSpy = jest.spyOn(global, 'clearTimeout');
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await indicator.isHealthy('auth');

    expect(clearSpy).toHaveBeenCalled();
  });
});
