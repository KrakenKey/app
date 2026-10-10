import { generateKeyPairSync, sign } from 'node:crypto';
import {
  parsePublicKey,
  parseTimestamp,
  rotateMessage,
  tokenMessage,
  verifySignature,
} from './connector-crypto';

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const x = publicKey.export({ format: 'jwk' }).x!;
  return {
    privateKey,
    publicB64: Buffer.from(x, 'base64url').toString('base64'),
  };
}

const sig = (msg: string, key: ReturnType<typeof keyPair>) =>
  sign(null, Buffer.from(msg, 'utf8'), key.privateKey).toString('base64');

describe('parsePublicKey', () => {
  const k = keyPair();

  it('accepts the padded standard base64 of a raw 32-byte key', () => {
    expect(k.publicB64).toHaveLength(44);
    expect(parsePublicKey(k.publicB64)).not.toBeNull();
  });

  it.each([
    ['unpadded', () => k.publicB64.slice(0, 43)],
    [
      'base64url',
      () => Buffer.from(k.publicB64, 'base64').toString('base64url'),
    ],
    ['31 bytes', () => Buffer.alloc(31, 1).toString('base64')],
    ['33 bytes', () => Buffer.alloc(33, 1).toString('base64')],
    [
      'an SPKI DER key',
      () =>
        generateKeyPairSync('ed25519')
          .publicKey.export({ format: 'der', type: 'spki' })
          .toString('base64'),
    ],
    ['non-canonical trailing bits', () => k.publicB64.slice(0, 42) + 'B='],
    ['empty', () => ''],
  ])('refuses %s', (_, value) => {
    expect(parsePublicKey(value())).toBeNull();
  });
});

describe('verifySignature', () => {
  const k = keyPair();
  const other = keyPair();
  const msg = tokenMessage(
    '3f1c2b9e-1111-4111-8111-111111111111',
    '2026-10-10T14:00:00Z',
    'bm9uY2Vub25jZW5vbmNlMTIz',
  );

  it('accepts a signature by the key over the exact message', () => {
    expect(
      verifySignature(parsePublicKey(k.publicB64)!, msg, sig(msg, k)),
    ).toBe(true);
  });

  it('refuses another key, another message, and malformed signatures', () => {
    const pub = parsePublicKey(k.publicB64)!;
    expect(verifySignature(pub, msg, sig(msg, other))).toBe(false);
    expect(verifySignature(pub, `${msg}\n`, sig(msg, k))).toBe(false);
    expect(verifySignature(pub, msg, sig(msg, k).slice(0, 86))).toBe(false);
    expect(verifySignature(pub, msg, Buffer.alloc(64).toString('base64'))).toBe(
      false,
    );
    expect(verifySignature(pub, msg, 'not base64')).toBe(false);
  });
});

describe('parseTimestamp', () => {
  it('parses RFC 3339 UTC with second precision', () => {
    expect(parseTimestamp('2026-10-10T14:00:00Z')).toBe(
      Date.UTC(2026, 9, 10, 14, 0, 0),
    );
  });

  it.each([
    '2026-10-10T14:00:00.123Z',
    '2026-10-10T14:00:00+00:00',
    '2026-10-10 14:00:00Z',
    '2026-02-30T14:00:00Z',
    '2026-13-01T00:00:00Z',
    '1760104800',
  ])('refuses %s', (ts) => {
    expect(parseTimestamp(ts)).toBeNull();
  });
});

describe('signed messages', () => {
  it('joins the fields with newlines and no trailing newline', () => {
    expect(tokenMessage('id', '2026-10-10T14:00:00Z', 'n')).toBe(
      'KRAKENKEY-CONNECTOR-TOKEN-V1\nid\n2026-10-10T14:00:00Z\nn',
    );
    expect(rotateMessage('id', 'KEY=', '2026-10-10T14:00:00Z', 'n')).toBe(
      'KRAKENKEY-CONNECTOR-ROTATE-V1\nid\nKEY=\n2026-10-10T14:00:00Z\nn',
    );
  });
});
