import { CertIssuerConsumer } from './tls-crt-issuer.processor';
import { MetricsService } from '../../../metrics/metrics.service';
import { EmailService } from '../../../notifications/email.service';

describe('CertIssuerConsumer', () => {
  let processor: CertIssuerConsumer;
  let mockTlsService: Record<string, jest.Mock>;
  let mockAcme: Record<string, jest.Mock>;
  let mockDns: any;
  let mockCsrUtil: Record<string, jest.Mock>;
  let mockCertUtil: Record<string, jest.Mock>;
  const mockMetricsService = {
    certIssuanceTotal: { inc: jest.fn() },
  } as unknown as MetricsService;
  const mockEmailService = {
    sendCertIssued: jest.fn(),
    sendCertRenewed: jest.fn(),
    sendCertFailed: jest.fn(),
  } as unknown as EmailService;

  const mockCsrRecord = {
    id: 1,
    rawCsr:
      '-----BEGIN CERTIFICATE REQUEST-----\nfakedata\n-----END CERTIFICATE REQUEST-----',
    status: 'pending',
  };

  beforeEach(() => {
    jest.clearAllMocks(); // the metrics/email mocks are module-scoped
    mockTlsService = {
      findOneInternal: jest.fn().mockResolvedValue(mockCsrRecord),
      updateInternal: jest.fn().mockResolvedValue({}),
    };
    mockAcme = {
      issue: jest
        .fn()
        .mockResolvedValue(
          '-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----',
        ),
    };
    mockDns = {};
    mockCsrUtil = {
      formatPem: jest.fn().mockReturnValue(mockCsrRecord.rawCsr),
    };
    mockCertUtil = {
      getExpirationDate: jest.fn().mockReturnValue(new Date('2027-01-01')),
      splitChain: jest.fn().mockReturnValue({
        leaf: '-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----',
        intermediates: null,
      }),
    };

    const mockUserRepo = {
      findOneBy: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
    };

    processor = new CertIssuerConsumer(
      mockTlsService as any,
      mockAcme as any,
      mockDns,
      mockCsrUtil as any,
      mockCertUtil as any,
      mockMetricsService,
      mockEmailService,
      mockUserRepo as any,
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
      expect(mockTlsService.findOneInternal).toHaveBeenCalledWith(1, {
        relations: ['user'],
      });
      expect(mockTlsService.updateInternal).toHaveBeenCalledWith(
        1,
        { crtPem: null, chainPem: null },
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

    it('stores leaf and chain separately when ACME returns full chain', async () => {
      mockAcme.issue.mockResolvedValue(
        '-----BEGIN CERTIFICATE-----\nleaf\n-----END CERTIFICATE-----\n-----BEGIN CERTIFICATE-----\nintermediate\n-----END CERTIFICATE-----',
      );
      mockCertUtil.splitChain.mockReturnValue({
        leaf: '-----BEGIN CERTIFICATE-----\nleaf\n-----END CERTIFICATE-----',
        intermediates:
          '-----BEGIN CERTIFICATE-----\nintermediate\n-----END CERTIFICATE-----',
      });

      const job = {
        name: 'tlsCertIssuance',
        data: { certId: 1 },
      } as any;

      await processor.process(job);

      expect(mockCertUtil.splitChain).toHaveBeenCalledWith(
        '-----BEGIN CERTIFICATE-----\nleaf\n-----END CERTIFICATE-----\n-----BEGIN CERTIFICATE-----\nintermediate\n-----END CERTIFICATE-----',
      );
      expect(mockTlsService.updateInternal).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          crtPem:
            '-----BEGIN CERTIFICATE-----\nleaf\n-----END CERTIFICATE-----',
          chainPem:
            '-----BEGIN CERTIFICATE-----\nintermediate\n-----END CERTIFICATE-----',
          expiresAt: expect.any(Date),
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
        { crtPem: null, chainPem: null },
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
        { crtPem: null, chainPem: null },
        'failed',
      );
    });

    it('handles non-Error ACME failures', async () => {
      mockAcme.issue.mockRejectedValue('string error');

      const job = {
        name: 'tlsCertIssuance',
        data: { certId: 1 },
      } as any;

      await expect(processor.process(job)).rejects.toThrow('string error');
      expect(mockTlsService.updateInternal).toHaveBeenCalledWith(
        1,
        { crtPem: null, chainPem: null },
        'failed',
      );
    });
  });

  describe('retry semantics', () => {
    const userRecord = {
      ...mockCsrRecord,
      user: { id: 'user-1', username: 'luke', email: 'luke@example.com' },
    };

    it('keeps in-progress status and stays quiet when a transient error will retry', async () => {
      mockTlsService.findOneInternal.mockResolvedValue(userRecord);
      mockAcme.issue.mockRejectedValue(new Error('DNS propagation timeout'));

      const job = {
        name: 'tlsCertIssuance',
        data: { certId: 1 },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as any;

      await expect(processor.process(job)).rejects.toThrow(
        'DNS propagation timeout',
      );
      // No failure bookkeeping mid-retry:
      expect(mockTlsService.updateInternal).not.toHaveBeenCalledWith(
        1,
        expect.anything(),
        'failed',
      );
      expect(mockEmailService.sendCertFailed).not.toHaveBeenCalled();
      expect(
        (mockMetricsService.certIssuanceTotal.inc as jest.Mock).mock.calls,
      ).not.toContainEqual([{ status: 'failed' }]);
    });

    it('marks failed and emails the owner once on the final transient attempt', async () => {
      mockTlsService.findOneInternal.mockResolvedValue(userRecord);
      mockAcme.issue.mockRejectedValue(new Error('DNS propagation timeout'));

      const job = {
        name: 'tlsCertIssuance',
        data: { certId: 1 },
        attemptsMade: 2,
        opts: { attempts: 3 },
      } as any;

      const err = await processor.process(job).then(
        () => null,
        (e: unknown) => e,
      );
      expect((err as Error).message).toBe('DNS propagation timeout');
      expect((err as Error).name).not.toBe('UnrecoverableError');
      expect(mockTlsService.updateInternal).toHaveBeenCalledWith(
        1,
        { crtPem: null, chainPem: null },
        'failed',
      );
      expect(mockEmailService.sendCertFailed).toHaveBeenCalledTimes(1);
    });

    it('aborts retries via UnrecoverableError for permanent ACME rejections', async () => {
      mockTlsService.findOneInternal.mockResolvedValue(userRecord);
      mockAcme.issue.mockRejectedValue(
        new Error(
          'Error creating new order :: too many certificates already issued for "example.com"',
        ),
      );

      const job = {
        name: 'tlsCertIssuance',
        data: { certId: 1 },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as any;

      const err = await processor.process(job).then(
        () => null,
        (e: unknown) => e,
      );
      expect((err as Error).name).toBe('UnrecoverableError');
      expect(mockTlsService.updateInternal).toHaveBeenCalledWith(
        1,
        { crtPem: null, chainPem: null },
        'failed',
      );
      expect(mockEmailService.sendCertFailed).toHaveBeenCalledTimes(1);
    });

    it('treats invalid CSR as permanent even with retries remaining', async () => {
      mockTlsService.findOneInternal.mockResolvedValue({
        ...userRecord,
        rawCsr: 'invalid-csr-no-pem',
      });

      const job = {
        name: 'tlsCertIssuance',
        data: { certId: 1 },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as any;

      const err = await processor.process(job).then(
        () => null,
        (e: unknown) => e,
      );
      expect((err as Error).name).toBe('UnrecoverableError');
      expect((err as Error).message).toMatch(/CSR appears to be invalid/);
      expect(mockEmailService.sendCertFailed).toHaveBeenCalledTimes(1);
    });
  });
});
