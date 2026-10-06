import { hostnameProblem, parseHostEntry, parseHostList } from './report-hosts';

describe('parseHostEntry', () => {
  it('defaults to port 443 and lowercases', () => {
    expect(parseHostEntry('  Example.COM ')).toEqual({
      host: 'example.com',
      port: 443,
    });
  });

  it('reads an explicit port', () => {
    expect(parseHostEntry('api.example.com:8443')).toEqual({
      host: 'api.example.com',
      port: 8443,
    });
  });

  it('accepts a pasted URL', () => {
    expect(parseHostEntry('https://www.example.com:444/login?x=1')).toEqual({
      host: 'www.example.com',
      port: 444,
    });
  });

  it('drops a trailing dot', () => {
    expect(parseHostEntry('example.com.')).toEqual({
      host: 'example.com',
      port: 443,
    });
  });

  it.each([
    ['example.com:0', 'port must be between 1 and 65535'],
    ['example.com:70000', 'port must be between 1 and 65535'],
    ['example.com:https', 'invalid port'],
    ['user@example.com', 'credentials are not allowed'],
  ])('refuses %s', (input, reason) => {
    expect(parseHostEntry(input)).toBe(reason);
  });

  describe('SSRF', () => {
    it.each([
      ['10.0.0.1', 'private IP addresses are not allowed'],
      ['127.0.0.1:443', 'private IP addresses are not allowed'],
      ['169.254.169.254', 'private IP addresses are not allowed'],
      ['[::1]:8443', 'private IP addresses are not allowed'],
      ['fd00::1', 'private IP addresses are not allowed'],
      ['8.8.8.8', 'IP addresses are not allowed, use a hostname'],
      [
        '[2606:4700:4700::1111]',
        'IP addresses are not allowed, use a hostname',
      ],
      ['localhost', 'not a fully qualified domain name'],
      ['db.internal', 'internal names are not allowed'],
      ['printer.local', 'internal names are not allowed'],
      ['router.home.arpa', 'internal names are not allowed'],
    ])('refuses %s', (input, reason) => {
      expect(parseHostEntry(input)).toBe(reason);
    });
  });

  it.each([
    ['*.example.com', 'wildcards are not allowed'],
    ['-bad.example.com', 'not a valid hostname'],
    ['exa mple.com', 'not a valid hostname'],
    ['example.123', 'not a valid hostname'],
    [`${'a'.repeat(64)}.com`, 'not a valid hostname'],
  ])('refuses invalid name %s', (input, reason) => {
    expect(parseHostEntry(input)).toBe(reason);
  });

  it('refuses names over 253 characters', () => {
    const long = `${Array(50).fill('abcdef').join('.')}.com`;
    expect(hostnameProblem(long)).toBe(
      'hostname is longer than 253 characters',
    );
  });
});

describe('parseHostList', () => {
  it('skips blank lines and dedupes on host and port', () => {
    const { targets, errors } = parseHostList([
      'example.com',
      '',
      'EXAMPLE.com',
      'https://example.com/',
      'example.com:8443',
      '   ',
      'api.example.com',
    ]);
    expect(errors).toEqual([]);
    expect(targets).toEqual([
      { host: 'example.com', port: 443 },
      { host: 'example.com', port: 8443 },
      { host: 'api.example.com', port: 443 },
    ]);
  });

  it('collects every invalid line', () => {
    const { targets, errors } = parseHostList([
      'ok.example.com',
      '10.1.1.1',
      'nope',
    ]);
    expect(targets).toHaveLength(1);
    expect(errors).toEqual([
      '"10.1.1.1": private IP addresses are not allowed',
      '"nope": not a fully qualified domain name',
    ]);
  });
});
