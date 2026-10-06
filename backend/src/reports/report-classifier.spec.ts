import type { PublicScanResponse, ReportHostResult } from '@krakenkey/shared';
import {
  classifyFailure,
  classifyScan,
  compareHosts,
  dnAttribute,
  hostnameCovered,
  issuerName,
  nameMatches,
  pendingResult,
  sortHosts,
  summarize,
} from './report-classifier';

const NOW = new Date('2026-10-05T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const LE = "CN=R11,O=Let's Encrypt,C=US";

function inDays(days: number): string {
  return new Date(NOW.getTime() + days * DAY + 60_000).toISOString();
}

function scan(
  cert: Partial<NonNullable<PublicScanResponse['certificate']>> | null = {},
  connection: Partial<PublicScanResponse['connection']> = {},
): PublicScanResponse {
  return {
    endpoint: { host: 'example.com', port: 443, sni: 'example.com' },
    connection: { success: true, tlsVersion: 'TLS 1.3', ...connection },
    certificate:
      cert === null
        ? undefined
        : {
            subject: 'CN=example.com',
            sans: ['example.com', 'www.example.com'],
            issuer: LE,
            notAfter: inDays(60),
            keyType: 'ECDSA',
            keySize: 256,
            chainDepth: 2,
            chainComplete: false,
            trusted: true,
            ...cert,
          },
    scannedAt: NOW.toISOString(),
  };
}

const codes = (r: ReportHostResult) => r.problems.map((p) => p.code);

describe('nameMatches (SAN coverage)', () => {
  it.each([
    ['example.com', 'example.com', true],
    ['EXAMPLE.com', 'example.COM.', true],
    ['*.example.com', 'www.example.com', true],
    ['*.example.com', 'example.com', false],
    ['*.example.com', 'a.b.example.com', false],
    ['*.com', 'example.com', false],
    ['w*.example.com', 'www.example.com', false],
    ['*.*.example.com', 'a.b.example.com', false],
    ['www.example.com', 'example.com', false],
  ])('%s vs %s -> %s', (pattern, host, expected) => {
    expect(nameMatches(pattern, host)).toBe(expected);
  });

  it('checks every SAN', () => {
    expect(
      hostnameCovered(['a.example.com', '*.example.org'], 'x.example.org'),
    ).toBe(true);
    expect(hostnameCovered([], 'example.com')).toBe(false);
  });
});

describe('issuer parsing', () => {
  it('reads DN attributes', () => {
    expect(dnAttribute(LE, 'CN')).toBe('R11');
    expect(issuerName(LE)).toBe("Let's Encrypt");
    expect(issuerName('CN=Self Signed')).toBe('Self Signed');
    expect(issuerName('CN=x,O=Acme\\, Inc.,C=US')).toBe('Acme, Inc.');
    expect(issuerName(null)).toBeNull();
  });
});

describe('classifyScan', () => {
  it("rates a healthy Let's Encrypt host ok", () => {
    const r = classifyScan('example.com', 443, scan(), NOW);
    expect(r.severity).toBe('ok');
    expect(r.problems).toEqual([]);
    expect(r.daysLeft).toBe(60);
    expect(r.letsEncrypt).toBe(true);
    expect(r.issuerName).toBe("Let's Encrypt");
    expect(r.hostnameCovered).toBe(true);
    expect(r.status).toBe('complete');
  });

  it('unreachable host is critical', () => {
    const r = classifyScan(
      'down.example.com',
      443,
      scan(null, { success: false, error: 'connection refused' }),
      NOW,
    );
    expect(r.severity).toBe('critical');
    expect(codes(r)).toEqual(['unreachable']);
    expect(r.reachable).toBe(false);
    expect(r.problems[0].message).toContain('connection refused');
  });

  it('missing certificate is critical', () => {
    const r = classifyScan('example.com', 443, scan(null), NOW);
    expect(codes(r)).toEqual(['no_certificate']);
    expect(r.severity).toBe('critical');
  });

  it('expired certificate is critical and not also flagged untrusted', () => {
    const r = classifyScan(
      'example.com',
      443,
      scan({ notAfter: inDays(-3), trusted: false }),
      NOW,
    );
    expect(r.severity).toBe('critical');
    expect(codes(r)).toEqual(['expired']);
    expect(r.daysLeft).toBeLessThan(0);
  });

  it('hostname not covered is critical', () => {
    const r = classifyScan('shop.example.com', 443, scan(), NOW);
    expect(codes(r)).toEqual(['hostname_mismatch']);
    expect(r.hostnameCovered).toBe(false);
  });

  it('wildcard covers one level only', () => {
    const sans = ['*.example.com'];
    expect(
      classifyScan('a.example.com', 443, scan({ sans }), NOW).severity,
    ).toBe('ok');
    expect(
      codes(classifyScan('a.b.example.com', 443, scan({ sans }), NOW)),
    ).toEqual(['hostname_mismatch']);
  });

  it('leaf sent without intermediates is an incomplete chain', () => {
    const r = classifyScan(
      'example.com',
      443,
      scan({ trusted: false, chainDepth: 1 }),
      NOW,
    );
    expect(codes(r)).toEqual(['incomplete_chain']);
    expect(r.severity).toBe('critical');
  });

  it('untrusted chain (self-signed) is critical', () => {
    const r = classifyScan(
      'example.com',
      443,
      scan({
        trusted: false,
        chainDepth: 1,
        subject: 'CN=example.com',
        issuer: 'CN=example.com',
      }),
      NOW,
    );
    expect(codes(r)).toEqual(['untrusted_chain']);
    expect(r.problems[0].message).toMatch(/self-signed/i);
  });

  it('ignores the probe chainComplete flag when the chain is trusted', () => {
    const r = classifyScan(
      'example.com',
      443,
      scan({ chainComplete: false, trusted: true }),
      NOW,
    );
    expect(r.severity).toBe('ok');
  });

  it.each([
    [0, 'warning', 'expires_soon'],
    [14, 'warning', 'expires_soon'],
    [15, 'notice', 'expires_within_30_days'],
    [30, 'notice', 'expires_within_30_days'],
    [31, 'ok', undefined],
  ])('%i days left -> %s', (days, severity, code) => {
    const r = classifyScan(
      'example.com',
      443,
      scan({ notAfter: inDays(days) }),
      NOW,
    );
    expect(r.daysLeft).toBe(days);
    expect(r.severity).toBe(severity);
    expect(r.problems[0]?.code).toBe(code);
  });

  it.each(['TLS 1.0', 'TLS 1.1'])('%s is a warning', (tlsVersion) => {
    const r = classifyScan('example.com', 443, scan({}, { tlsVersion }), NOW);
    expect(codes(r)).toEqual(['old_tls']);
    expect(r.severity).toBe('warning');
  });

  it.each([
    ['RSA', 1024, 'warning'],
    ['RSA', 2048, 'ok'],
    ['ECDSA', 224, 'warning'],
    ['ECDSA', 384, 'ok'],
    ['Ed25519', 256, 'ok'],
  ])('%s %i-bit key -> %s', (keyType, keySize, severity) => {
    const r = classifyScan('example.com', 443, scan({ keyType, keySize }), NOW);
    expect(r.severity).toBe(severity);
  });

  it('takes the worst severity of several problems', () => {
    const r = classifyScan(
      'shop.example.com',
      443,
      scan({ notAfter: inDays(5), keyType: 'RSA', keySize: 1024 }),
      NOW,
    );
    expect(r.severity).toBe('critical');
    expect(codes(r)).toEqual(['hostname_mismatch', 'expires_soon', 'weak_key']);
  });

  it("marks non-Let's Encrypt issuers", () => {
    const r = classifyScan(
      'example.com',
      443,
      scan({ issuer: 'CN=Sectigo RSA DV,O=Sectigo Limited,C=GB' }),
      NOW,
    );
    expect(r.letsEncrypt).toBe(false);
    expect(r.issuerName).toBe('Sectigo Limited');
  });
});

describe('classifyFailure', () => {
  it('is critical with the reason', () => {
    const r = classifyFailure('x.example.com', 443, 'Scanner down', NOW);
    expect(r).toMatchObject({
      status: 'error',
      severity: 'critical',
      reachable: false,
      error: 'Scanner down',
    });
    expect(codes(r)).toEqual(['scan_failed']);
  });

  it('marks DNS failures as unreachable but complete', () => {
    const r = classifyFailure('x.example.com', 443, 'nx', NOW, 'unreachable');
    expect(r.status).toBe('complete');
    expect(codes(r)).toEqual(['unreachable']);
  });
});

describe('sorting and summary', () => {
  const ok = classifyScan(
    'ok.example.com',
    443,
    scan({ sans: ['ok.example.com'] }),
    NOW,
  );
  const notice = classifyScan(
    'n.example.com',
    443,
    scan({ sans: ['n.example.com'], notAfter: inDays(20) }),
    NOW,
  );
  const warnLater = classifyScan(
    'w2.example.com',
    443,
    scan({ sans: ['w2.example.com'], notAfter: inDays(10) }),
    NOW,
  );
  const warnSooner = classifyScan(
    'w1.example.com',
    443,
    scan({ sans: ['w1.example.com'], notAfter: inDays(2) }),
    NOW,
  );
  const down = classifyScan(
    'down.example.com',
    443,
    scan(null, { success: false }),
    NOW,
  );
  const expired = classifyScan(
    'old.example.com',
    443,
    scan({
      sans: ['old.example.com'],
      notAfter: inDays(-1),
      issuer: 'CN=X,O=DigiCert Inc,C=US',
    }),
    NOW,
  );
  const pending = pendingResult('later.example.com', 443);

  it('sorts by severity, then days left, unknown days and pending last', () => {
    const sorted = sortHosts([
      ok,
      pending,
      notice,
      warnLater,
      down,
      warnSooner,
      expired,
    ]);
    expect(sorted.map((h) => h.host)).toEqual([
      'old.example.com', // critical, -1 days
      'down.example.com', // critical, unknown days
      'w1.example.com',
      'w2.example.com',
      'n.example.com',
      'ok.example.com',
      'later.example.com',
    ]);
  });

  it('breaks ties on hostname then port', () => {
    const a = { ...ok, host: 'a.example.com' };
    const b = { ...ok, host: 'b.example.com' };
    const b2 = { ...b, port: 8443 };
    expect(compareHosts(a, b)).toBeLessThan(0);
    expect(compareHosts(b2, b)).toBeGreaterThan(0);
  });

  it('summarizes counts, issuers and earliest expiry', () => {
    const summary = summarize([
      ok,
      notice,
      warnLater,
      warnSooner,
      down,
      expired,
      pending,
    ]);
    expect(summary.totalHosts).toBe(7);
    expect(summary.scannedHosts).toBe(6);
    expect(summary.counts).toEqual({
      critical: 2,
      warning: 2,
      notice: 1,
      ok: 1,
    });
    expect(summary.issuers).toEqual([
      { issuer: "Let's Encrypt", count: 4 },
      { issuer: 'DigiCert Inc', count: 1 },
    ]);
    expect(summary.letsEncryptHosts).toBe(4);
    expect(summary.earliestExpiry).toMatchObject({
      host: 'old.example.com',
      daysLeft: -1,
    });
  });

  it('handles an empty report', () => {
    expect(summarize([])).toEqual({
      totalHosts: 0,
      scannedHosts: 0,
      counts: { critical: 0, warning: 0, notice: 0, ok: 0 },
      issuers: [],
      letsEncryptHosts: 0,
      earliestExpiry: null,
    });
  });
});
