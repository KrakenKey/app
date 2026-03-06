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
        issuer: 'C=US\nO=Let\'s Encrypt\nCN=R3',
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
