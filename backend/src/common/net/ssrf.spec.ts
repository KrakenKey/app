import { BadRequestException } from '@nestjs/common';
import { promises as dns } from 'dns';
import {
  isIpLiteral,
  isPrivateAddress,
  isPrivateIPv4,
  isPrivateIPv6,
  resolveToPublicIPs,
} from './ssrf';

describe('ssrf helpers', () => {
  it.each([
    '10.1.2.3',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1',
    '198.18.0.1',
    '0.0.0.0',
    '255.255.255.255',
  ])('treats %s as private', (ip) => {
    expect(isPrivateIPv4(ip)).toBe(true);
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34'])(
    'treats %s as public',
    (ip) => {
      expect(isPrivateIPv4(ip)).toBe(false);
    },
  );

  it.each(['::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '2001:db8::1'])(
    'treats IPv6 %s as private',
    (ip) => {
      expect(isPrivateIPv6(ip)).toBe(true);
    },
  );

  it('treats a public IPv6 address as public', () => {
    expect(isPrivateIPv6('2606:4700:4700::1111')).toBe(false);
  });

  it('recognises IP literals, bracketed or not', () => {
    expect(isIpLiteral('1.2.3.4')).toBe(true);
    expect(isIpLiteral('[::1]')).toBe(true);
    expect(isIpLiteral('example.com')).toBe(false);
  });

  describe('resolveToPublicIPs', () => {
    afterEach(() => jest.restoreAllMocks());

    it('returns public addresses', async () => {
      jest.spyOn(dns, 'resolve4').mockResolvedValue(['93.184.216.34']);
      jest.spyOn(dns, 'resolve6').mockResolvedValue([]);
      await expect(resolveToPublicIPs('example.com')).resolves.toEqual([
        '93.184.216.34',
      ]);
    });

    it('refuses a name with any private address', async () => {
      jest
        .spyOn(dns, 'resolve4')
        .mockResolvedValue(['93.184.216.34', '10.0.0.5']);
      jest.spyOn(dns, 'resolve6').mockResolvedValue([]);
      await expect(resolveToPublicIPs('mixed.example.com')).rejects.toThrow(
        'Cannot scan private/internal addresses',
      );
    });

    it('refuses a name that does not resolve', async () => {
      jest.spyOn(dns, 'resolve4').mockRejectedValue(new Error('ENOTFOUND'));
      jest.spyOn(dns, 'resolve6').mockRejectedValue(new Error('ENOTFOUND'));
      await expect(resolveToPublicIPs('nx.example.com')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
