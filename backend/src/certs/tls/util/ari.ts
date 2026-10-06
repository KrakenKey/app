import * as x509 from '@peculiar/x509';

/**
 * ACME Renewal Information (RFC 9773) helpers. Pure functions, so the
 * scheduling rules can be tested without a CA.
 */

/** RFC 9773 suggested renewal window, as returned by the CA. */
export interface AriWindow {
  start: Date;
  end: Date;
  explanationUrl: string | null;
}

function hexToBytes(hex: string): Buffer {
  const clean = hex.replace(/[^0-9a-f]/gi, '');
  return Buffer.from(clean.length % 2 ? `0${clean}` : clean, 'hex');
}

/**
 * The certificate's serial as the content octets of a DER INTEGER: minimal
 * length, with a leading zero byte when the top bit is set (RFC 9773 §4.1).
 */
export function serialDerBytes(serialHex: string): Buffer {
  let bytes = hexToBytes(serialHex);
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0 && !(bytes[i + 1] & 0x80)) i++;
  bytes = bytes.subarray(i);
  if (bytes.length === 0) return Buffer.from([0]);
  return bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes;
}

/**
 * RFC 9773 certificate identifier for the certificate's renewalInfo URL and
 * the `replaces` field of a new order:
 * base64url(AKI keyIdentifier) "." base64url(DER serial).
 */
export function ariCertIdFromParts(akiHex: string, serialHex: string): string {
  return `${hexToBytes(akiHex).toString('base64url')}.${serialDerBytes(serialHex).toString('base64url')}`;
}

/**
 * Certificate identifier for a leaf PEM, or null when it has no Authority
 * Key Identifier (every Let's Encrypt certificate has one).
 */
export function ariCertId(leafPem: string): string | null {
  const cert = new x509.X509Certificate(leafPem);
  const aki = cert.getExtension(x509.AuthorityKeyIdentifierExtension);
  if (!aki?.keyId) return null;
  return ariCertIdFromParts(aki.keyId, cert.serialNumber);
}

/** Parses a renewalInfo response body; null if it is malformed. */
export function parseRenewalInfo(body: unknown): AriWindow | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as {
    suggestedWindow?: { start?: unknown; end?: unknown };
    explanationURL?: unknown;
  };
  const start = new Date(String(b.suggestedWindow?.start));
  const end = new Date(String(b.suggestedWindow?.end));
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
    return null;
  }
  return {
    start,
    end,
    explanationUrl:
      typeof b.explanationURL === 'string' ? b.explanationURL : null,
  };
}

/** Default and bounds for the next renewalInfo poll. */
export const ARI_DEFAULT_RETRY_SECONDS = 6 * 3600;
const ARI_MIN_RETRY_SECONDS = 3600;
const ARI_MAX_RETRY_SECONDS = 24 * 3600;

/**
 * Seconds until the next poll from a Retry-After header (delta-seconds or
 * HTTP date), clamped to 1h..24h. RFC 9773 asks clients to honour it.
 */
export function retryAfterSeconds(
  header: string | null | undefined,
  now = Date.now(),
): number {
  let secs = ARI_DEFAULT_RETRY_SECONDS;
  if (header) {
    const n = Number(header);
    if (Number.isFinite(n)) {
      secs = n;
    } else {
      const at = Date.parse(header);
      if (!isNaN(at)) secs = Math.round((at - now) / 1000);
    }
  }
  return Math.min(ARI_MAX_RETRY_SECONDS, Math.max(ARI_MIN_RETRY_SECONDS, secs));
}

/** Tolerance before a window that moved earlier counts as a CA request. */
const MOVED_EARLIER_MS = 24 * 3600 * 1000;

/**
 * Whether the CA is asking for this certificate to be replaced earlier than
 * its normal schedule. KrakenKey keeps renewing on the plan window and only
 * lets ARI pull a renewal earlier in that case (product decision for #121):
 *
 * - the window moved earlier than the one we saw last, by more than a day
 *   (what a CA does before a mass revocation), or
 * - the first window we see starts in the first half of the certificate's
 *   lifetime (a normal Let's Encrypt window starts about two thirds in), or
 * - the CA attached an explanation URL, which it only does for a reason.
 */
export function isEarlyReplacement(
  window: AriWindow,
  cert: { notBefore: Date; notAfter: Date },
  previousStart: Date | null,
): boolean {
  if (window.explanationUrl) return true;
  if (previousStart) {
    return window.start.getTime() < previousStart.getTime() - MOVED_EARLIER_MS;
  }
  const midLife =
    cert.notBefore.getTime() +
    (cert.notAfter.getTime() - cert.notBefore.getTime()) / 2;
  return window.start.getTime() < midLife;
}
