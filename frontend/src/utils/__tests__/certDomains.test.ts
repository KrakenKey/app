import { describe, expect, it } from 'vitest';
import { CertStatus } from '@krakenkey/shared';
import { getCertDomains } from '../certDomains';
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
