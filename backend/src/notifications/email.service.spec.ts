import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as nodemailer from 'nodemailer';
import { EmailService } from './email.service';
import type { CertEmailContext, DomainVerificationFailedContext } from './email.service';
import { User } from '../users/entities/user.entity';
// Use string literals to avoid barrel re-export resolution issues in Jest
const NotificationType = {
  CERT_ISSUED: 'cert_issued',
  CERT_RENEWED: 'cert_renewed',
  CERT_FAILED: 'cert_failed',
  CERT_EXPIRY_WARNING: 'cert_expiry_warning',
  CERT_REVOKED: 'cert_revoked',
  DOMAIN_VERIFICATION_FAILED: 'domain_verification_failed',
} as const;

jest.mock('nodemailer');

describe('EmailService', () => {
  let service: EmailService;
  let mockSendMail: jest.Mock;
  let mockUserRepo: Record<string, jest.Mock>;
  let mockConfigService: Record<string, jest.Mock>;

  const certCtx: CertEmailContext = {
    userId: 'u1',
    username: 'testuser',
    email: 'test@example.com',
    certId: 42,
    commonName: 'example.com',
    expiresAt: new Date('2027-01-01'),
  };

  const domainCtx: DomainVerificationFailedContext = {
    userId: 'u1',
    username: 'testuser',
    email: 'test@example.com',
    hostname: 'example.com',
    verificationCode: 'krakenkey-site-verification=abc',
  };

  beforeEach(async () => {
    mockSendMail = jest.fn().mockResolvedValue(undefined);
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: mockSendMail,
    });

    mockUserRepo = {
      findOne: jest.fn(),
    };

    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          KK_SMTP_HOST: 'smtp.example.com',
          KK_SMTP_PORT: 587,
          KK_SMTP_USER: 'user',
          KK_SMTP_PASSWORD: 'pass',
          KK_SMTP_FROM: 'KrakenKey <noreply@krakenkey.io>',
        };
        return config[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('creates transport when KK_SMTP_HOST is configured', () => {
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'smtp.example.com' }),
      );
    });

    it('does not create transport when KK_SMTP_HOST is missing', async () => {
      (nodemailer.createTransport as jest.Mock).mockClear();
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'KK_SMTP_HOST') return undefined;
        return undefined;
      });

      const module = await Test.createTestingModule({
        providers: [
          EmailService,
          { provide: ConfigService, useValue: mockConfigService },
          { provide: getRepositoryToken(User), useValue: mockUserRepo },
        ],
      }).compile();

      const svc = module.get<EmailService>(EmailService);
      expect(svc).toBeDefined();
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });
  });

  describe('shouldSend (preference guard)', () => {
    it('sends when user has no preferences set (opt-out model)', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'u1',
        notificationPreferences: {},
      });

      await service.sendCertIssued(certCtx);

      expect(mockSendMail).toHaveBeenCalled();
    });

    it('sends when preference is explicitly true', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'u1',
        notificationPreferences: { cert_issued: true },
      });

      await service.sendCertIssued(certCtx);

      expect(mockSendMail).toHaveBeenCalled();
    });

    it('skips when preference is explicitly false', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'u1',
        notificationPreferences: { cert_issued: false },
      });

      await service.sendCertIssued(certCtx);

      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('sends when userId is undefined', async () => {
      await service.sendCertIssued({ ...certCtx, userId: undefined });

      expect(mockSendMail).toHaveBeenCalled();
      expect(mockUserRepo.findOne).not.toHaveBeenCalled();
    });

    it('sends when user is not found', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);

      await service.sendCertIssued(certCtx);

      expect(mockSendMail).toHaveBeenCalled();
    });

    it('sends when user repo throws', async () => {
      mockUserRepo.findOne.mockRejectedValue(new Error('DB error'));

      await service.sendCertIssued(certCtx);

      expect(mockSendMail).toHaveBeenCalled();
    });
  });

  describe('send methods', () => {
    beforeEach(() => {
      // All preferences enabled (default)
      mockUserRepo.findOne.mockResolvedValue({
        id: 'u1',
        notificationPreferences: {},
      });
    });

    it('sendCertIssued sends correct subject', async () => {
      await service.sendCertIssued(certCtx);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          subject: 'Certificate issued for example.com',
        }),
      );
    });

    it('sendCertRenewed sends correct subject', async () => {
      await service.sendCertRenewed(certCtx);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          subject: 'Certificate renewed for example.com',
        }),
      );
    });

    it('sendCertExpiryWarning sends correct subject', async () => {
      await service.sendCertExpiryWarning({
        ...certCtx,
        daysUntilExpiry: 14,
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Certificate expiring soon: example.com',
        }),
      );
    });

    it('sendCertFailed sends correct subject', async () => {
      await service.sendCertFailed({
        ...certCtx,
        errorMessage: 'ACME challenge failed',
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Certificate issuance failed for example.com',
        }),
      );
    });

    it('sendCertRevoked sends correct subject', async () => {
      await service.sendCertRevoked(certCtx);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Certificate revoked: example.com',
        }),
      );
    });

    it('sendDomainVerificationFailed sends correct subject', async () => {
      await service.sendDomainVerificationFailed(domainCtx);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Domain verification failed: example.com',
        }),
      );
    });
  });

  describe('preference guard per notification type', () => {
    const cases: [string, keyof EmailService, (typeof NotificationType)[keyof typeof NotificationType], any][] = [
      ['sendCertIssued', 'sendCertIssued', NotificationType.CERT_ISSUED, certCtx],
      ['sendCertRenewed', 'sendCertRenewed', NotificationType.CERT_RENEWED, certCtx],
      [
        'sendCertExpiryWarning',
        'sendCertExpiryWarning',
        NotificationType.CERT_EXPIRY_WARNING,
        certCtx,
      ],
      ['sendCertFailed', 'sendCertFailed', NotificationType.CERT_FAILED, certCtx],
      ['sendCertRevoked', 'sendCertRevoked', NotificationType.CERT_REVOKED, certCtx],
      [
        'sendDomainVerificationFailed',
        'sendDomainVerificationFailed',
        NotificationType.DOMAIN_VERIFICATION_FAILED,
        domainCtx,
      ],
    ];

    it.each(cases)(
      '%s respects its notification type preference',
      async (_name, method, type, ctx) => {
        mockUserRepo.findOne.mockResolvedValue({
          id: 'u1',
          notificationPreferences: { [type]: false },
        });

        await (service[method] as Function)(ctx);

        expect(mockSendMail).not.toHaveBeenCalled();
      },
    );
  });

  describe('transport errors', () => {
    it('does not throw when sendMail fails', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'u1',
        notificationPreferences: {},
      });
      mockSendMail.mockRejectedValue(new Error('SMTP connection failed'));

      await expect(service.sendCertIssued(certCtx)).resolves.not.toThrow();
    });

    it('skips silently when no SMTP transport configured', async () => {
      (nodemailer.createTransport as jest.Mock).mockClear();
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: any) => {
          if (key === 'KK_SMTP_HOST') return undefined;
          return defaultValue;
        },
      );

      const module = await Test.createTestingModule({
        providers: [
          EmailService,
          { provide: ConfigService, useValue: mockConfigService },
          { provide: getRepositoryToken(User), useValue: mockUserRepo },
        ],
      }).compile();

      const svc = module.get<EmailService>(EmailService);
      mockUserRepo.findOne.mockResolvedValue({
        id: 'u1',
        notificationPreferences: {},
      });

      await expect(svc.sendCertIssued(certCtx)).resolves.not.toThrow();
      expect(mockSendMail).not.toHaveBeenCalled();
    });
  });
});
