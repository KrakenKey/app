import { promises as dns } from 'dns';
import {
  isIpLiteral,
  isPrivateIP,
  isPrivateIPv4,
  isPrivateIPv6,
  resolveToPublicIPs,
  SsrfError,
} from './ssrf';

describe('ssrf', () => {
  afterEach(() => jest.restoreAllMocks());

  it('treats a public IPv6 address as public', () => {
    expect(isPrivateIPv6('2606:4700:4700::1111')).toBe(false);
  });

  it('recognises IP literals, bracketed or not', () => {
    expect(isIpLiteral('1.2.3.4')).toBe(true);
    expect(isIpLiteral('[::1]')).toBe(true);
    expect(isIpLiteral('example.com')).toBe(false);
  });

  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1',
    '198.18.0.1',
    '255.255.255.255',
  ])('treats %s as private', (ip) => {
    expect(isPrivateIPv4(ip)).toBe(true);
    expect(isPrivateIP(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34'])(
    'treats %s as public',
    (ip) => {
      expect(isPrivateIP(ip)).toBe(false);
    },
  );

  it.each([
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:7f00:1', // 127.0.0.1 in hex form
    '::ffff:a9fe:a9fe', // 169.254.169.254
    '[::1]',
  ])('treats IPv6 %s as private', (ip) => {
    expect(isPrivateIPv6(ip)).toBe(true);
    expect(isPrivateIP(ip)).toBe(true);
  });

  it.each(['2606:4700:4700::1111', '::ffff:8.8.8.8', '::ffff:808:808'])(
    'treats IPv6 %s as public',
    (ip) => {
      expect(isPrivateIP(ip)).toBe(false);
    },
  );

  it('treats a non-IP string as private (fail closed)', () => {
    expect(isPrivateIP('example.com')).toBe(true);
  });

  describe('resolveToPublicIPs', () => {
    it('returns public addresses', async () => {
      jest.spyOn(dns, 'resolve4').mockResolvedValue(['93.184.216.34']);
      jest.spyOn(dns, 'resolve6').mockRejectedValue(new Error('ENODATA'));
      await expect(resolveToPublicIPs('example.com')).resolves.toEqual([
        '93.184.216.34',
      ]);
    });

    it('rejects when any address is private', async () => {
      jest
        .spyOn(dns, 'resolve4')
        .mockResolvedValue(['93.184.216.34', '10.0.0.5']);
      jest.spyOn(dns, 'resolve6').mockResolvedValue([]);
      await expect(resolveToPublicIPs('mixed.example')).rejects.toMatchObject({
        reason: 'private',
      });
    });

    it('rejects a private AAAA record', async () => {
      jest.spyOn(dns, 'resolve4').mockResolvedValue([]);
      jest.spyOn(dns, 'resolve6').mockResolvedValue(['::ffff:127.0.0.1']);
      await expect(resolveToPublicIPs('v6.example')).rejects.toBeInstanceOf(
        SsrfError,
      );
    });

    it('rejects names that do not resolve', async () => {
      jest.spyOn(dns, 'resolve4').mockRejectedValue(new Error('ENOTFOUND'));
      jest.spyOn(dns, 'resolve6').mockRejectedValue(new Error('ENOTFOUND'));
      await expect(resolveToPublicIPs('nope.invalid')).rejects.toMatchObject({
        reason: 'unresolvable',
      });
    });
  });
});
