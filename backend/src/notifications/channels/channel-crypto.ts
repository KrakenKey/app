import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'crypto';

/**
 * Encryption at rest for notification channel URLs and webhook secrets.
 *
 * AES-256-GCM with a key derived from KK_HMAC_SECRET via HKDF-SHA256, so no
 * extra secret has to be provisioned. Stored as
 * `v1:<iv b64>:<tag b64>:<ciphertext b64>`; the version prefix leaves room
 * for a key rotation later.
 */

const HKDF_INFO = 'krakenkey/notification-channels/v1';
const HKDF_SALT = Buffer.alloc(0);
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function deriveChannelKey(masterSecret: string): Buffer {
  if (!masterSecret) {
    throw new Error(
      'KK_HMAC_SECRET must be set to store notification channel URLs',
    );
  }
  return Buffer.from(
    hkdfSync('sha256', masterSecret, HKDF_SALT, HKDF_INFO, 32),
  );
}

export function encryptSecretValue(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: TAG_BYTES,
  });
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/** Throws when the value is malformed, tampered with or under another key. */
export function decryptSecretValue(stored: string, key: Buffer): string {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Unsupported encrypted value format');
  }
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ciphertext = Buffer.from(parts[3], 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Unsupported encrypted value format');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, iv, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}

/** `https://hooks.slack.com/…abcd`: scheme, host and the last 4 characters. */
export function maskUrl(url: string): string {
  let origin: string;
  try {
    const parsed = new URL(url);
    origin = `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '…';
  }
  return `${origin}/…${url.slice(-4)}`;
}

/** `whsec_` + 32 random bytes, base64url. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}
