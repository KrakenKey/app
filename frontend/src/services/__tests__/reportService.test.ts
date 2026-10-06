import { countDistinctHosts, csvFilename, hostLines } from '../reportService';

describe('reportService helpers', () => {
  it('splits the textarea into trimmed non-empty lines', () => {
    expect(hostLines(' a.com \n\n b.com,c.com\r\n')).toEqual([
      'a.com',
      'b.com',
      'c.com',
    ]);
  });

  it('counts host and port pairs once', () => {
    expect(
      countDistinctHosts([
        'a.com',
        'A.com',
        'https://a.com/',
        'a.com:443',
        'a.com:8443',
        'b.com.',
      ]),
    ).toBe(3);
  });

  it('builds a CSV filename from the report name', () => {
    expect(csvFilename('Client sites!', '2026-10-05T10:00:00Z')).toBe(
      'client-sites-2026-10-05.csv',
    );
    expect(csvFilename(null, '2026-10-05T10:00:00Z')).toBe(
      'tls-report-2026-10-05.csv',
    );
  });
});
