import type { ParsedCsr } from '@krakenkey/shared';
import {
  certDnsNames,
  hasResourceRestrictions,
  ipAllowed,
  nameCovered,
  parseIpEntry,
} from './api-key-restrictions';

describe('api-key-restrictions', () => {
  describe('parseIpEntry', () => {
    it.each([
      ['203.0.113.10', 'ipv4', 32],
      ['203.0.113.0/24', 'ipv4', 24],
      [' 10.0.0.0/8 ', 'ipv4', 8],
      ['2001:db8::1', 'ipv6', 128],
      ['2001:db8::/48', 'ipv6', 48],
    ])('accepts %s', (entry, family, prefix) => {
      expect(parseIpEntry(entry)).toMatchObject({ family, prefix });
    });

    it.each([
      'example.com',
      '203.0.113.300',
      '203.0.113.0/33',
      '2001:db8::/129',
      '10.0.0.0/8/8',
      '10.0.0.0/abc',
      '10.0.0.0/-1',
      '',
    ])('rejects %p', (entry) => {
      expect(parseIpEntry(entry)).toBeNull();
    });
  });

  describe('ipAllowed', () => {
    const list = ['203.0.113.10', '198.51.100.0/24', '2001:db8::/48'];

    it('allows an exact address', () => {
      expect(ipAllowed('203.0.113.10', list)).toBe(true);
    });

    it('allows an address inside a range', () => {
      expect(ipAllowed('198.51.100.77', list)).toBe(true);
      expect(ipAllowed('2001:db8:0:1::5', list)).toBe(true);
    });

    it('allows IPv4-mapped IPv6 as reported by Express', () => {
      expect(ipAllowed('::ffff:203.0.113.10', list)).toBe(true);
    });

    it('refuses addresses outside the list', () => {
      expect(ipAllowed('203.0.113.11', list)).toBe(false);
      expect(ipAllowed('2001:db9::1', list)).toBe(false);
    });

    it('refuses an empty or unparseable address', () => {
      expect(ipAllowed('', list)).toBe(false);
      expect(ipAllowed('not-an-ip', list)).toBe(false);
    });
  });

  describe('nameCovered', () => {
    const hosts = ['labxp.io', 'Example.COM'];

    it('covers the domain itself, subdomains and wildcards', () => {
      expect(nameCovered('labxp.io', hosts)).toBe(true);
      expect(nameCovered('pfe.labxp.io', hosts)).toBe(true);
      expect(nameCovered('*.labxp.io', hosts)).toBe(true);
      expect(nameCovered('WWW.example.com', hosts)).toBe(true);
    });

    it('does not cover look-alike or other domains', () => {
      expect(nameCovered('evillabxp.io', hosts)).toBe(false);
      expect(nameCovered('labxp.io.evil.com', hosts)).toBe(false);
      expect(nameCovered('other.org', hosts)).toBe(false);
    });
  });

  describe('certDnsNames', () => {
    it('collects the CN and DNS SANs, ignoring other SAN types', () => {
      const parsed = {
        subject: [
          { name: 'commonName', shortName: 'CN', value: 'labxp.io' },
          { name: 'organizationName', shortName: 'O', value: 'Lab' },
        ],
        attributes: [],
        publicKey: { keyType: 'ECDSA', bitLength: 256 },
        extensions: [
          {
            name: 'subjectAltName',
            altNames: [
              { type: 2, value: 'labxp.io' },
              { type: 2, value: '*.labxp.io' },
              { type: 7, value: '192.0.2.1' },
            ],
          },
        ],
      } as ParsedCsr;
      expect(certDnsNames(parsed).sort()).toEqual(['*.labxp.io', 'labxp.io']);
    });

    it('returns nothing for a missing CSR', () => {
      expect(certDnsNames(null)).toEqual([]);
    });
  });

  describe('hasResourceRestrictions', () => {
    it('is false for sessions and unrestricted keys', () => {
      expect(hasResourceRestrictions(undefined)).toBe(false);
      expect(
        hasResourceRestrictions({
          id: 'k',
          scopes: ['certs:read'],
          allowedDomainIds: null,
          allowedCertIds: null,
        }),
      ).toBe(false);
    });

    it('is true when domains or certs are limited', () => {
      expect(
        hasResourceRestrictions({
          id: 'k',
          scopes: null,
          allowedDomainIds: ['d1'],
          allowedCertIds: null,
        }),
      ).toBe(true);
      expect(
        hasResourceRestrictions({
          id: 'k',
          scopes: null,
          allowedDomainIds: null,
          allowedCertIds: [1],
        }),
      ).toBe(true);
    });
  });
});
