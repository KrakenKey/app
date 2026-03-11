import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DomainMonitorService } from './domain-monitor.service';
import { DomainsService } from '../domains.service';
import { Domain } from '../entities/domain.entity';
import { EmailService } from '../../notifications/email.service';

describe('DomainMonitorService', () => {
  let service: DomainMonitorService;
  let mockRepository: Record<string, jest.Mock>;
  let mockDomainsService: Record<string, jest.Mock>;
  let mockEmailService: Record<string, jest.Mock>;

  const verifiedDomain: Domain = {
    id: 'd1',
    hostname: 'example.com',
    verificationCode: 'krakenkey-site-verification=abc',
    isVerified: true,
    userId: 'u1',
    owner: {
      id: 'u1',
      username: 'testuser',
      email: 'test@example.com',
      groups: [],
      displayName: null,
      createdAt: new Date(),
      apiKeys: [],
      tlsCrts: [],
      notificationPreferences: {},
      autoRenewalConfirmedAt: new Date(),
      autoRenewalReminderSentAt: null,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockRepository = {
      find: jest.fn(),
      update: jest.fn(),
    };

    mockDomainsService = {
      checkVerificationRecord: jest.fn(),
    };

    mockEmailService = {
      sendDomainVerificationFailed: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DomainMonitorService,
        {
          provide: getRepositoryToken(Domain),
          useValue: mockRepository,
        },
        {
          provide: DomainsService,
          useValue: mockDomainsService,
        },
        {
          provide: EmailService,
          useValue: mockEmailService,
        },
      ],
    }).compile();

    service = module.get<DomainMonitorService>(DomainMonitorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkVerifiedDomains', () => {
    it('does nothing when TXT records are still present', async () => {
      mockRepository.find.mockResolvedValue([verifiedDomain]);
      mockDomainsService.checkVerificationRecord.mockResolvedValue(true);

      await service.checkVerifiedDomains();

      expect(mockRepository.update).not.toHaveBeenCalled();
      expect(
        mockEmailService.sendDomainVerificationFailed,
      ).not.toHaveBeenCalled();
    });

    it('marks domain as unverified and sends email when TXT record is missing', async () => {
      mockRepository.find.mockResolvedValue([verifiedDomain]);
      mockDomainsService.checkVerificationRecord.mockResolvedValue(false);

      await service.checkVerifiedDomains();

      expect(mockRepository.update).toHaveBeenCalledWith('d1', {
        isVerified: false,
      });
      expect(
        mockEmailService.sendDomainVerificationFailed,
      ).toHaveBeenCalledWith({
        userId: 'u1',
        username: 'testuser',
        email: 'test@example.com',
        hostname: 'example.com',
        verificationCode: 'krakenkey-site-verification=abc',
      });
    });

    it('skips email when domain has no owner', async () => {
      const domainNoOwner = {
        ...verifiedDomain,
        owner: undefined as any,
      };
      mockRepository.find.mockResolvedValue([domainNoOwner]);
      mockDomainsService.checkVerificationRecord.mockResolvedValue(false);

      await service.checkVerifiedDomains();

      expect(mockRepository.update).toHaveBeenCalledWith('d1', {
        isVerified: false,
      });
      expect(
        mockEmailService.sendDomainVerificationFailed,
      ).not.toHaveBeenCalled();
    });

    it('continues processing other domains when one errors', async () => {
      const domain2 = { ...verifiedDomain, id: 'd2', hostname: 'other.com' };
      mockRepository.find.mockResolvedValue([verifiedDomain, domain2]);
      mockDomainsService.checkVerificationRecord
        .mockRejectedValueOnce(new Error('DNS fail'))
        .mockResolvedValueOnce(false);

      await service.checkVerifiedDomains();

      // First domain errored, second was processed
      expect(mockRepository.update).toHaveBeenCalledWith('d2', {
        isVerified: false,
      });
    });

    it('handles empty list of verified domains', async () => {
      mockRepository.find.mockResolvedValue([]);

      await service.checkVerifiedDomains();

      expect(mockDomainsService.checkVerificationRecord).not.toHaveBeenCalled();
      expect(mockRepository.update).not.toHaveBeenCalled();
    });
  });
});
