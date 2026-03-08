/**
 * Unit tests for CSR Generator utility functions
 *
 * Tests cover:
 * - Browser compatibility checks
 * - Key pair generation for all supported types
 * - CSR creation with subject fields and SANs
 * - PEM export (private/public keys)
 * - Error sanitization (security critical)
 * - Helper functions (security level, generation time)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isBrowserCompatible,
  generateKeyPair,
  exportPrivateKeyToPem,
  exportPublicKeyToPem,
  generateCsr,
  sanitizeErrorMessage,
  getSecurityLevel,
  getGenerationTime,
} from './csrGenerator';
import type {
  KeyType,
  CsrSubjectFields,
  CsrSanFields,
} from '@krakenkey/shared';

describe('csrGenerator', () => {
  describe('isBrowserCompatible', () => {
    it('should return true when WebCrypto API is available', () => {
      expect(isBrowserCompatible()).toBe(true);
    });

    it('should return false when window is undefined', () => {
      const originalWindow = globalThis.window;
      // @ts-expect-error - testing edge case
      delete globalThis.window;

      expect(isBrowserCompatible()).toBe(false);

      // Restore
      globalThis.window = originalWindow;
    });
  });

  describe('generateKeyPair', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should generate RSA-2048 key pair', async () => {
      const mockKeyPair = {
        privateKey: { type: 'private' } as CryptoKey,
        publicKey: { type: 'public' } as CryptoKey,
      };

      vi.spyOn(crypto.subtle, 'generateKey').mockResolvedValue(
        mockKeyPair as CryptoKeyPair,
      );

      const keyPair = await generateKeyPair('RSA-2048');

      expect(crypto.subtle.generateKey).toHaveBeenCalledWith(
        {
          name: 'RSASSA-PKCS1-v1_5',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        },
        true,
        ['sign', 'verify'],
      );
      expect(keyPair).toEqual(mockKeyPair);
    });

    it('should generate RSA-4096 key pair', async () => {
      const mockKeyPair = {
        privateKey: { type: 'private' } as CryptoKey,
        publicKey: { type: 'public' } as CryptoKey,
      };

      vi.spyOn(crypto.subtle, 'generateKey').mockResolvedValue(
        mockKeyPair as CryptoKeyPair,
      );

      const keyPair = await generateKeyPair('RSA-4096');

      expect(crypto.subtle.generateKey).toHaveBeenCalledWith(
        {
          name: 'RSASSA-PKCS1-v1_5',
          modulusLength: 4096,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        },
        true,
        ['sign', 'verify'],
      );
      expect(keyPair).toEqual(mockKeyPair);
    });

    it('should generate ECDSA-P256 key pair', async () => {
      const mockKeyPair = {
        privateKey: { type: 'private' } as CryptoKey,
        publicKey: { type: 'public' } as CryptoKey,
      };

      vi.spyOn(crypto.subtle, 'generateKey').mockResolvedValue(
        mockKeyPair as CryptoKeyPair,
      );

      const keyPair = await generateKeyPair('ECDSA-P256');

      expect(crypto.subtle.generateKey).toHaveBeenCalledWith(
        {
          name: 'ECDSA',
          namedCurve: 'P-256',
        },
        true,
        ['sign', 'verify'],
      );
      expect(keyPair).toEqual(mockKeyPair);
    });

    it('should generate ECDSA-P384 key pair', async () => {
      const mockKeyPair = {
        privateKey: { type: 'private' } as CryptoKey,
        publicKey: { type: 'public' } as CryptoKey,
      };

      vi.spyOn(crypto.subtle, 'generateKey').mockResolvedValue(
        mockKeyPair as CryptoKeyPair,
      );

      const keyPair = await generateKeyPair('ECDSA-P384');

      expect(crypto.subtle.generateKey).toHaveBeenCalledWith(
        {
          name: 'ECDSA',
          namedCurve: 'P-384',
        },
        true,
        ['sign', 'verify'],
      );
      expect(keyPair).toEqual(mockKeyPair);
    });

    it('should throw error for unsupported key type', async () => {
      await expect(generateKeyPair('INVALID' as KeyType)).rejects.toThrow(
        'Unsupported key type',
      );
    });

    it('should throw error when browser is not compatible', async () => {
      const originalWindow = globalThis.window;
      // @ts-expect-error - testing edge case
      delete globalThis.window;

      await expect(generateKeyPair('RSA-2048')).rejects.toThrow(
        'WebCrypto API not supported',
      );

      // Restore
      globalThis.window = originalWindow;
    });

    it('should handle key generation failure', async () => {
      vi.spyOn(crypto.subtle, 'generateKey').mockRejectedValue(
        new Error('Crypto failure'),
      );

      await expect(generateKeyPair('RSA-2048')).rejects.toThrow(
        'Key generation failed',
      );
    });
  });

  describe('exportPrivateKeyToPem', () => {
    it('should export private key to PEM format', async () => {
      const mockPrivateKey = { type: 'private' } as CryptoKey;
      const mockExportedKey = new ArrayBuffer(256);

      vi.spyOn(crypto.subtle, 'exportKey').mockResolvedValue(mockExportedKey);

      const pem = await exportPrivateKeyToPem(mockPrivateKey);

      expect(crypto.subtle.exportKey).toHaveBeenCalledWith(
        'pkcs8',
        mockPrivateKey,
      );
      expect(pem).toContain('-----BEGIN PRIVATE KEY-----');
      expect(pem).toContain('-----END PRIVATE KEY-----');
    });

    it('should handle export failure', async () => {
      const mockPrivateKey = { type: 'private' } as CryptoKey;

      vi.spyOn(crypto.subtle, 'exportKey').mockRejectedValue(
        new Error('Export failed'),
      );

      await expect(exportPrivateKeyToPem(mockPrivateKey)).rejects.toThrow(
        'Private key export failed',
      );
    });
  });

  describe('exportPublicKeyToPem', () => {
    it('should export public key to PEM format', async () => {
      const mockPublicKey = { type: 'public' } as CryptoKey;
      const mockExportedKey = new ArrayBuffer(256);

      vi.spyOn(crypto.subtle, 'exportKey').mockResolvedValue(mockExportedKey);

      const pem = await exportPublicKeyToPem(mockPublicKey);

      expect(crypto.subtle.exportKey).toHaveBeenCalledWith(
        'spki',
        mockPublicKey,
      );
      expect(pem).toContain('-----BEGIN PUBLIC KEY-----');
      expect(pem).toContain('-----END PUBLIC KEY-----');
    });

    it('should handle export failure', async () => {
      const mockPublicKey = { type: 'public' } as CryptoKey;

      vi.spyOn(crypto.subtle, 'exportKey').mockRejectedValue(
        new Error('Export failed'),
      );

      await expect(exportPublicKeyToPem(mockPublicKey)).rejects.toThrow(
        'Public key export failed',
      );
    });
  });

  describe('sanitizeErrorMessage', () => {
    it('should redact PEM blocks from error messages', () => {
      const message =
        'Error: -----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgk...\n-----END PRIVATE KEY-----';
      const sanitized = sanitizeErrorMessage(message);

      expect(sanitized).not.toContain('BEGIN PRIVATE KEY');
      expect(sanitized).toContain('[REDACTED]');
    });

    it('should redact long hex strings from error messages', () => {
      const message =
        'Error: Key material 3082025e02010002818100ab1234567890abcdef1234567890abcdef';
      const sanitized = sanitizeErrorMessage(message);

      expect(sanitized).not.toContain('ab1234567890abcdef');
      expect(sanitized).toContain('[HEX_REDACTED]');
    });

    it('should replace crypto-related errors with generic message', () => {
      const message = 'SubtleCrypto.generateKey failed: invalid algorithm';
      const sanitized = sanitizeErrorMessage(message);

      expect(sanitized).toBe(
        'Cryptographic operation failed. Please try again or contact support.',
      );
    });

    it('should leave safe error messages unchanged', () => {
      const message = 'Common Name is required';
      const sanitized = sanitizeErrorMessage(message);

      expect(sanitized).toBe(message);
    });

    it('should handle multiple PEM blocks', () => {
      const message =
        'Error: -----BEGIN CERTIFICATE-----\nABC...\n-----END CERTIFICATE----- and -----BEGIN PRIVATE KEY-----\nDEF...\n-----END PRIVATE KEY-----';
      const sanitized = sanitizeErrorMessage(message);

      expect(sanitized).not.toContain('CERTIFICATE');
      expect(sanitized).not.toContain('PRIVATE KEY');
      expect(sanitized).toContain('[REDACTED]');
    });
  });

  describe('getSecurityLevel', () => {
    it('should return correct security level for RSA-2048', () => {
      expect(getSecurityLevel('RSA-2048')).toBe('~112-bit security');
    });

    it('should return correct security level for RSA-4096', () => {
      expect(getSecurityLevel('RSA-4096')).toBe('~152-bit security');
    });

    it('should return correct security level for ECDSA-P256', () => {
      expect(getSecurityLevel('ECDSA-P256')).toBe(
        '~128-bit security (~3072-bit RSA equivalent)',
      );
    });

    it('should return correct security level for ECDSA-P384', () => {
      expect(getSecurityLevel('ECDSA-P384')).toBe(
        '~192-bit security (~7600-bit RSA equivalent)',
      );
    });

    it('should return "Unknown" for invalid key type', () => {
      expect(getSecurityLevel('INVALID' as KeyType)).toBe('Unknown');
    });
  });

  describe('getGenerationTime', () => {
    it('should return correct generation time for RSA-2048', () => {
      expect(getGenerationTime('RSA-2048')).toBe('~1-2 seconds');
    });

    it('should return correct generation time for RSA-4096', () => {
      expect(getGenerationTime('RSA-4096')).toBe('~2-5 seconds');
    });

    it('should return correct generation time for ECDSA-P256', () => {
      expect(getGenerationTime('ECDSA-P256')).toBe('<1 second');
    });

    it('should return correct generation time for ECDSA-P384', () => {
      expect(getGenerationTime('ECDSA-P384')).toBe('<1 second');
    });

    it('should return "Unknown" for invalid key type', () => {
      expect(getGenerationTime('INVALID' as KeyType)).toBe('Unknown');
    });
  });

  describe('generateCsr (integration)', () => {
    const mockSubject: CsrSubjectFields = {
      commonName: 'example.com',
      organization: 'Test Inc',
      organizationalUnit: 'Engineering',
      locality: 'San Francisco',
      state: 'California',
      country: 'US',
    };

    const mockSans: CsrSanFields = {
      dnsNames: ['www.example.com', 'api.example.com'],
      ipAddresses: ['192.168.1.1'],
      emailAddresses: ['admin@example.com'],
    };

    it('should throw error when browser is not compatible', async () => {
      const originalWindow = globalThis.window;
      // @ts-expect-error - testing edge case
      delete globalThis.window;

      await expect(
        generateCsr('RSA-2048', mockSubject, mockSans),
      ).rejects.toThrow(
        'Your browser does not support cryptographic operations',
      );

      // Restore
      globalThis.window = originalWindow;
    });

    it('should sanitize errors from generateCsr', async () => {
      vi.spyOn(crypto.subtle, 'generateKey').mockRejectedValue(
        new Error(
          'Crypto error with -----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----',
        ),
      );

      await expect(
        generateCsr('RSA-2048', mockSubject, mockSans),
      ).rejects.toThrow();

      // Error should be sanitized (no PEM blocks)
      try {
        await generateCsr('RSA-2048', mockSubject, mockSans);
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain('BEGIN PRIVATE KEY');
        expect(message).not.toContain('secret');
      }
    });
  });
});
