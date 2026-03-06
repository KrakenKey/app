import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CertMonitorService } from './cert-monitor.service';
import { TlsService } from '../tls.service';
import { TlsCrt } from '../entities/tls-crt.entity';
import { CertStatus } from '@krakenkey/shared';
import { MetricsService } from '../../../metrics/metrics.service';

describe('CertMonitorService', () => {
  let service: CertMonitorService;
  let mockRepository: Record<string, jest.Mock>;
  let mockTlsService: Record<string, jest.Mock>;

  const expiringCert = {
    id: 1,
    status: 'issued',
    autoRenew: true,
    expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
  } as TlsCrt;

  beforeEach(async () => {
    mockRepository = {
      find: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    };

    mockTlsService = {
      renewInternal: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertMonitorService,
        {
          provide: getRepositoryToken(TlsCrt),
          useValue: mockRepository,
        },
        {
          provide: TlsService,
          useValue: mockTlsService,
        },
        {
          provide: MetricsService,
          useValue: {
            activeCertificatesTotal: { set: jest.fn() },
            certExpiryDays: { set: jest.fn() },
          },
        },
      ],
    }).compile();

    service = module.get<CertMonitorService>(CertMonitorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkExpiringCertificates', () => {
    it('queues renewal for expiring certs', async () => {
      mockRepository.find.mockResolvedValue([expiringCert]);
      mockTlsService.renewInternal.mockResolvedValue(undefined);

      await service.checkExpiringCertificates();

      expect(mockTlsService.renewInternal).toHaveBeenCalledWith(1);
    });

    it('queries for issued, auto-renew certs expiring within 30 days', async () => {
      mockRepository.find.mockResolvedValue([]);

      await service.checkExpiringCertificates();

      expect(mockRepository.find).toHaveBeenCalledWith({
        where: {
          status: CertStatus.ISSUED,
          autoRenew: true,
          expiresAt: expect.any(Object), // LessThan(threshold)
        },
      });
    });

    it('handles no expiring certs', async () => {
      mockRepository.find.mockResolvedValue([]);

      await service.checkExpiringCertificates();

      expect(mockTlsService.renewInternal).not.toHaveBeenCalled();
    });

    it('continues processing when one renewal fails', async () => {
      const cert2 = { ...expiringCert, id: 2 } as TlsCrt;
      mockRepository.find.mockResolvedValue([expiringCert, cert2]);
      mockTlsService.renewInternal
        .mockRejectedValueOnce(new Error('Queue full'))
        .mockResolvedValueOnce(undefined);

      await service.checkExpiringCertificates();

      expect(mockTlsService.renewInternal).toHaveBeenCalledTimes(2);
      expect(mockTlsService.renewInternal).toHaveBeenCalledWith(1);
      expect(mockTlsService.renewInternal).toHaveBeenCalledWith(2);
    });

    it('processes multiple expiring certs in order', async () => {
      const certs = [
        { ...expiringCert, id: 10 },
        { ...expiringCert, id: 20 },
        { ...expiringCert, id: 30 },
      ] as TlsCrt[];
      mockRepository.find.mockResolvedValue(certs);
      mockTlsService.renewInternal.mockResolvedValue(undefined);

      await service.checkExpiringCertificates();

      expect(mockTlsService.renewInternal).toHaveBeenCalledTimes(3);
      expect(mockTlsService.renewInternal).toHaveBeenNthCalledWith(1, 10);
      expect(mockTlsService.renewInternal).toHaveBeenNthCalledWith(2, 20);
      expect(mockTlsService.renewInternal).toHaveBeenNthCalledWith(3, 30);
    });
  });
});
