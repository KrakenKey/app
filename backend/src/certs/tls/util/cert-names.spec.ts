import type { ParsedCsr } from '@krakenkey/shared';
import {
  certDisplayName,
  certNames,
  normalizeRequestedNames,
  sameNames,
} from './cert-names';

const parsed = (cn: string | null, sans: string[]) =>
  ({
    subject: cn ? [{ name: 'commonName', shortName: 'CN', value: cn }] : [],
    attributes: [],
    publicKey: { keyType: 'ECDSA', bitLength: 256 },
    extensions: [
      {
        name: 'subjectAltName',
        altNames: sans.map((value) => ({ type: 2, value })),
      },
    ],
  }) as unknown as ParsedCsr;

describe('cert names', () => {
  it('normalizes requested names: lowercase, trimmed, deduplicated, in order', () => {
    expect(
      normalizeRequestedNames([
        'WWW.Example.com',
        ' example.com',
        'www.example.com',
      ]),
    ).toEqual(['www.example.com', 'example.com']);
  });

  it('compares name sets ignoring case, order and duplicates', () => {
    expect(
      sameNames(
        ['a.example.com', 'B.example.com'],
        ['b.example.com', 'A.example.com', 'a.example.com'],
      ),
    ).toBe(true);
    expect(
      sameNames(['a.example.com'], ['a.example.com', 'b.example.com']),
    ).toBe(false);
    expect(sameNames(['a.example.com'], ['c.example.com'])).toBe(false);
  });

  it('takes names from the CSR, else the requested names', () => {
    expect(
      certNames({
        id: 1,
        parsedCsr: parsed('example.com', ['www.example.com']),
        requestedNames: ['ignored.example.com'],
      }),
    ).toEqual(['example.com', 'www.example.com']);
    expect(
      certNames({ id: 1, parsedCsr: null, requestedNames: ['example.com'] }),
    ).toEqual(['example.com']);
    expect(certNames({ id: 1, parsedCsr: null, requestedNames: null })).toEqual(
      [],
    );
  });

  it('displays the CN, first SAN, first requested name, or the id', () => {
    expect(
      certDisplayName({
        id: 1,
        parsedCsr: parsed('cn.example.com', ['x.example.com']),
      }),
    ).toBe('cn.example.com');
    expect(
      certDisplayName({ id: 1, parsedCsr: parsed(null, ['x.example.com']) }),
    ).toBe('x.example.com');
    expect(
      certDisplayName({
        id: 1,
        parsedCsr: null,
        requestedNames: ['app.example.com', 'b.example.com'],
      }),
    ).toBe('app.example.com');
    expect(
      certDisplayName({ id: 9, parsedCsr: null, requestedNames: null }),
    ).toBe('cert #9');
  });
});
