import { CertIssuerConsumer } from './tls-crt-issuer.processor';

describe('CertIssuerConsumer', () => {
  let processor: CertIssuerConsumer;
  let mockTlsService: Record<string, jest.Mock>;
  let mockAcme: Record<string, jest.Mock>;
  let mockDns: any;
  let mockCsrUtil: Record<string, jest.Mock>;
  let mockCertUtil: Record<string, jest.Mock>;

  const mockCsrRecord = {
    id: 1,
    rawCsr: '-----BEGIN CERTIFICATE REQUEST-----\nfakedata\n-----END CERTIFICATE REQUEST-----',
    status: 'pending',
  };

  beforeEach(() => {
    mockTlsService = {
      findOneInternal: jest.fn().mockResolvedValue(mockCsrRecord),
      updateInternal: jest.fn().mockResolvedValue({}),
    };
    mockAcme = {
      issue: jest.fn().mockResolvedValue('-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----'),
    };
    mockDns = {};
    mockCsrUtil = {
      formatPem: jest.fn().mockReturnValue(mockCsrRecord.rawCsr),
    };
    mockCertUtil = {
      getExpirationDate: jest.fn().mockReturnValue(new Date('2027-01-01')),
    };

    processor = new CertIssuerConsumer(
      mockTlsService as any,
      mockAcme as any,
      mockDns,
      mockCsrUtil as any,
      mockCertUtil as any,
    );
  });

  describe('process', () => {
    it('issues a new certificate', async () => {
      const job = {
        name: 'tlsCertIssuance',
        data: { certId: 1 },
      } as any;

      const result = await processor.process(job);

      expect(result).toEqual({ success: true });
      expect(mockTlsService.findOneInternal).toHaveBeenCalledWith(1);
      expect(mockTlsService.updateInternal).toHaveBeenCalledWith(
        1,
        { crtPem: null },
        'issuing',
      );
      expect(mockAcme.issue).toHaveBeenCalled();
      expect(mockTlsService.updateInternal).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          crtPem: expect.any(String),
          expiresAt: expect.any(Date),
        }),
        'issued',
      );
    });

    it('sets lastRenewedAt for renewal jobs', async () => {
      const job = {
        name: 'tlsCertRenewal',
        data: { certId: 1 },
      } as any;

      await processor.process(job);

      expect(mockTlsService.updateInternal).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          lastRenewedAt: expect.any(Date),
        }),
        'issued',
      );
    });

    it('throws when CSR not found', async () => {
      mockTlsService.findOneInternal.mockResolvedValue(null);

      const job = {
        name: 'tlsCertIssuance',
        data: { certId: 999 },
      } as any;

      await expect(processor.process(job)).rejects.toThrow(
        'CSR with ID 999 not found',
      );
    });

    it('marks cert as failed when CSR has no PEM delimiters', async () => {
      mockTlsService.findOneInternal.mockResolvedValue({
        id: 1,
        rawCsr: 'invalid-csr-no-pem',
      });

      const job = {
        name: 'tlsCertIssuance',
        data: { certId: 1 },
      } as any;

      await expect(processor.process(job)).rejects.toThrow(
        'CSR appears to be invalid',
      );
      expect(mockTlsService.updateInternal).toHaveBeenCalledWith(
        1,
        { crtPem: null },
        'failed',
      );
    });

    it('marks cert as failed when ACME issuance fails', async () => {
      mockAcme.issue.mockRejectedValue(new Error('ACME timeout'));

      const job = {
        name: 'tlsCertIssuance',
        data: { certId: 1 },
      } as any;

      await expect(processor.process(job)).rejects.toThrow('ACME timeout');
      expect(mockTlsService.updateInternal).toHaveBeenCalledWith(
        1,
        { crtPem: null },
        'failed',
      );
    });

    it('handles non-Error ACME failures', async () => {
      mockAcme.issue.mockRejectedValue('string error');

      const job = {
        name: 'tlsCertIssuance',
        data: { certId: 1 },
      } as any;

      await expect(processor.process(job)).rejects.toThrow(
        'Unknown error processing certificate',
      );
    });
  });
});
