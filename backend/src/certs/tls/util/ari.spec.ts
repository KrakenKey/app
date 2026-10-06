import * as x509 from '@peculiar/x509';
import { webcrypto } from 'node:crypto';
import {
  ariCertId,
  ariCertIdFromParts,
  isEarlyReplacement,
  parseRenewalInfo,
  retryAfterSeconds,
  serialDerBytes,
} from './ari';

const DAY = 86_400_000;

describe('ARI helpers', () => {
  it('matches the RFC 9773 example identifier', () => {
    expect(
      ariCertIdFromParts(
        '69:88:5B:6B:87:46:40:41:E1:B3:7B:84:7B:A0:AE:2C:DE:01:C8:D4',
        '00:87:65:43:21',
      ),
    ).toBe('aYhba4dGQEHhs3uEe6CuLN4ByNQ.AIdlQyE');
  });

  it('encodes serials as minimal DER integer content', () => {
    expect(serialDerBytes('876543').toString('hex')).toBe('00876543');
    expect(serialDerBytes('0000123456').toString('hex')).toBe('123456');
    expect(serialDerBytes('0080').toString('hex')).toBe('0080');
    expect(serialDerBytes('00').toString('hex')).toBe('00');
  });

  it('builds the identifier from a real certificate', async () => {
    x509.cryptoProvider.set(webcrypto as unknown as Crypto);
    const alg = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
    const ca = await webcrypto.subtle.generateKey(alg, false, [
      'sign',
      'verify',
    ]);
    const leafKeys = await webcrypto.subtle.generateKey(alg, false, [
      'sign',
      'verify',
    ]);
    const leaf = await x509.X509CertificateGenerator.create({
      serialNumber: '00a1b2',
      subject: 'CN=labxp.io',
      issuer: 'CN=Test CA',
      notBefore: new Date(),
      notAfter: new Date(Date.now() + 90 * DAY),
      signingAlgorithm: alg,
      publicKey: leafKeys.publicKey,
      signingKey: ca.privateKey,
      extensions: [
        await x509.AuthorityKeyIdentifierExtension.create(ca.publicKey),
      ],
    });
    const aki = leaf.getExtension(x509.AuthorityKeyIdentifierExtension)!.keyId!;
    expect(ariCertId(leaf.toString('pem'))).toBe(
      `${Buffer.from(aki, 'hex').toString('base64url')}.AKGy`,
    );
  });

  it('parses renewalInfo and rejects malformed bodies', () => {
    expect(
      parseRenewalInfo({
        suggestedWindow: {
          start: '2027-01-01T00:00:00Z',
          end: '2027-01-03T00:00:00Z',
        },
        explanationURL: 'https://letsencrypt.org/incident',
      }),
    ).toEqual({
      start: new Date('2027-01-01T00:00:00Z'),
      end: new Date('2027-01-03T00:00:00Z'),
      explanationUrl: 'https://letsencrypt.org/incident',
    });
    expect(
      parseRenewalInfo({ suggestedWindow: { start: 'x', end: 'y' } }),
    ).toBeNull();
    expect(
      parseRenewalInfo({
        suggestedWindow: {
          start: '2027-01-03T00:00:00Z',
          end: '2027-01-01T00:00:00Z',
        },
      }),
    ).toBeNull();
    expect(parseRenewalInfo(null)).toBeNull();
  });

  it('clamps Retry-After to 1h..24h and defaults to 6h', () => {
    expect(retryAfterSeconds(undefined)).toBe(21600);
    expect(retryAfterSeconds('120')).toBe(3600);
    expect(retryAfterSeconds('7200')).toBe(7200);
    expect(retryAfterSeconds('999999')).toBe(86400);
    const now = Date.parse('2026-10-05T00:00:00Z');
    expect(retryAfterSeconds('Mon, 05 Oct 2026 03:00:00 GMT', now)).toBe(10800);
    expect(retryAfterSeconds('garbage')).toBe(21600);
  });

  describe('isEarlyReplacement', () => {
    const notBefore = new Date('2026-10-01T00:00:00Z');
    const notAfter = new Date(notBefore.getTime() + 90 * DAY);
    const cert = { notBefore, notAfter };
    const normal = {
      start: new Date(notBefore.getTime() + 60 * DAY),
      end: new Date(notBefore.getTime() + 62 * DAY),
      explanationUrl: null,
    };

    it("treats a normal Let's Encrypt window as normal", () => {
      expect(isEarlyReplacement(normal, cert, null)).toBe(false);
      expect(isEarlyReplacement(normal, cert, normal.start)).toBe(false);
    });

    it('flags a window that moved earlier, as before a mass revocation', () => {
      const moved = {
        start: new Date(notBefore.getTime() + 70 * DAY),
        end: new Date(notBefore.getTime() + 71 * DAY),
        explanationUrl: null,
      };
      // Late in life, still earlier than what we saw before
      expect(
        isEarlyReplacement(
          moved,
          cert,
          new Date(notBefore.getTime() + 80 * DAY),
        ),
      ).toBe(true);
      // Jitter of a few hours is not a request
      expect(
        isEarlyReplacement(
          normal,
          cert,
          new Date(normal.start.getTime() + 3 * 3600 * 1000),
        ),
      ).toBe(false);
    });

    it('flags a first window in the first half of the lifetime', () => {
      expect(
        isEarlyReplacement(
          {
            start: new Date(notBefore.getTime() + 10 * DAY),
            end: new Date(notBefore.getTime() + 11 * DAY),
            explanationUrl: null,
          },
          cert,
          null,
        ),
      ).toBe(true);
    });

    it('flags any window with an explanation URL', () => {
      expect(
        isEarlyReplacement(
          { ...normal, explanationUrl: 'https://example.org/why' },
          cert,
          normal.start,
        ),
      ).toBe(true);
    });
  });
});
