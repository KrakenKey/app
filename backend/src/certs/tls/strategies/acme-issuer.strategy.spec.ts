import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AcmeIssuerStrategy } from './acme-issuer.strategy';
import * as acme from 'acme-client';
import { DnsProvider } from '../interfaces/dns-provider.interface';
import { MetricsService } from '../../../metrics/metrics.service';

// ── Mock acme-client ─────────────────────────────────────────────────────────
const mockClient = {
  createAccount: jest.fn().mockResolvedValue({}),
  createOrder: jest.fn(),
  getAuthorizations: jest.fn(),
  getChallengeKeyAuthorization: jest.fn(),
  completeChallenge: jest.fn(),
  waitForValidStatus: jest.fn(),
  finalizeOrder: jest.fn(),
  getOrder: jest.fn(),
  getCertificate: jest.fn(),
  revokeCertificate: jest.fn(),
};

jest.mock('acme-client', () => {
  const actual = jest.requireActual('acme-client');
  return {
    ...actual,
    Client: jest.fn().mockImplementation(() => mockClient),
  };
});

// Mock crypto.createPrivateKey used by normalizePrivateKeyPem
jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return {
    ...actual,
    createPrivateKey: jest.fn().mockReturnValue({}),
  };
});

// Mock dns.promises.Resolver used by waitForDns
const mockResolveTxt = jest.fn();
jest.mock('dns', () => ({
  promises: {
    Resolver: jest.fn().mockImplementation(() => ({
      setServers: jest.fn(),
      resolveTxt: mockResolveTxt,
    })),
  },
}));

describe('AcmeIssuerStrategy', () => {
  let strategy: AcmeIssuerStrategy;
  let mockDnsProvider: jest.Mocked<DnsProvider>;
  let configMap: Record<string, string | undefined>;

  // Valid-looking PEM that passes the regex in normalizePrivateKeyPem
  const FAKE_ACCOUNT_KEY =
    '-----BEGIN EC PRIVATE KEY-----\nMHQCAQEEIBkg4LVWM9nuwNSk3yByxZpYRTBnVJk20LsMetVHLSJoB0IDBAMl\n-----END EC PRIVATE KEY-----';

  const FAKE_CSR_PEM =
    '-----BEGIN CERTIFICATE REQUEST-----\ntest\n-----END CERTIFICATE REQUEST-----';

  const FAKE_CERT_PEM =
    '-----BEGIN CERTIFICATE-----\ncert-data\n-----END CERTIFICATE-----';

  beforeEach(async () => {
    jest.clearAllMocks();

    // Suppress setTimeout delays in waitForDns
    jest.useFakeTimers();

    configMap = {
      KK_ACME_ACCOUNT_KEY: FAKE_ACCOUNT_KEY,
      KK_ACME_AUTH_ZONE_DOMAIN: 'auth.example.com',
      KK_ACME_DNS_RESOLVERS: '1.1.1.1,8.8.8.8',
      KK_ACME_CONTACT_EMAIL: 'test@example.com',
      KK_ACME_STAGING: 'true',
      KK_ACME_DIRECTORY_URL: undefined,
    };

    mockDnsProvider = {
      createRecord: jest.fn().mockResolvedValue(undefined),
      removeRecord: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AcmeIssuerStrategy,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => configMap[key]),
          },
        },
        {
          provide: MetricsService,
          useValue: {
            acmeChallengeDuration: { startTimer: jest.fn(() => jest.fn()) },
          },
        },
      ],
    }).compile();

    strategy = module.get<AcmeIssuerStrategy>(AcmeIssuerStrategy);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  // ─── Constructor ──────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('uses default DNS resolvers when KK_ACME_DNS_RESOLVERS is not set', async () => {
      configMap.KK_ACME_DNS_RESOLVERS = undefined;

      const module = await Test.createTestingModule({
        providers: [
          AcmeIssuerStrategy,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => configMap[key]),
            },
          },
        ],
      }).compile();

      const s = module.get<AcmeIssuerStrategy>(AcmeIssuerStrategy);
      expect(s).toBeDefined();
      // The default resolvers are Cloudflare: 172.64.35.65, 108.162.195.65
    });

    it('uses default contact email when KK_ACME_CONTACT_EMAIL is not set', async () => {
      configMap.KK_ACME_CONTACT_EMAIL = undefined;

      const module = await Test.createTestingModule({
        providers: [
          AcmeIssuerStrategy,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => configMap[key]),
            },
          },
        ],
      }).compile();

      const s = module.get<AcmeIssuerStrategy>(AcmeIssuerStrategy);
      expect(s).toBeDefined();
    });
  });

  // ─── revoke ───────────────────────────────────────────────────────────────
  describe('revoke', () => {
    it('revokes a certificate with reason code', async () => {
      mockClient.revokeCertificate.mockResolvedValue(undefined);

      await strategy.revoke(FAKE_CERT_PEM, 4);

      expect(mockClient.createAccount).toHaveBeenCalledWith({
        termsOfServiceAgreed: true,
        contact: ['mailto:test@example.com'],
      });
      expect(mockClient.revokeCertificate).toHaveBeenCalledWith(FAKE_CERT_PEM, {
        reason: 4,
      });
    });

    it('defaults reason to 0 when not provided', async () => {
      mockClient.revokeCertificate.mockResolvedValue(undefined);

      await strategy.revoke(FAKE_CERT_PEM);

      expect(mockClient.revokeCertificate).toHaveBeenCalledWith(FAKE_CERT_PEM, {
        reason: 0,
      });
    });

    it('propagates ACME revocation errors', async () => {
      mockClient.revokeCertificate.mockRejectedValue(
        new Error('ACME revocation failed'),
      );

      await expect(strategy.revoke(FAKE_CERT_PEM, 0)).rejects.toThrow(
        'ACME revocation failed',
      );
    });

    it('throws when account key is missing', async () => {
      configMap.KK_ACME_ACCOUNT_KEY = undefined;

      const module = await Test.createTestingModule({
        providers: [
          AcmeIssuerStrategy,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => configMap[key]),
            },
          },
        ],
      }).compile();

      const s = module.get<AcmeIssuerStrategy>(AcmeIssuerStrategy);
      await expect(s.revoke(FAKE_CERT_PEM)).rejects.toThrow(
        'Missing KK_ACME_ACCOUNT_KEY',
      );
    });
  });

  // ─── issue ────────────────────────────────────────────────────────────────
  describe('issue', () => {
    const mockOrder = { url: 'https://acme/order/1', identifiers: [] };
    const mockAuthz = {
      identifier: { value: 'example.com' },
      challenges: [
        { type: 'dns-01', url: 'https://acme/chall/1', token: 'tok' },
      ],
    };

    beforeEach(() => {
      // Setup the happy-path mocks
      jest
        .spyOn(acme.crypto, 'readCsrDomains')
        .mockReturnValue({ commonName: 'example.com', altNames: [] });
      mockClient.createOrder.mockResolvedValue(mockOrder);
      mockClient.getAuthorizations.mockResolvedValue([mockAuthz]);
      mockClient.getChallengeKeyAuthorization.mockResolvedValue('key-authz');
      mockClient.completeChallenge.mockResolvedValue({});
      mockClient.waitForValidStatus.mockResolvedValue({});
      mockClient.finalizeOrder.mockResolvedValue({});
      mockClient.getOrder.mockResolvedValue({
        ...mockOrder,
        certificate: 'https://acme/cert/1',
      });
      mockClient.getCertificate.mockResolvedValue(FAKE_CERT_PEM);

      // DNS resolves immediately
      mockResolveTxt.mockResolvedValue([['key-authz']]);
    });

    it('issues a certificate through the full ACME flow', async () => {
      const promise = strategy.issue(FAKE_CSR_PEM, mockDnsProvider);
      // advanceTimersByTimeAsync flushes microtasks between timer advances
      await jest.advanceTimersByTimeAsync(30000);
      const cert = await promise;

      expect(cert).toBe(FAKE_CERT_PEM);
      expect(mockClient.createOrder).toHaveBeenCalledWith({
        identifiers: [{ type: 'dns', value: 'example.com' }],
      });
      expect(mockDnsProvider.createRecord).toHaveBeenCalledWith(
        '_acme-challenge.example.com',
        'key-authz',
      );
      expect(mockClient.completeChallenge).toHaveBeenCalledWith(
        mockAuthz.challenges[0],
      );
      expect(mockClient.finalizeOrder).toHaveBeenCalledWith(
        mockOrder,
        FAKE_CSR_PEM,
      );
      expect(mockClient.getCertificate).toHaveBeenCalled();
    });

    it('cleans up DNS records after successful issuance', async () => {
      const promise = strategy.issue(FAKE_CSR_PEM, mockDnsProvider);
      await jest.advanceTimersByTimeAsync(30000);
      await promise;

      expect(mockDnsProvider.removeRecord).toHaveBeenCalledWith(
        '_acme-challenge.example.com',
      );
    });

    it('cleans up DNS records even when issuance fails', async () => {
      mockClient.finalizeOrder.mockRejectedValueOnce(
        new Error('Finalization failed'),
      );

      // Catch immediately to prevent unhandled rejection warning during timer flush
      const promise = strategy
        .issue(FAKE_CSR_PEM, mockDnsProvider)
        .catch((e) => e);
      await jest.advanceTimersByTimeAsync(30000);
      const result = await promise;

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('Finalization failed');
      expect(mockDnsProvider.removeRecord).toHaveBeenCalledWith(
        '_acme-challenge.example.com',
      );
    });

    it('throws when no DNS-01 challenge is found', async () => {
      mockClient.getAuthorizations.mockResolvedValue([
        {
          identifier: { value: 'example.com' },
          challenges: [{ type: 'http-01' }],
        },
      ]);

      await expect(
        strategy.issue(FAKE_CSR_PEM, mockDnsProvider),
      ).rejects.toThrow('No DNS-01 challenge for example.com');
    });

    it('throws when finalized order has no certificate URL', async () => {
      mockClient.getOrder.mockResolvedValueOnce({
        ...mockOrder,
        certificate: undefined,
      });

      const promise = strategy
        .issue(FAKE_CSR_PEM, mockDnsProvider)
        .catch((e) => e);
      await jest.advanceTimersByTimeAsync(30000);
      const result = await promise;

      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe(
        'Order finalized but no certificate was returned',
      );
    });

    it('handles multiple domains with deduplication', async () => {
      jest.spyOn(acme.crypto, 'readCsrDomains').mockReturnValue({
        commonName: 'example.com',
        altNames: ['example.com', 'www.example.com'],
      });

      const authzWww = {
        identifier: { value: 'www.example.com' },
        challenges: [
          { type: 'dns-01', url: 'https://acme/chall/2', token: 'tok2' },
        ],
      };
      mockClient.getAuthorizations.mockResolvedValue([mockAuthz, authzWww]);

      const promise = strategy.issue(FAKE_CSR_PEM, mockDnsProvider);
      await jest.advanceTimersByTimeAsync(60000);
      await promise;

      // Should deduplicate: example.com appears once in identifiers
      expect(mockClient.createOrder).toHaveBeenCalledWith({
        identifiers: [
          { type: 'dns', value: 'example.com' },
          { type: 'dns', value: 'www.example.com' },
        ],
      });
      expect(mockDnsProvider.createRecord).toHaveBeenCalledTimes(2);
    });

    it('tolerates DNS cleanup failures', async () => {
      mockDnsProvider.removeRecord.mockRejectedValue(
        new Error('Cleanup failed'),
      );

      const promise = strategy.issue(FAKE_CSR_PEM, mockDnsProvider);
      await jest.advanceTimersByTimeAsync(30000);

      // Should not throw despite cleanup failure
      const cert = await promise;
      expect(cert).toBe(FAKE_CERT_PEM);
    });
  });

  // ─── createClient (via revoke/issue) ──────────────────────────────────────
  describe('createClient', () => {
    it('uses staging directory when KK_ACME_STAGING=true', async () => {
      configMap.KK_ACME_DIRECTORY_URL = undefined;
      configMap.KK_ACME_STAGING = 'true';
      mockClient.revokeCertificate.mockResolvedValue(undefined);

      await strategy.revoke(FAKE_CERT_PEM);

      expect(acme.Client).toHaveBeenCalledWith(
        expect.objectContaining({
          directoryUrl: acme.directory.letsencrypt.staging,
        }),
      );
    });

    it('uses production directory by default', async () => {
      configMap.KK_ACME_DIRECTORY_URL = undefined;
      configMap.KK_ACME_STAGING = undefined;

      const module = await Test.createTestingModule({
        providers: [
          AcmeIssuerStrategy,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => configMap[key]),
            },
          },
        ],
      }).compile();

      const s = module.get<AcmeIssuerStrategy>(AcmeIssuerStrategy);
      mockClient.revokeCertificate.mockResolvedValue(undefined);

      await s.revoke(FAKE_CERT_PEM);

      expect(acme.Client).toHaveBeenCalledWith(
        expect.objectContaining({
          directoryUrl: acme.directory.letsencrypt.production,
        }),
      );
    });

    it('uses custom directory URL when KK_ACME_DIRECTORY_URL is set', async () => {
      configMap.KK_ACME_DIRECTORY_URL = 'https://custom.acme/directory';
      mockClient.revokeCertificate.mockResolvedValue(undefined);

      const module = await Test.createTestingModule({
        providers: [
          AcmeIssuerStrategy,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => configMap[key]),
            },
          },
        ],
      }).compile();

      const s = module.get<AcmeIssuerStrategy>(AcmeIssuerStrategy);
      await s.revoke(FAKE_CERT_PEM);

      expect(acme.Client).toHaveBeenCalledWith(
        expect.objectContaining({
          directoryUrl: 'https://custom.acme/directory',
        }),
      );
    });
  });

  // ─── normalizePrivateKeyPem (via createClient) ────────────────────────────
  describe('normalizePrivateKeyPem', () => {
    it('handles PEM with literal \\n escape sequences', async () => {
      configMap.KK_ACME_ACCOUNT_KEY =
        '-----BEGIN EC PRIVATE KEY-----\\nMHQCAQEE\\n-----END EC PRIVATE KEY-----';
      mockClient.revokeCertificate.mockResolvedValue(undefined);

      const module = await Test.createTestingModule({
        providers: [
          AcmeIssuerStrategy,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => configMap[key]),
            },
          },
        ],
      }).compile();

      const s = module.get<AcmeIssuerStrategy>(AcmeIssuerStrategy);
      // Should not throw — normalization handles escaped newlines
      await s.revoke(FAKE_CERT_PEM);
    });

    it('handles PEM wrapped in single quotes', async () => {
      configMap.KK_ACME_ACCOUNT_KEY = `'${FAKE_ACCOUNT_KEY}'`;
      mockClient.revokeCertificate.mockResolvedValue(undefined);

      const module = await Test.createTestingModule({
        providers: [
          AcmeIssuerStrategy,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => configMap[key]),
            },
          },
        ],
      }).compile();

      const s = module.get<AcmeIssuerStrategy>(AcmeIssuerStrategy);
      await s.revoke(FAKE_CERT_PEM);
    });

    it('handles PEM wrapped in double quotes', async () => {
      configMap.KK_ACME_ACCOUNT_KEY = `"${FAKE_ACCOUNT_KEY}"`;
      mockClient.revokeCertificate.mockResolvedValue(undefined);

      const module = await Test.createTestingModule({
        providers: [
          AcmeIssuerStrategy,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => configMap[key]),
            },
          },
        ],
      }).compile();

      const s = module.get<AcmeIssuerStrategy>(AcmeIssuerStrategy);
      await s.revoke(FAKE_CERT_PEM);
    });

    it('throws for invalid PEM format', async () => {
      configMap.KK_ACME_ACCOUNT_KEY = 'not-a-pem-string';

      const module = await Test.createTestingModule({
        providers: [
          AcmeIssuerStrategy,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => configMap[key]),
            },
          },
        ],
      }).compile();

      const s = module.get<AcmeIssuerStrategy>(AcmeIssuerStrategy);
      await expect(s.revoke(FAKE_CERT_PEM)).rejects.toThrow('not valid PEM');
    });

    it('throws when OpenSSL cannot parse the normalized key', async () => {
      const { createPrivateKey } = jest.requireMock('crypto');
      createPrivateKey.mockImplementation(() => {
        throw new Error('unsupported key type');
      });

      const module = await Test.createTestingModule({
        providers: [
          AcmeIssuerStrategy,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => configMap[key]),
            },
          },
        ],
      }).compile();

      const s = module.get<AcmeIssuerStrategy>(AcmeIssuerStrategy);
      await expect(s.revoke(FAKE_CERT_PEM)).rejects.toThrow(
        'failed OpenSSL parsing',
      );

      // Restore for other tests
      createPrivateKey.mockReturnValue({});
    });
  });
});
