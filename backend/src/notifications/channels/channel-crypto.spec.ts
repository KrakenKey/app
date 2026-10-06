import {
  decryptSecretValue,
  deriveChannelKey,
  encryptSecretValue,
  generateWebhookSecret,
  maskUrl,
} from './channel-crypto';

describe('channel-crypto', () => {
  const key = deriveChannelKey('test-hmac-secret');
  const url = 'https://hooks.slack.com/services/T000/B000/abcdefghWXYZ';

  it('round-trips a value', () => {
    const stored = encryptSecretValue(url, key);
    expect(stored).toMatch(
      /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/,
    );
    expect(stored).not.toContain('hooks.slack.com');
    expect(decryptSecretValue(stored, key)).toBe(url);
  });

  it('uses a fresh IV for every encryption', () => {
    expect(encryptSecretValue(url, key)).not.toBe(encryptSecretValue(url, key));
  });

  it('derives a stable 32-byte key', () => {
    expect(key).toHaveLength(32);
    expect(deriveChannelKey('test-hmac-secret').equals(key)).toBe(true);
  });

  it('refuses an empty master secret', () => {
    expect(() => deriveChannelKey('')).toThrow('KK_HMAC_SECRET');
  });

  it('detects a tampered ciphertext', () => {
    const [v, iv, tag, ct] = encryptSecretValue(url, key).split(':');
    const bytes = Buffer.from(ct, 'base64');
    bytes[0] ^= 0x01;
    const tampered = [v, iv, tag, bytes.toString('base64')].join(':');
    expect(() => decryptSecretValue(tampered, key)).toThrow();
  });

  it('detects a tampered tag', () => {
    const [v, iv, tag, ct] = encryptSecretValue(url, key).split(':');
    const bytes = Buffer.from(tag, 'base64');
    bytes[0] ^= 0x01;
    expect(() =>
      decryptSecretValue([v, iv, bytes.toString('base64'), ct].join(':'), key),
    ).toThrow();
  });

  it('fails under the wrong key', () => {
    const stored = encryptSecretValue(url, key);
    expect(() =>
      decryptSecretValue(stored, deriveChannelKey('another-secret')),
    ).toThrow();
  });

  it('rejects unknown formats', () => {
    expect(() => decryptSecretValue('plain-text', key)).toThrow(
      'Unsupported encrypted value format',
    );
    expect(() => decryptSecretValue('v2:a:b:c', key)).toThrow(
      'Unsupported encrypted value format',
    );
  });

  it('masks a URL to scheme, host and last four characters', () => {
    expect(maskUrl(url)).toBe('https://hooks.slack.com/…WXYZ');
    expect(maskUrl('https://example.com:8443/hook?token=secret1234')).toBe(
      'https://example.com:8443/…1234',
    );
    expect(maskUrl('not a url')).toBe('…');
  });

  it('generates whsec_ secrets from 32 random bytes', () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(generateWebhookSecret()).not.toBe(secret);
  });
});
