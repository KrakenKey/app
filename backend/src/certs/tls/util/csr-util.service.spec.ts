import * as x509 from '@peculiar/x509';
import { CsrUtilService } from './csr-util.service';

jest.mock('@peculiar/x509', () => {
  const actual = jest.requireActual('@peculiar/x509');
  return {
    ...actual,
    Pkcs10CertificateRequest: jest.fn(),
    SubjectAlternativeNameExtension: jest.fn(),
  };
});

const MockedPkcs10 = x509.Pkcs10CertificateRequest as jest.MockedClass<
  typeof x509.Pkcs10CertificateRequest
>;
const MockedSanExt = x509.SubjectAlternativeNameExtension as jest.MockedClass<
  typeof x509.SubjectAlternativeNameExtension
>;

function makeCsr(options: {
  verify?: boolean;
  cn?: string | null;
  sans?: string[];
  keyAlgorithm?: Record<string, unknown>;
}) {
  const {
    verify = true,
    cn = 'example.com',
    sans = [],
    keyAlgorithm = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048 },
  } = options;

  const sanItems = sans.map((s) => ({ type: 'dns' as const, value: s }));

  const mockCsr = {
    verify: jest.fn().mockResolvedValue(verify),
    publicKey: { algorithm: keyAlgorithm },
    subjectName: {
      getField: (field: string) => {
        if (field === 'CN' && cn !== null) return [cn];
        return [];
      },
    },
    attributes: [],
    getExtension: (oid: string) => {
      if (oid === '2.5.29.17' && sanItems.length > 0) {
        return { rawData: new ArrayBuffer(0) };
      }
      return null;
    },
  };

  // Mock SubjectAlternativeNameExtension constructor to return parsed SAN data
  MockedSanExt.mockImplementation(
    () =>
      ({
        names: { items: sanItems },
      }) as unknown as x509.SubjectAlternativeNameExtension,
  );

  return mockCsr;
}

// Valid PEM format for tests (normalizePem requires proper headers/footers)
const VALID_PEM =
  '-----BEGIN CERTIFICATE REQUEST-----\nMIIBkTCB+wIBADBQMQswCQYDVQQG\n-----END CERTIFICATE REQUEST-----';

describe('CsrUtilService', () => {
  let svc: CsrUtilService;

  beforeEach(() => {
    jest.resetAllMocks();
    svc = new CsrUtilService();
    // Mock normalizePem to pass through - tests focus on validation logic, not PEM formatting
    jest.spyOn(svc, 'normalizePem').mockReturnValue(VALID_PEM);
  });

  it('parses a valid CSR with CN and SANs and returns expected info', async () => {
    const csr = makeCsr({
      cn: 'example.com',
      sans: ['www.example.com'],
      keyAlgorithm: { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048 },
    });
    MockedPkcs10.mockImplementation(() => csr as any);

    const result = await svc.validateAndParse(VALID_PEM);

    expect(result.raw).toBe(VALID_PEM);
    expect(result.domains.sort()).toEqual(
      ['example.com', 'www.example.com'].sort(),
    );
    expect(result.publicKeyLength).toBe(2048);
  });

  it('throws when CSR signature verification fails', async () => {
    const csr = makeCsr({
      verify: false,
      cn: 'example.com',
      sans: ['www.example.com'],
    });
    MockedPkcs10.mockImplementation(() => csr as any);
    await expect(svc.validateAndParse(VALID_PEM)).rejects.toThrow(
      /CSR signature verification failed/,
    );
  });

  it('throws when RSA key is too weak', async () => {
    const csr = makeCsr({
      cn: 'example.com',
      sans: ['www.example.com'],
      keyAlgorithm: { name: 'RSASSA-PKCS1-v1_5', modulusLength: 1024 },
    });
    MockedPkcs10.mockImplementation(() => csr as any);
    await expect(svc.validateAndParse(VALID_PEM)).rejects.toThrow(
      /RSA key must be at least 2048 bits/,
    );
  });

  it('throws for invalid PEM parsing errors from @peculiar/x509', async () => {
    MockedPkcs10.mockImplementation(() => {
      throw new Error('Cannot decode the raw data');
    });
    await expect(svc.validateAndParse(VALID_PEM)).rejects.toThrow(
      /Cannot decode the raw data/,
    );
  });

  it('throws for PEM without proper headers (normalizePem check)', () => {
    // Restore real normalizePem for this test
    jest.spyOn(svc, 'normalizePem').mockRestore();
    expect(() => svc.normalizePem('not a pem')).toThrow(
      /PEM header and footer/,
    );
  });

  it('handles missing CN gracefully when SANs present', async () => {
    const csr = makeCsr({
      cn: null,
      sans: ['only.example.com'],
      keyAlgorithm: { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048 },
    });
    MockedPkcs10.mockImplementation(() => csr as any);
    const res = await svc.validateAndParse(VALID_PEM);
    expect(res.domains).toEqual(['only.example.com']);
  });

  describe('ECDSA Key Support', () => {
    it('accepts ECDSA P-256 keys', async () => {
      const csr = makeCsr({
        cn: 'example.com',
        sans: ['www.example.com'],
        keyAlgorithm: { name: 'ECDSA', namedCurve: 'P-256' },
      });
      MockedPkcs10.mockImplementation(() => csr as any);

      const result = await svc.validateAndParse(VALID_PEM);

      expect(result.publicKeyLength).toBe(256);
      expect(result.domains).toContain('example.com');
    });

    it('accepts ECDSA P-384 keys', async () => {
      const csr = makeCsr({
        cn: 'example.com',
        sans: ['www.example.com'],
        keyAlgorithm: { name: 'ECDSA', namedCurve: 'P-384' },
      });
      MockedPkcs10.mockImplementation(() => csr as any);

      const result = await svc.validateAndParse(VALID_PEM);

      expect(result.publicKeyLength).toBe(384);
      expect(result.domains).toContain('example.com');
    });

    it('rejects ECDSA P-521 keys', async () => {
      const csr = makeCsr({
        cn: 'example.com',
        sans: ['www.example.com'],
        keyAlgorithm: { name: 'ECDSA', namedCurve: 'P-521' },
      });
      MockedPkcs10.mockImplementation(() => csr as any);

      await expect(svc.validateAndParse(VALID_PEM)).rejects.toThrow(
        /Unsupported ECDSA curve/,
      );
    });

    it('rejects unsupported ECDSA curves', async () => {
      const csr = makeCsr({
        cn: 'example.com',
        sans: ['www.example.com'],
        keyAlgorithm: { name: 'ECDSA', namedCurve: 'P-192' },
      });
      MockedPkcs10.mockImplementation(() => csr as any);

      await expect(svc.validateAndParse(VALID_PEM)).rejects.toThrow(
        /Unsupported ECDSA curve/,
      );
    });
  });

  describe('isAuthorized', () => {
    it('allows exact domain match', () => {
      expect(() =>
        svc.isAuthorized(['example.com'], ['example.com']),
      ).not.toThrow();
    });

    it('allows subdomains of a verified parent domain', () => {
      expect(() =>
        svc.isAuthorized(['sub.example.com'], ['example.com']),
      ).not.toThrow();
    });

    it('allows multi-level subdomains of a verified parent domain', () => {
      expect(() =>
        svc.isAuthorized(['a.b.c.example.com'], ['example.com']),
      ).not.toThrow();
    });

    it('allows wildcard domains when parent is verified', () => {
      expect(() =>
        svc.isAuthorized(['*.example.com'], ['example.com']),
      ).not.toThrow();
    });

    it('allows wildcard subdomains when parent is verified', () => {
      expect(() =>
        svc.isAuthorized(['*.sub.example.com'], ['example.com']),
      ).not.toThrow();
    });

    it('is case-insensitive', () => {
      expect(() =>
        svc.isAuthorized(['Sub.Example.COM'], ['example.com']),
      ).not.toThrow();
    });

    it('rejects domains that are not subdomains of any verified domain', () => {
      expect(() => svc.isAuthorized(['evil.com'], ['example.com'])).toThrow(
        /unauthorized domains.*evil\.com/,
      );
    });

    it('rejects domains that share a suffix but are not true subdomains', () => {
      // "notexample.com" ends with "example.com" but is not a subdomain
      expect(() =>
        svc.isAuthorized(['notexample.com'], ['example.com']),
      ).toThrow(/unauthorized domains.*notexample\.com/);
    });

    it('allows a mix of exact and subdomain matches', () => {
      expect(() =>
        svc.isAuthorized(
          ['example.com', 'www.example.com', 'api.example.com'],
          ['example.com'],
        ),
      ).not.toThrow();
    });

    it('reports all unauthorized domains in the error', () => {
      expect(() =>
        svc.isAuthorized(['a.evil.com', 'b.evil.com'], ['example.com']),
      ).toThrow(/a\.evil\.com.*b\.evil\.com/);
    });
  });

  describe('Unsupported Key Types', () => {
    it('rejects keys that are neither RSA nor ECDSA', async () => {
      const csr = makeCsr({
        cn: 'example.com',
        keyAlgorithm: { name: 'DSA' },
      });
      MockedPkcs10.mockImplementation(() => csr as any);

      await expect(svc.validateAndParse(VALID_PEM)).rejects.toThrow(
        /Unsupported key type/,
      );
    });
  });
});
