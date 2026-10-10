import { describe, expect, it } from 'vitest';
import { CertStatus } from '@krakenkey/shared';
import { getCertDomains, parseNameList } from '../certDomains';
import { STATUS_LABEL, STATUS_ORDER } from '../statusMappings';
import { mockAwaitingCsrCert, mockCerts } from '../../test/mocks/data';

describe('getCertDomains', () => {
  it('reads the CN and SANs from the parsed CSR', () => {
    expect(getCertDomains(mockCerts[0])).toEqual([
      'example.com',
      'www.example.com',
    ]);
  });

  it('uses the requested names while a certificate awaits its CSR', () => {
    expect(getCertDomains(mockAwaitingCsrCert)).toEqual([
      'app.example.com',
      'api.example.com',
    ]);
  });

  it('returns nothing when there is neither', () => {
    expect(
      getCertDomains({
        ...mockAwaitingCsrCert,
        requestedNames: null,
      }),
    ).toEqual([]);
  });
});

describe('status mappings', () => {
  it('labels and orders awaiting_csr', () => {
    expect(STATUS_LABEL[CertStatus.AWAITING_CSR]).toBe('Awaiting CSR');
    expect(STATUS_ORDER[CertStatus.AWAITING_CSR]).toBeLessThan(
      STATUS_ORDER[CertStatus.PENDING],
    );
  });
});

describe('parseNameList', () => {
  it('splits on lines, commas and spaces, lowercases and drops duplicates', () => {
    expect(
      parseNameList(
        'App.Example.com, *.example.com\napp.example.com  www.example.com.',
      ),
    ).toEqual({
      names: ['app.example.com', '*.example.com', 'www.example.com'],
      invalid: [],
    });
  });

  it('lists entries that are not DNS names', () => {
    expect(
      parseNameList(
        'ok.example.com\nlocalhost\nbad_name.example.com\n*.*.example.com\n-a.example.com',
      ).invalid,
    ).toEqual([
      'localhost',
      'bad_name.example.com',
      '*.*.example.com',
      '-a.example.com',
    ]);
  });

  it('returns nothing for blank text', () => {
    expect(parseNameList(' \n , ')).toEqual({ names: [], invalid: [] });
  });
});
