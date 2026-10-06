import { classifyScan, pendingResult } from './report-classifier';
import { csvCell, csvFilename, reportToCsv } from './report-csv';

describe('report CSV', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe('');
  });

  it('defuses spreadsheet formulas but keeps negative numbers', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell(-3)).toBe('-3');
  });

  it('writes a header and one row per host', () => {
    const now = new Date('2026-10-05T00:00:00Z');
    const host = classifyScan(
      'shop.example.com',
      443,
      {
        endpoint: {
          host: 'shop.example.com',
          port: 443,
          sni: 'shop.example.com',
        },
        connection: { success: true, tlsVersion: 'TLS 1.2' },
        certificate: {
          sans: ['example.com'],
          issuer: "CN=R11,O=Let's Encrypt,C=US",
          notAfter: '2026-10-10T00:00:00Z',
          keyType: 'RSA',
          keySize: 2048,
          trusted: true,
          chainDepth: 2,
        },
        scannedAt: now.toISOString(),
      },
      now,
    );
    const csv = reportToCsv([host, pendingResult('later.example.com', 8443)]);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'host,port,severity,status,reachable,days_left,not_after,issuer,lets_encrypt,tls_version,key,hostname_covered,trusted,problems',
    );
    expect(lines[1]).toBe(
      "shop.example.com,443,critical,complete,yes,5,2026-10-10T00:00:00Z,Let's Encrypt,yes,TLS 1.2,RSA 2048,no,yes,Certificate does not cover shop.example.com; Expires in 5 days",
    );
    expect(lines[2]).toBe('later.example.com,8443,pending,pending,,,,,,,,,,');
  });

  it('builds a safe filename', () => {
    const at = new Date('2026-10-05T10:00:00Z');
    expect(csvFilename('Client "sites" / Q4', at)).toBe(
      'client-sites-q4-2026-10-05.csv',
    );
    expect(csvFilename(null, at)).toBe('tls-report-2026-10-05.csv');
    expect(csvFilename('***', at)).toBe('tls-report-2026-10-05.csv');
  });
});
