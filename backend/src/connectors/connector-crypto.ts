import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import {
  CONNECTOR_ROTATE_SIGNING_PREFIX,
  CONNECTOR_TOKEN_SIGNING_PREFIX,
} from '@krakenkey/shared';

/** Standard base64 (padded) of exactly 32 bytes. */
export const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;

/** Standard base64 (padded) of exactly 64 bytes. */
export const SIGNATURE_PATTERN = /^[A-Za-z0-9+/]{85}[AQgw]==$/;

/** RFC 3339 UTC, second precision: 2026-10-10T14:00:00Z. */
export const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** base64url without padding, 16 bytes (22 characters) or more, at most 64. */
export const NONCE_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

/** The Ed25519 field prime, 2^255 - 19. */
const P = (1n << 255n) - 19n;

/**
 * y-coordinates of the eight small-order points of Ed25519 (the torsion
 * subgroup): the identity (y = 1), the order-2 point (y = -1), the two
 * order-4 points (y = 0) and the four order-8 points (y = ±y8). Any public
 * key on one of them makes signatures forgeable: with the identity, the
 * signature R = identity, S = 0 verifies for every message.
 */
const SMALL_ORDER_Y = new Set<bigint>([
  0n,
  1n,
  P - 1n,
  2707385501144840649318225287225658788936804267575313519463743609750303402022n,
  55188659117513257062467267217118295137698188065244968500265048394206261417927n,
]);

/**
 * True when 32 bytes are a canonical encoding of a point outside the
 * small-order subgroup. Rejects y >= p (non-canonical) and every
 * small-order y, whatever the sign bit, so all encodings of the eight
 * small-order points are refused.
 */
export function isAcceptablePoint(raw: Buffer): boolean {
  if (raw.length !== 32) return false;
  const bytes = Buffer.from(raw);
  bytes[31] &= 0x7f; // drop the x sign bit
  const y = BigInt(`0x${Buffer.from(bytes).reverse().toString('hex')}`);
  if (y >= P) return false;
  return !SMALL_ORDER_Y.has(y);
}

/**
 * Builds an Ed25519 public key from the base64 of its raw 32 bytes.
 * Returns null for anything else: wrong length, non-canonical base64 or
 * point encoding, a small-order point, or bytes OpenSSL refuses as a key.
 */
export function parsePublicKey(b64: string): KeyObject | null {
  if (typeof b64 !== 'string' || !PUBLIC_KEY_PATTERN.test(b64)) return null;
  const raw = Buffer.from(b64, 'base64');
  if (raw.length !== 32 || raw.toString('base64') !== b64) return null;
  if (!isAcceptablePoint(raw)) return null;
  try {
    return createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') },
      format: 'jwk',
    });
  } catch {
    return null;
  }
}

/** Verifies a base64 Ed25519 signature over the UTF-8 message. Never throws. */
export function verifySignature(
  publicKey: KeyObject,
  message: string,
  signatureB64: string,
): boolean {
  if (
    typeof signatureB64 !== 'string' ||
    !SIGNATURE_PATTERN.test(signatureB64)
  ) {
    return false;
  }
  const sig = Buffer.from(signatureB64, 'base64');
  if (sig.length !== 64) return false;
  try {
    return verify(null, Buffer.from(message, 'utf8'), publicKey, sig);
  } catch {
    return false;
  }
}

/**
 * Parses a signed timestamp. Returns the time in milliseconds, or null when
 * it is not RFC 3339 UTC with second precision or not a real date.
 */
export function parseTimestamp(ts: string): number | null {
  if (typeof ts !== 'string' || !TIMESTAMP_PATTERN.test(ts)) return null;
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) return null;
  // Date.parse rolls 2026-02-30 over to March; refuse it instead
  if (new Date(ms).toISOString().replace('.000Z', 'Z') !== ts) return null;
  return ms;
}

/** The message a connector signs to get a short-lived key. */
export function tokenMessage(
  connectorId: string,
  timestamp: string,
  nonce: string,
): string {
  return [CONNECTOR_TOKEN_SIGNING_PREFIX, connectorId, timestamp, nonce].join(
    '\n',
  );
}

/** The message a connector signs, with its current key, to rotate it. */
export function rotateMessage(
  connectorId: string,
  newPublicKey: string,
  timestamp: string,
  nonce: string,
): string {
  return [
    CONNECTOR_ROTATE_SIGNING_PREFIX,
    connectorId,
    newPublicKey,
    timestamp,
    nonce,
  ].join('\n');
}
