import { Test, TestingModule } from '@nestjs/testing';
import { CertUtilService } from './cert-util.service';

// Mock the crypto module's X509Certificate
const mockValidTo = '2026-06-15T00:00:00.000Z';
jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return {
    ...actual,
    X509Certificate: jest.fn().mockImplementation((pem: string) => {
      if (!pem || pem === 'invalid-pem') {
        throw new Error('unable to read certificate');
      }
      return {
        validTo: mockValidTo,
        validFrom: '2025-06-15T00:00:00.000Z',
        serialNumber: '03A1B2C3D4E5F6',
        issuer: "C=US\nO=Let's Encrypt\nCN=R3",
        subject: 'CN=example.com',
        fingerprint256: 'AB:CD:EF:01:23:45:67:89',
        publicKey: {
          asymmetricKeyType: 'rsa',
          asymmetricKeyDetails: { modulusLength: 2048 },
        },
      };
    }),
  };
});

describe('CertUtilService', () => {
  let service: CertUtilService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CertUtilService],
    }).compile();

    service = module.get<CertUtilService>(CertUtilService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── getExpirationDate ────────────────────────────────────────────────────
  describe('getExpirationDate', () => {
    it('returns a Date parsed from the certificate validTo field', () => {
      const result = service.getExpirationDate(
        '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----',
      );
      expect(result).toEqual(new Date(mockValidTo));
    });

    it('throws Error for invalid PEM', () => {
      expect(() => service.getExpirationDate('invalid-pem')).toThrow(
        'Failed to parse certificate',
      );
    });

    it('throws Error for empty string', () => {
      expect(() => service.getExpirationDate('')).toThrow(
        'Failed to parse certificate',
      );
    });
  });

  // ─── getDetails ─────────────────────────────────────────────────────────
  describe('getDetails', () => {
    const validPem =
      '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----';

    it('returns structured TlsCertDetails for valid PEM', () => {
      const result = service.getDetails(validPem);

      expect(result).toEqual({
        serialNumber: '03A1B2C3D4E5F6',
        issuer: "C=US, O=Let's Encrypt, CN=R3",
        subject: 'CN=example.com',
        validFrom: new Date('2025-06-15T00:00:00.000Z').toISOString(),
        validTo: new Date(mockValidTo).toISOString(),
        keyType: 'RSA',
        keySize: 2048,
        fingerprint: 'AB:CD:EF:01:23:45:67:89',
      });
    });

    it('throws Error for invalid PEM', () => {
      expect(() => service.getDetails('invalid-pem')).toThrow(
        'Failed to parse certificate details',
      );
    });

    it('throws Error for empty string', () => {
      expect(() => service.getDetails('')).toThrow(
        'Failed to parse certificate details',
      );
    });
  });

  // ─── splitChain ──────────────────────────────────────────────────────────
  describe('splitChain', () => {
    const cert1 =
      '-----BEGIN CERTIFICATE-----\nleafdata\n-----END CERTIFICATE-----';
    const cert2 =
      '-----BEGIN CERTIFICATE-----\nintermediate1\n-----END CERTIFICATE-----';
    const cert3 =
      '-----BEGIN CERTIFICATE-----\nintermediate2\n-----END CERTIFICATE-----';

    it('returns leaf only when PEM contains a single cert', () => {
      const result = service.splitChain(cert1);
      expect(result.leaf).toBe(cert1);
      expect(result.intermediates).toBeNull();
    });

    it('splits two concatenated certs into leaf and intermediates', () => {
      const result = service.splitChain(`${cert1}\n${cert2}`);
      expect(result.leaf).toBe(cert1);
      expect(result.intermediates).toBe(cert2);
    });

    it('splits three concatenated certs into leaf and two intermediates', () => {
      const result = service.splitChain(`${cert1}\n${cert2}\n${cert3}`);
      expect(result.leaf).toBe(cert1);
      expect(result.intermediates).toBe(`${cert2}\n${cert3}`);
    });

    it('throws for empty string', () => {
      expect(() => service.splitChain('')).toThrow(
        'No certificates found in PEM data',
      );
    });

    it('throws when no valid PEM blocks found', () => {
      expect(() => service.splitChain('not a cert')).toThrow(
        'No certificates found in PEM data',
      );
    });
  });

  // ─── getChainInfo ───────────────────────────────────────────────────────
  describe('getChainInfo', () => {
    const leafPem =
      '-----BEGIN CERTIFICATE-----\nleaf\n-----END CERTIFICATE-----';
    const intPem1 =
      '-----BEGIN CERTIFICATE-----\nint1\n-----END CERTIFICATE-----';
    const intPem2 =
      '-----BEGIN CERTIFICATE-----\nint2\n-----END CERTIFICATE-----';

    it('returns leaf details and empty intermediates when chainPem is null', () => {
      const result = service.getChainInfo(leafPem, null);

      expect(result.leafCert).toEqual(
        expect.objectContaining({ serialNumber: '03A1B2C3D4E5F6' }),
      );
      expect(result.intermediates).toEqual([]);
      expect(result.fullChainPem).toBe(leafPem);
    });

    it('parses one intermediate cert', () => {
      const result = service.getChainInfo(leafPem, intPem1);

      expect(result.intermediates).toHaveLength(1);
      expect(result.intermediates[0]).toEqual(
        expect.objectContaining({ serialNumber: '03A1B2C3D4E5F6' }),
      );
      expect(result.fullChainPem).toBe(`${leafPem}\n${intPem1}`);
    });

    it('parses two intermediate certs', () => {
      const result = service.getChainInfo(leafPem, `${intPem1}\n${intPem2}`);

      expect(result.intermediates).toHaveLength(2);
      expect(result.fullChainPem).toBe(`${leafPem}\n${intPem1}\n${intPem2}`);
    });
  });

  // ─── isExpiringSoon ───────────────────────────────────────────────────────
  describe('isExpiringSoon', () => {
    it('returns true when cert expires within 30 days', () => {
      const soon = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000); // 15 days from now
      expect(service.isExpiringSoon(soon)).toBe(true);
    });

    it('returns false when cert expires in more than 30 days', () => {
      const far = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // 60 days from now
      expect(service.isExpiringSoon(far)).toBe(false);
    });

    it('returns false when cert is already expired', () => {
      const past = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1 day ago
      expect(service.isExpiringSoon(past)).toBe(false);
    });

    it('returns true at the exact boundary (30 days)', () => {
      const boundary = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      expect(service.isExpiringSoon(boundary)).toBe(true);
    });

    it('respects custom threshold parameter', () => {
      const date = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days from now
      expect(service.isExpiringSoon(date, 10)).toBe(true);
      expect(service.isExpiringSoon(date, 3)).toBe(false);
    });
  });

  // ─── isExpired ────────────────────────────────────────────────────────────
  describe('isExpired', () => {
    it('returns true for a past date', () => {
      const past = new Date(Date.now() - 1000);
      expect(service.isExpired(past)).toBe(true);
    });

    it('returns false for a future date', () => {
      const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
      expect(service.isExpired(future)).toBe(false);
    });
  });
});
