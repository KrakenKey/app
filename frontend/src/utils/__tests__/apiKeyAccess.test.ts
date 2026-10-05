import { isValidIpOrCidr, matchPreset, parseIpList } from '../apiKeyAccess';

describe('matchPreset', () => {
  it('treats null scopes as full access', () => {
    expect(matchPreset(null)).toBe('full');
    expect(matchPreset(undefined)).toBe('full');
  });

  it('matches presets regardless of order', () => {
    expect(matchPreset(['account:read', 'certs:renew', 'certs:read'])).toBe(
      'cert-renewal',
    );
    expect(matchPreset(['probes:report'])).toBe('probe');
  });

  it('returns null for other sets', () => {
    expect(matchPreset(['certs:read'])).toBeNull();
    expect(matchPreset(['probes:report', 'certs:read'])).toBeNull();
    expect(matchPreset([])).toBeNull();
  });
});

describe('isValidIpOrCidr', () => {
  it.each([
    '203.0.113.7',
    '0.0.0.0/0',
    '10.0.0.0/8',
    '::1',
    '::',
    '2001:db8::/32',
    '2001:0db8:0000:0000:0000:ff00:0042:8329',
    'fe80::1/128',
    '::ffff:192.0.2.1',
  ])('accepts %s', (value) => {
    expect(isValidIpOrCidr(value)).toBe(true);
  });

  it.each([
    '',
    '10.0.0.300',
    '10.0.0',
    '010.0.0.1',
    '10.0.0.1/33',
    '10.0.0.1/',
    '10.0.0.1/8/8',
    '2001:db8::/129',
    '2001:db8:::1',
    '1::2::3',
    '1:2:3:4:5:6:7:8:9',
    'example.com',
    '12345::',
  ])('rejects %s', (value) => {
    expect(isValidIpOrCidr(value)).toBe(false);
  });
});

describe('parseIpList', () => {
  it('splits on newlines and commas and drops blanks and repeats', () => {
    expect(parseIpList(' 10.0.0.1,\n\n10.0.0.0/8 , 10.0.0.1\n')).toEqual({
      entries: ['10.0.0.1', '10.0.0.0/8'],
      invalid: [],
    });
  });

  it('reports invalid entries', () => {
    expect(parseIpList('10.0.0.1\nnope').invalid).toEqual(['nope']);
  });
});
