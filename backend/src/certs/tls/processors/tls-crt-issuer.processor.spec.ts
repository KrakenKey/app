import { CertIssuerConsumer } from './tls-crt-issuer.processor';
import { MetricsService } from '../../../metrics/metrics.service';
import { EmailService } from '../../../notifications/email.service';
import { TlsService } from '../tls.service';

describe('CertIssuerConsumer', () => {
  const mockAlerts = { emit: jest.fn().mockResolvedValue(0) };
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
    sendCertRenewalFailed: jest.fn(),
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
      startQueuedRenewalsSafely: jest.fn().mockResolvedValue([]),
      beginProcessing: jest.fn().mockResolvedValue(true),
      finishProcessing: jest.fn().mockResolvedValue(true),
      recoverAfterFailedJob: jest.fn().mockResolvedValue(undefined),
      // The real notifications, with this spec's email and alert mocks
      notifyFailure: jest.fn((cert: unknown, failure: unknown) =>
        TlsService.prototype.notifyFailure.call(
          {
            emailService: mockEmailService,
            alerts: mockAlerts,
            userRepo: { findOne: jest.fn().mockResolvedValue(null) },
            // The daily email limit is covered in tls.renewal-queue.spec.ts
            claimRenewalFailedEmail: () => Promise.resolve(true),
          },
          cert as any,
          failure as any,
        ),
      ),
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
      mockAlerts as any,
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
      // No owner on this record: emit is still called and skips internally.
      expect(mockAlerts.emit).toHaveBeenCalledWith(
        undefined,
        'cert.issued',
        expect.objectContaining({ resource: { type: 'certificate', id: 1 } }),
      );
      expect(mockTlsService.findOneInternal).toHaveBeenCalledWith(1, {
        relations: ['user'],
      });
      expect(mockTlsService.beginProcessing).toHaveBeenCalledWith(1, {
        renewal: false,
        token: undefined,
        status: 'issuing',
      });
      expect(mockAcme.issue).toHaveBeenCalled();
      expect(mockTlsService.finishProcessing).toHaveBeenCalledWith(
        1,
        expect.anything(),
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

      expect(mockTlsService.finishProcessing).toHaveBeenCalledWith(
        1,
        expect.anything(),
        expect.objectContaining({
          lastRenewedAt: expect.any(Date),
        }),
        'issued',
      );
    });

    it('starts a renewal only from the state and token it was queued with', async () => {
      await processor.process({
        name: 'tlsCertRenewal',
        data: { certId: 1, inFlightSince: 1791928512378 },
      } as any);
      expect(mockTlsService.beginProcessing).toHaveBeenCalledWith(1, {
        renewal: true,
        token: 1791928512378,
        status: 'renewing',
      });
    });

    it('drops a stale or duplicate job without touching the certificate', async () => {
      mockTlsService.beginProcessing.mockResolvedValue(false);

      const result = await processor.process({
        name: 'tlsCertRenewal',
        data: { certId: 1, inFlightSince: 1 },
      } as any);

      expect(result).toEqual({ success: false });
      expect(mockAcme.issue).not.toHaveBeenCalled();
      expect(mockTlsService.finishProcessing).not.toHaveBeenCalled();
      expect(mockTlsService.startQueuedRenewalsSafely).not.toHaveBeenCalled();
    });

    it('clears inFlightSince when the certificate is issued', async () => {
      await processor.process({
        name: 'tlsCertIssuance',
        data: { certId: 1 },
      } as any);
      expect(mockTlsService.finishProcessing).toHaveBeenCalledWith(
        1,
        expect.anything(),
        expect.objectContaining({ inFlightSince: null }),
        'issued',
      );
    });

    it("starts the owner's next queued renewal once a job succeeds", async () => {
      mockTlsService.findOneInternal.mockResolvedValue({
        ...mockCsrRecord,
        userId: 'owner-1',
      });
      await processor.process({
        name: 'tlsCertIssuance',
        data: { certId: 1 },
      } as any);
      expect(mockTlsService.startQueuedRenewalsSafely).toHaveBeenCalledTimes(1);
      expect(mockTlsService.startQueuedRenewalsSafely).toHaveBeenCalledWith(
        'owner-1',
      );
    });

    it('tells the CA which certificate a renewal replaces', async () => {
      mockTlsService.findOneInternal.mockResolvedValue({
        ...mockCsrRecord,
        ariCertId: 'aYhba4dGQEHhs3uEe6CuLN4ByNQ.AIdlQyE',
      });
      await processor.process({
        name: 'tlsCertRenewal',
        data: { certId: 1 },
      } as any);
      expect(mockAcme.issue).toHaveBeenCalledWith(
        mockCsrRecord.rawCsr,
        mockDns,
        { replaces: 'aYhba4dGQEHhs3uEe6CuLN4ByNQ.AIdlQyE' },
      );
    });

    it('does not send replaces for a first issuance', async () => {
      mockTlsService.findOneInternal.mockResolvedValue({
        ...mockCsrRecord,
        ariCertId: 'stale.id',
      });
      await processor.process({
        name: 'tlsCertIssuance',
        data: { certId: 1 },
      } as any);
      expect(mockAcme.issue).toHaveBeenCalledWith(
        mockCsrRecord.rawCsr,
        mockDns,
        { replaces: null },
      );
    });

    it('resets ARI state for the new certificate', async () => {
      await processor.process({
        name: 'tlsCertRenewal',
        data: { certId: 1 },
      } as any);
      expect(mockTlsService.finishProcessing).toHaveBeenCalledWith(
        1,
        expect.anything(),
        expect.objectContaining({
          ariWindowStart: null,
          ariWindowEnd: null,
          ariNextCheckAt: null,
          ariReplacementRequestedAt: null,
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
      expect(mockTlsService.finishProcessing).toHaveBeenCalledWith(
        1,
        expect.anything(),
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

    it('leaves an awaiting_csr certificate alone', async () => {
      mockTlsService.findOneInternal.mockResolvedValue({
        id: 1,
        status: 'awaiting_csr',
        rawCsr: null,
        parsedCsr: null,
        requestedNames: ['example.com'],
      });

      const result = await processor.process({
        name: 'tlsCertIssuance',
        data: { certId: 1 },
      } as any);

      expect(result).toEqual({ success: false });
      expect(mockAcme.issue).not.toHaveBeenCalled();
      expect(mockTlsService.finishProcessing).not.toHaveBeenCalled();
      expect(mockEmailService.sendCertFailed).not.toHaveBeenCalled();
    });

    it('names a certificate without a parsed CSR by its requested names', async () => {
      // A completed pending certificate whose parsedCsr is missing
      mockTlsService.findOneInternal.mockResolvedValue({
        ...mockCsrRecord,
        parsedCsr: null,
        requestedNames: ['app.example.com'],
        userId: 'u1',
      });

      await processor.process({
        name: 'tlsCertIssuance',
        data: { certId: 1 },
      } as any);

      expect(mockAlerts.emit).toHaveBeenCalledWith(
        'u1',
        'cert.issued',
        expect.objectContaining({ subject: 'app.example.com' }),
      );
    });

    it('marks cert as failed when the CSR is missing', async () => {
      mockTlsService.findOneInternal.mockResolvedValue({
        id: 1,
        status: 'pending',
        rawCsr: null,
        parsedCsr: null,
      });

      await expect(
        processor.process({
          name: 'tlsCertIssuance',
          data: { certId: 1 },
        } as any),
      ).rejects.toThrow('CSR appears to be invalid');
      expect(mockAcme.issue).not.toHaveBeenCalled();
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
      expect(mockTlsService.finishProcessing).toHaveBeenCalledWith(
        1,
        expect.anything(),
        expect.objectContaining({
          crtPem: null,
          chainPem: null,
          failureReason: expect.any(String),
        }),
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
      expect(mockTlsService.finishProcessing).toHaveBeenCalledWith(
        1,
        expect.anything(),
        expect.objectContaining({
          crtPem: null,
          chainPem: null,
          failureReason: expect.any(String),
        }),
        'failed',
      );
    });

    it('records the failure reason so the API can return it', async () => {
      const reason =
        'ACME challenge delegation missing: no CNAME found at _acme-challenge.example.com.';
      mockAcme.issue.mockRejectedValue(new Error(reason));

      const job = {
        name: 'tlsCertIssuance',
        data: { certId: 1 },
      } as any;

      await expect(processor.process(job)).rejects.toThrow(reason);
      expect(mockTlsService.finishProcessing).toHaveBeenCalledWith(
        1,
        expect.anything(),
        {
          crtPem: null,
          chainPem: null,
          failureReason: reason,
          inFlightSince: null,
          previousRawCsr: null,
          previousParsedCsr: null,
        },
        'failed',
      );
    });

    it('truncates very long failure reasons', async () => {
      mockAcme.issue.mockRejectedValue(new Error('x'.repeat(5000)));

      const job = {
        name: 'tlsCertIssuance',
        data: { certId: 1 },
      } as any;

      await expect(processor.process(job)).rejects.toThrow();
      const failedCall = mockTlsService.finishProcessing.mock.calls.find(
        (c: unknown[]) => c[3] === 'failed',
      );
      expect(failedCall[2].failureReason).toHaveLength(2000);
    });

    it('handles non-Error ACME failures', async () => {
      mockAcme.issue.mockRejectedValue('string error');

      const job = {
        name: 'tlsCertIssuance',
        data: { certId: 1 },
      } as any;

      await expect(processor.process(job)).rejects.toThrow('string error');
      expect(mockTlsService.finishProcessing).toHaveBeenCalledWith(
        1,
        expect.anything(),
        expect.objectContaining({
          crtPem: null,
          chainPem: null,
          failureReason: expect.any(String),
        }),
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
      expect(mockTlsService.finishProcessing).not.toHaveBeenCalledWith(
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
      expect(mockTlsService.finishProcessing).toHaveBeenCalledWith(
        1,
        expect.anything(),
        expect.objectContaining({
          crtPem: null,
          chainPem: null,
          failureReason: expect.any(String),
        }),
        'failed',
      );
      expect(mockEmailService.sendCertFailed).toHaveBeenCalledTimes(1);
      // The slot is free again: the next queued renewal can start
      expect(mockTlsService.startQueuedRenewalsSafely).toHaveBeenCalledTimes(1);
    });

    it('keeps the slot while a retry will follow', async () => {
      mockTlsService.findOneInternal.mockResolvedValue(userRecord);
      mockAcme.issue.mockRejectedValue(new Error('DNS propagation timeout'));

      await expect(
        processor.process({
          name: 'tlsCertRenewal',
          data: { certId: 1 },
          attemptsMade: 0,
          opts: { attempts: 3 },
        } as any),
      ).rejects.toThrow('DNS propagation timeout');
      expect(mockTlsService.startQueuedRenewalsSafely).not.toHaveBeenCalled();
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
      expect(mockTlsService.finishProcessing).toHaveBeenCalledWith(
        1,
        expect.anything(),
        expect.objectContaining({
          crtPem: null,
          chainPem: null,
          failureReason: expect.any(String),
        }),
        'failed',
      );
      expect(mockEmailService.sendCertFailed).toHaveBeenCalledTimes(1);
    });

    it('treats a missing or wrong challenge CNAME as permanent', async () => {
      mockTlsService.findOneInternal.mockResolvedValue(userRecord);
      mockAcme.issue.mockRejectedValue(
        new Error(
          'ACME challenge delegation mismatch: _acme-challenge.example.com points to example-com.acme.dev.krakenkey.io, expected example-com.acme.krakenkey.io.',
        ),
      );

      const job = {
        name: 'tlsCertRenewal',
        data: { certId: 1 },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as any;

      const err = await processor.process(job).then(
        () => null,
        (e: unknown) => e,
      );
      expect((err as Error).name).toBe('UnrecoverableError');
      expect(mockEmailService.sendCertFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: expect.stringContaining(
            'expected example-com.acme.krakenkey.io',
          ),
        }),
      );
      expect(mockAlerts.emit).toHaveBeenCalledWith(
        expect.anything(),
        'cert.failed',
        expect.objectContaining({
          resource: { type: 'certificate', id: 1 },
          details: expect.objectContaining({
            error: expect.stringContaining('expected example-com'),
          }),
        }),
      );
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

  describe('a renewal that fails for good', () => {
    const inThirtyDays = () => new Date(Date.now() + 30 * 86_400_000);
    const owner = { id: 'user-1', username: 'luke', email: 'luke@example.com' };
    const renewing = (extra: Record<string, unknown> = {}) => ({
      ...mockCsrRecord,
      status: 'renewing',
      crtPem: '-----BEGIN CERTIFICATE-----\nold\n-----END CERTIFICATE-----',
      chainPem: '-----BEGIN CERTIFICATE-----\nchain\n-----END CERTIFICATE-----',
      user: owner,
      userId: owner.id,
      ...extra,
    });
    const finalAttempt = {
      name: 'tlsCertRenewal',
      data: { certId: 1, inFlightSince: 42 },
      attemptsMade: 2,
      opts: { attempts: 3 },
    };

    it('keeps the current certificate and records the failure while it is still valid', async () => {
      const expiresAt = inThirtyDays();
      mockTlsService.findOneInternal.mockResolvedValue(renewing({ expiresAt }));
      mockAcme.issue.mockRejectedValue(new Error('DNS propagation timeout'));

      await expect(processor.process(finalAttempt as any)).rejects.toThrow(
        'DNS propagation timeout',
      );

      // Back to issued, with nothing about the certificate itself touched
      expect(mockTlsService.finishProcessing).toHaveBeenCalledTimes(1);
      expect(mockTlsService.finishProcessing).toHaveBeenCalledWith(
        1,
        { status: 'renewing', token: 42 },
        {
          failureReason: 'DNS propagation timeout',
          renewalFailedAt: expect.any(Date),
          inFlightSince: null,
          previousRawCsr: null,
          previousParsedCsr: null,
        },
        'issued',
      );
      expect(mockEmailService.sendCertRenewalFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          certId: 1,
          email: owner.email,
          expiresAt,
          errorMessage: 'DNS propagation timeout',
        }),
      );
      expect(mockEmailService.sendCertFailed).not.toHaveBeenCalled();
      expect(mockAlerts.emit).toHaveBeenCalledWith(
        owner.id,
        'cert.failed',
        expect.objectContaining({
          details: expect.objectContaining({
            renewal: true,
            currentCertificateExpiresAt: expiresAt.toISOString(),
          }),
        }),
      );
      expect(mockMetricsService.certIssuanceTotal.inc).toHaveBeenCalledWith({
        status: 'failed',
      });
      expect(mockTlsService.startQueuedRenewalsSafely).toHaveBeenCalledTimes(1);
    });

    it('puts back the CSR the kept certificate was issued with', async () => {
      mockTlsService.findOneInternal.mockResolvedValue(
        renewing({
          expiresAt: inThirtyDays(),
          rawCsr: mockCsrRecord.rawCsr,
          previousRawCsr: 'old CSR',
          previousParsedCsr: { subject: [] },
        }),
      );
      mockAcme.issue.mockRejectedValue(new Error('CAA record forbids'));

      await expect(processor.process(finalAttempt as any)).rejects.toThrow();
      expect(mockTlsService.finishProcessing).toHaveBeenCalledWith(
        1,
        expect.anything(),
        expect.objectContaining({
          rawCsr: 'old CSR',
          parsedCsr: { subject: [] },
          previousRawCsr: null,
          previousParsedCsr: null,
        }),
        'issued',
      );
    });

    it('keeps it on a permanent failure too, without more attempts', async () => {
      mockTlsService.findOneInternal.mockResolvedValue(
        renewing({ expiresAt: inThirtyDays() }),
      );
      mockAcme.issue.mockRejectedValue(new Error('CAA record forbids'));

      const err = await processor
        .process({ ...finalAttempt, attemptsMade: 0 } as any)
        .then(
          () => null,
          (e: unknown) => e,
        );

      expect((err as Error).name).toBe('UnrecoverableError');
      expect(mockTlsService.finishProcessing).toHaveBeenCalledWith(
        1,
        expect.anything(),
        expect.not.objectContaining({ crtPem: null }),
        'issued',
      );
    });

    it('marks it failed, as before, once the current certificate has expired', async () => {
      mockTlsService.findOneInternal.mockResolvedValue(
        renewing({ expiresAt: new Date(Date.now() - 60_000) }),
      );
      mockAcme.issue.mockRejectedValue(new Error('DNS propagation timeout'));

      await expect(processor.process(finalAttempt as any)).rejects.toThrow();

      expect(mockTlsService.finishProcessing).toHaveBeenCalledWith(
        1,
        expect.anything(),
        {
          crtPem: null,
          chainPem: null,
          failureReason: 'DNS propagation timeout',
          inFlightSince: null,
          previousRawCsr: null,
          previousParsedCsr: null,
        },
        'failed',
      );
      expect(mockEmailService.sendCertFailed).toHaveBeenCalledTimes(1);
      expect(mockEmailService.sendCertRenewalFailed).not.toHaveBeenCalled();
    });

    it('marks it failed when there is no certificate to keep', async () => {
      mockTlsService.findOneInternal.mockResolvedValue(
        renewing({ crtPem: null, expiresAt: inThirtyDays() }),
      );
      mockAcme.issue.mockRejectedValue(new Error('DNS propagation timeout'));

      await expect(processor.process(finalAttempt as any)).rejects.toThrow();
      expect(mockTlsService.finishProcessing).toHaveBeenCalledWith(
        1,
        expect.anything(),
        expect.objectContaining({ crtPem: null }),
        'failed',
      );
    });

    it("can't overwrite a newer result with its failure", async () => {
      mockTlsService.findOneInternal.mockResolvedValue(
        renewing({ expiresAt: inThirtyDays() }),
      );
      mockTlsService.finishProcessing.mockResolvedValue(false);
      mockAcme.issue.mockRejectedValue(new Error('DNS propagation timeout'));

      await expect(processor.process(finalAttempt as any)).rejects.toThrow();

      expect(mockTlsService.finishProcessing).toHaveBeenCalledWith(
        1,
        { status: 'renewing', token: 42 },
        expect.anything(),
        'issued',
      );
      expect(mockEmailService.sendCertRenewalFailed).not.toHaveBeenCalled();
      expect(mockAlerts.emit).not.toHaveBeenCalled();
    });

    it('clears a recorded failure when a renewal succeeds', async () => {
      mockTlsService.findOneInternal.mockResolvedValue(
        renewing({ expiresAt: inThirtyDays() }),
      );
      await processor.process({
        name: 'tlsCertRenewal',
        data: { certId: 1, inFlightSince: 42 },
      } as any);
      expect(mockTlsService.finishProcessing).toHaveBeenCalledWith(
        1,
        expect.anything(),
        expect.objectContaining({
          crtPem: expect.stringContaining('cert'),
          failureReason: null,
          renewalFailedAt: null,
        }),
        'issued',
      );
    });
  });

  describe('a job that was taken over (stalled and replaced)', () => {
    it('records its result only while the certificate is still its own', async () => {
      await processor.process({
        name: 'tlsCertRenewal',
        data: { certId: 1, inFlightSince: 42 },
      } as any);
      expect(mockTlsService.finishProcessing).toHaveBeenCalledWith(
        1,
        { status: 'renewing', token: 42 },
        expect.objectContaining({ recoveryCount: 0, inFlightSince: null }),
        'issued',
      );
    });

    it('sends nothing when its success no longer matches the certificate', async () => {
      mockTlsService.finishProcessing.mockResolvedValue(false);

      const result = await processor.process({
        name: 'tlsCertRenewal',
        data: { certId: 1, inFlightSince: 42 },
      } as any);

      expect(result).toEqual({ success: false });
      expect(mockEmailService.sendCertRenewed).not.toHaveBeenCalled();
      expect(mockAlerts.emit).not.toHaveBeenCalled();
      expect(mockTlsService.startQueuedRenewalsSafely).not.toHaveBeenCalled();
    });

    it("can't overwrite the new job's result with its failure", async () => {
      mockTlsService.finishProcessing.mockResolvedValue(false);
      mockAcme.issue.mockRejectedValue(new Error('CAA record forbids'));

      await expect(
        processor.process({
          name: 'tlsCertRenewal',
          data: { certId: 1, inFlightSince: 42 },
          attemptsMade: 2,
          opts: { attempts: 3 },
        } as any),
      ).rejects.toThrow('CAA record forbids');

      expect(mockTlsService.finishProcessing).toHaveBeenCalledWith(
        1,
        { status: 'renewing', token: 42 },
        expect.objectContaining({ crtPem: null }),
        'failed',
      );
      expect(mockEmailService.sendCertFailed).not.toHaveBeenCalled();
      expect(mockAlerts.emit).not.toHaveBeenCalled();
      expect(mockMetricsService.certIssuanceTotal.inc).not.toHaveBeenCalledWith(
        {
          status: 'failed',
        },
      );
    });
  });

  describe('failed event', () => {
    it('cleans up after a final failure, with the job token', async () => {
      await processor.onFailed(
        {
          data: { certId: 7, inFlightSince: 123 },
          finishedOn: Date.now(),
        } as any,
        new Error('database unreachable'),
      );
      expect(mockTlsService.recoverAfterFailedJob).toHaveBeenCalledWith(
        7,
        123,
        'database unreachable',
      );
    });

    it('does nothing when a retry follows', async () => {
      await processor.onFailed(
        { data: { certId: 7 }, finishedOn: undefined } as any,
        new Error('DNS propagation timeout'),
      );
      expect(mockTlsService.recoverAfterFailedJob).not.toHaveBeenCalled();
    });

    it('never throws from the event handler', async () => {
      mockTlsService.recoverAfterFailedJob.mockRejectedValue(new Error('db'));
      await expect(
        processor.onFailed(
          { data: { certId: 7 }, finishedOn: 1 } as any,
          new Error('x'),
        ),
      ).resolves.toBeUndefined();
    });
  });
});
