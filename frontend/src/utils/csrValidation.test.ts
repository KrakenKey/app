/**
 * Unit tests for CSR validation utility functions
 *
 * Tests cover:
 * - Common Name validation (FQDN, wildcard)
 * - Organization validation
 * - Country code validation (ISO 3166-1 alpha-2)
 * - DNS name validation
 * - IP address validation (IPv4, IPv6)
 * - Email address validation
 * - Domain authorization checks
 * - Subject fields combined validation
 */

import { describe, it, expect } from 'vitest';
import {
  validateCommonName,
  validateOrganization,
  validateCountryCode,
  validateDnsName,
  validateIpAddress,
  validateEmail,
  validateDomainAuthorization,
  validateSubjectFields,
  isDomainVerified,
} from './csrValidation';

describe('csrValidation', () => {
  describe('validateCommonName', () => {
    it('should accept valid FQDNs', () => {
      expect(validateCommonName('example.com')).toBeNull();
      expect(validateCommonName('www.example.com')).toBeNull();
      expect(validateCommonName('api.v2.example.com')).toBeNull();
      expect(validateCommonName('test-site.example.co.uk')).toBeNull();
    });

    it('should accept valid wildcard domains', () => {
      expect(validateCommonName('*.example.com')).toBeNull();
      expect(validateCommonName('*.api.example.com')).toBeNull();
    });

    it('should reject empty common name', () => {
      expect(validateCommonName('')).toBe('Common Name is required');
      expect(validateCommonName('   ')).toBe('Common Name is required');
    });

    it('should reject invalid domain formats', () => {
      expect(validateCommonName('-example.com')).toContain('valid domain name');
      expect(validateCommonName('example-.com')).toContain('valid domain name');
      expect(validateCommonName('exam ple.com')).toContain('valid domain name');
      expect(validateCommonName('example..com')).toContain('valid domain name');
      expect(validateCommonName('.example.com')).toContain('valid domain name');
      expect(validateCommonName('example.com.')).toContain('valid domain name');
    });

    it('should reject invalid wildcard formats', () => {
      expect(validateCommonName('*example.com')).toContain('valid domain name');
      expect(validateCommonName('*.*.example.com')).toContain('valid domain name');
      expect(validateCommonName('foo.*.example.com')).toContain('valid domain name');
    });

    it('should handle Unicode domains (punycode not supported)', () => {
      expect(validateCommonName('café.com')).toContain('valid domain name');
    });

    it('should reject domains exceeding 253 characters', () => {
      const longDomain = 'a'.repeat(250) + '.com';
      expect(validateCommonName(longDomain)).not.toBeNull();
    });

    it('should trim whitespace', () => {
      expect(validateCommonName('  example.com  ')).toBeNull();
    });
  });

  describe('validateOrganization', () => {
    it('should accept valid organization names', () => {
      expect(validateOrganization('Test Inc')).toBeNull();
      expect(validateOrganization('ACME Corporation')).toBeNull();
      expect(validateOrganization('Test & Co.')).toBeNull();
      expect(validateOrganization('Test-Corp 123')).toBeNull();
    });

    it('should accept empty organization (optional field)', () => {
      expect(validateOrganization('')).toBeNull();
    });

    it('should reject organization names that are too long', () => {
      const longName = 'A'.repeat(65);
      expect(validateOrganization(longName)).toContain('64 characters');
    });

    it('should reject organization names with control characters', () => {
      expect(validateOrganization('Test\nCorp')).toContain('invalid characters');
      expect(validateOrganization('Test\tCorp')).toContain('invalid characters');
      expect(validateOrganization('Test\x00Corp')).toContain('invalid characters');
      expect(validateOrganization('Test\x7FCorp')).toContain('invalid characters');
    });

    it('should allow special printable characters', () => {
      // These are printable chars, not control chars - should be accepted
      expect(validateOrganization('Test <Corp>')).toBeNull();
      expect(validateOrganization('Test@Corp')).toBeNull();
      expect(validateOrganization("Test's Corp")).toBeNull();
    });
  });

  describe('validateCountryCode', () => {
    it('should accept valid ISO 3166-1 alpha-2 country codes', () => {
      expect(validateCountryCode('US')).toBeNull();
      expect(validateCountryCode('GB')).toBeNull();
      expect(validateCountryCode('CA')).toBeNull();
      expect(validateCountryCode('DE')).toBeNull();
      expect(validateCountryCode('JP')).toBeNull();
    });

    it('should reject lowercase country codes (must be uppercase)', () => {
      // The regex requires /^[A-Z]{2}$/ - component uppercases before calling
      expect(validateCountryCode('us')).toContain('uppercase');
      expect(validateCountryCode('gb')).toContain('uppercase');
    });

    it('should accept empty country (optional field)', () => {
      expect(validateCountryCode('')).toBeNull();
    });

    it('should reject invalid country codes', () => {
      expect(validateCountryCode('USA')).toContain('2 letters');
      expect(validateCountryCode('U')).toContain('2 letters');
    });

    it('should reject numeric codes', () => {
      expect(validateCountryCode('12')).not.toBeNull();
    });

    it('should reject codes with special characters', () => {
      expect(validateCountryCode('U$')).not.toBeNull();
      expect(validateCountryCode('U-')).not.toBeNull();
    });
  });

  describe('validateDnsName', () => {
    it('should accept valid DNS names', () => {
      expect(validateDnsName('example.com')).toBeNull();
      expect(validateDnsName('www.example.com')).toBeNull();
      expect(validateDnsName('api.v2.example.com')).toBeNull();
    });

    it('should accept wildcard DNS names', () => {
      expect(validateDnsName('*.example.com')).toBeNull();
    });

    it('should reject empty DNS names', () => {
      expect(validateDnsName('')).toContain('cannot be empty');
      expect(validateDnsName('   ')).toContain('cannot be empty');
    });

    it('should reject invalid DNS formats', () => {
      expect(validateDnsName('-example.com')).toContain('valid domain');
      expect(validateDnsName('example-.com')).toContain('valid domain');
      expect(validateDnsName('exam ple.com')).toContain('valid domain');
    });

    it('should reject names exceeding 253 characters', () => {
      const longDns = 'a'.repeat(250) + '.com';
      expect(validateDnsName(longDns)).not.toBeNull();
    });

    it('should trim whitespace', () => {
      expect(validateDnsName('  example.com  ')).toBeNull();
    });
  });

  describe('validateIpAddress', () => {
    it('should accept valid IPv4 addresses', () => {
      expect(validateIpAddress('192.168.1.1')).toBeNull();
      expect(validateIpAddress('10.0.0.1')).toBeNull();
      expect(validateIpAddress('255.255.255.255')).toBeNull();
      expect(validateIpAddress('0.0.0.0')).toBeNull();
    });

    it('should accept valid IPv6 addresses', () => {
      expect(validateIpAddress('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBeNull();
      expect(validateIpAddress('::1')).toBeNull();
      expect(validateIpAddress('fe80::1')).toBeNull();
    });

    it('should reject empty IP addresses', () => {
      expect(validateIpAddress('')).toContain('cannot be empty');
      expect(validateIpAddress('   ')).toContain('cannot be empty');
    });

    it('should reject invalid IPv4 addresses', () => {
      expect(validateIpAddress('256.1.1.1')).not.toBeNull();
      expect(validateIpAddress('192.168.1')).not.toBeNull();
      expect(validateIpAddress('192.168.1.1.1')).not.toBeNull();
      expect(validateIpAddress('192.168.-1.1')).not.toBeNull();
    });

    it('should reject non-IP strings', () => {
      expect(validateIpAddress('example.com')).not.toBeNull();
      expect(validateIpAddress('not-an-ip')).not.toBeNull();
    });

    it('should trim whitespace', () => {
      expect(validateIpAddress('  192.168.1.1  ')).toBeNull();
    });
  });

  describe('validateEmail', () => {
    it('should accept valid email addresses', () => {
      expect(validateEmail('user@example.com')).toBeNull();
      expect(validateEmail('test.user@example.com')).toBeNull();
      expect(validateEmail('user+tag@example.co.uk')).toBeNull();
      expect(validateEmail('user_123@sub.example.com')).toBeNull();
    });

    it('should reject empty email addresses', () => {
      expect(validateEmail('')).toContain('cannot be empty');
      expect(validateEmail('   ')).toContain('cannot be empty');
    });

    it('should reject invalid email formats', () => {
      expect(validateEmail('invalid')).toContain('valid email');
      expect(validateEmail('@example.com')).toContain('valid email');
      expect(validateEmail('user@')).toContain('valid email');
      expect(validateEmail('user @example.com')).toContain('valid email');
      expect(validateEmail('user@exam ple.com')).toContain('valid email');
    });

    it('should accept emails with simple domain (no TLD)', () => {
      // RFC 5322 allows local domains
      expect(validateEmail('user@localhost')).toBeNull();
    });

    it('should reject emails exceeding 254 characters', () => {
      const longEmail = 'a'.repeat(250) + '@b.com';
      expect(validateEmail(longEmail)).not.toBeNull();
    });

    it('should trim whitespace', () => {
      expect(validateEmail('  user@example.com  ')).toBeNull();
    });
  });

  describe('isDomainVerified', () => {
    it('should return true for verified domains', () => {
      expect(isDomainVerified('example.com', ['example.com', 'test.com'])).toBe(true);
    });

    it('should return false for unverified domains', () => {
      expect(isDomainVerified('unknown.com', ['example.com', 'test.com'])).toBe(false);
    });

    it('should trim domain before checking', () => {
      expect(isDomainVerified('  example.com  ', ['example.com'])).toBe(true);
    });

    it('should return true for subdomains of a verified parent', () => {
      expect(isDomainVerified('sub.example.com', ['example.com'])).toBe(true);
    });

    it('should return true for multi-level subdomains of a verified parent', () => {
      expect(isDomainVerified('a.b.c.example.com', ['example.com'])).toBe(true);
    });

    it('should return true for wildcard domains when parent is verified', () => {
      expect(isDomainVerified('*.example.com', ['example.com'])).toBe(true);
    });

    it('should return true for wildcard subdomains when parent is verified', () => {
      expect(isDomainVerified('*.sub.example.com', ['example.com'])).toBe(true);
    });

    it('should be case-insensitive for subdomain matching', () => {
      expect(isDomainVerified('Sub.Example.COM', ['example.com'])).toBe(true);
    });

    it('should not match domains that share a suffix but are not true subdomains', () => {
      expect(isDomainVerified('notexample.com', ['example.com'])).toBe(false);
    });
  });

  describe('validateDomainAuthorization', () => {
    const verifiedDomains = ['example.com', 'www.example.com', 'api.example.com'];

    it('should return null when all domains are verified', () => {
      const domains = ['example.com', 'www.example.com'];
      expect(validateDomainAuthorization(domains, verifiedDomains)).toBeNull();
    });

    it('should return error for unauthorized domains', () => {
      const domains = ['example.com', 'unauthorized.com'];
      const error = validateDomainAuthorization(domains, verifiedDomains);

      expect(error).toContain('not verified');
      expect(error).toContain('unauthorized.com');
    });

    it('should return error for multiple unauthorized domains', () => {
      const domains = ['example.com', 'unauthorized1.com', 'unauthorized2.com'];
      const error = validateDomainAuthorization(domains, verifiedDomains);

      expect(error).toContain('not verified');
      expect(error).toContain('unauthorized1.com');
      expect(error).toContain('unauthorized2.com');
    });

    it('should handle empty domain list', () => {
      expect(validateDomainAuthorization([], verifiedDomains)).toBeNull();
    });

    it('should handle empty verified domains list', () => {
      const domains = ['example.com'];
      const error = validateDomainAuthorization(domains, []);

      expect(error).toContain('not verified');
      expect(error).toContain('example.com');
    });

    it('should be case-insensitive (DNS is case-insensitive per RFC 4343)', () => {
      const domains = ['Example.com'];
      // Should match case-insensitively
      expect(validateDomainAuthorization(domains, verifiedDomains)).toBeNull();
    });

    it('should authorize subdomains of a verified parent domain', () => {
      const domains = ['sub.example.com', 'deep.sub.example.com'];
      expect(validateDomainAuthorization(domains, ['example.com'])).toBeNull();
    });

    it('should authorize wildcard domains when parent is verified', () => {
      const domains = ['*.example.com'];
      expect(validateDomainAuthorization(domains, ['example.com'])).toBeNull();
    });

    it('should not authorize domains that share a suffix but are not true subdomains', () => {
      const domains = ['notexample.com'];
      const error = validateDomainAuthorization(domains, ['example.com']);

      expect(error).toContain('not verified');
      expect(error).toContain('notexample.com');
    });
  });

  describe('validateSubjectFields', () => {
    it('should return null for valid subject', () => {
      expect(validateSubjectFields({
        commonName: 'example.com',
        organization: 'Test Inc',
        country: 'US',
      })).toBeNull();
    });

    it('should return errors for invalid CN', () => {
      const errors = validateSubjectFields({
        commonName: '',
      });
      expect(errors).not.toBeNull();
      expect(errors?.commonName).toBeTruthy();
    });

    it('should return errors for invalid country code', () => {
      const errors = validateSubjectFields({
        commonName: 'example.com',
        country: 'USA',
      });
      expect(errors).not.toBeNull();
      expect(errors?.country).toBeTruthy();
    });

    it('should return errors for too-long OU', () => {
      const errors = validateSubjectFields({
        commonName: 'example.com',
        organizationalUnit: 'A'.repeat(65),
      });
      expect(errors).not.toBeNull();
      expect(errors?.organizationalUnit).toContain('64 characters');
    });

    it('should return errors for too-long locality', () => {
      const errors = validateSubjectFields({
        commonName: 'example.com',
        locality: 'A'.repeat(129),
      });
      expect(errors).not.toBeNull();
      expect(errors?.locality).toContain('128 characters');
    });

    it('should return errors for too-long state', () => {
      const errors = validateSubjectFields({
        commonName: 'example.com',
        state: 'A'.repeat(129),
      });
      expect(errors).not.toBeNull();
      expect(errors?.state).toContain('128 characters');
    });
  });

  describe('Edge cases and security', () => {
    it('should handle very long domain inputs gracefully', () => {
      const longDomain = 'a'.repeat(300) + '.com';
      expect(validateCommonName(longDomain)).not.toBeNull();
    });

    it('should handle null bytes in domain names', () => {
      expect(validateCommonName('example.com\0evil.com')).toContain('valid domain name');
    });

    it('should handle control chars in organization', () => {
      expect(validateOrganization('Test\x00Corp')).toContain('invalid characters');
    });

    it('should reject control chars in organizational unit', () => {
      const errors = validateSubjectFields({
        commonName: 'example.com',
        organizationalUnit: 'IT\x00Dept',
      });
      expect(errors).not.toBeNull();
      expect(errors?.organizationalUnit).toContain('invalid characters');
    });

    it('should reject control chars in locality', () => {
      const errors = validateSubjectFields({
        commonName: 'example.com',
        locality: 'San\x07Francisco',
      });
      expect(errors).not.toBeNull();
      expect(errors?.locality).toContain('invalid characters');
    });

    it('should reject control chars in state', () => {
      const errors = validateSubjectFields({
        commonName: 'example.com',
        state: 'Cali\x1Bfornia',
      });
      expect(errors).not.toBeNull();
      expect(errors?.state).toContain('invalid characters');
    });

    it('should reject CRLF injection in OU', () => {
      const errors = validateSubjectFields({
        commonName: 'example.com',
        organizationalUnit: 'IT\r\nInjected',
      });
      expect(errors).not.toBeNull();
      expect(errors?.organizationalUnit).toContain('invalid characters');
    });
  });
});
