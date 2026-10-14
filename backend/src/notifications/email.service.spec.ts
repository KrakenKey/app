import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as nodemailer from 'nodemailer';
import { EmailService } from './email.service';
import type {
  CertEmailContext,
  DomainVerificationFailedContext,
  DeployFailedContext,
  ConnectorStaleContext,
} from './email.service';
import { User } from '../users/entities/user.entity';
// Use string literals to avoid barrel re-export resolution issues in Jest
const NotificationType = {
  CERT_ISSUED: 'cert_issued',
  CERT_RENEWED: 'cert_renewed',
  CERT_FAILED: 'cert_failed',
  CERT_EXPIRY_WARNING: 'cert_expiry_warning',
  CERT_REVOKED: 'cert_revoked',
  DOMAIN_VERIFICATION_FAILED: 'domain_verification_failed',
  DEPLOY_FAILED: 'deploy_failed',
  CONNECTOR_STALE: 'connector_stale',
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

  const deployCtx: DeployFailedContext = {
    userId: 'u1',
    username: 'testuser',
    email: 'test@example.com',
    connectorName: 'web-01',
    clientLabel: 'Acme',
    failures: [
      {
        certificateId: 7,
        commonName: 'web.example.com',
        label: 'nginx-main',
        state: 'failed',
        error: 'reload_failed',
        serial: '04ab',
      },
    ],
    total: 1,
  };

  const staleCtx: ConnectorStaleContext = {
    userId: 'u1',
    username: 'testuser',
    email: 'test@example.com',
    connectors: [
      {
        name: 'web-01',
        clientLabel: null,
        lastSeenAt: new Date(Date.now() - 30 * 3600_000 - 60_000),
        version: '0.2.0',
      },
    ],
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

    it('sendCertRenewalFailed says the current certificate stays in place', async () => {
      await service.sendCertRenewalFailed({
        ...certCtx,
        expiresAt: new Date('2026-11-20T00:00:00Z'),
        errorMessage: 'CAA record forbids issuance',
        retryBy: 'krakenkey',
        retryAt: new Date('2026-10-15T02:00:00Z'),
      });

      const mail = mockSendMail.mock.calls[0][0];
      expect(mail.subject).toBe('Certificate renewal failed for example.com');
      expect(mail.text).toContain('stays in place and is valid until');
      expect(mail.text).toContain('CAA record forbids issuance');
      expect(mail.text).toContain('krakenkey cert renew');
      expect(mail.text).toContain('once it is due for renewal, not before');
      expect(mail.text).not.toMatch(/several times/);
    });

    it('sendCertRenewalFailed adapts to replacement requests, connectors and manual renewal', async () => {
      await service.sendCertRenewalFailed({
        ...certCtx,
        expiresAt: new Date('2026-11-20T00:00:00Z'),
        replacementRequested: true,
        retryBy: 'connector',
        retryAt: new Date('2026-10-15T02:00:00Z'),
      });
      await service.sendCertRenewalFailed({ ...certCtx, retryBy: 'manual' });

      const [replace, manual] = mockSendMail.mock.calls.map((c) => c[0].text);
      expect(replace).toContain('the CA has asked for it to be replaced early');
      expect(replace).not.toContain('nothing you have deployed changes');
      expect(replace).toContain('Your connector renews it again');
      expect(manual).toContain('Auto-renewal is off');
      expect(manual).not.toContain('KrakenKey also renews');
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
    const cases: [
      string,
      keyof EmailService,
      (typeof NotificationType)[keyof typeof NotificationType],
      any,
    ][] = [
      [
        'sendCertIssued',
        'sendCertIssued',
        NotificationType.CERT_ISSUED,
        certCtx,
      ],
      [
        'sendCertRenewed',
        'sendCertRenewed',
        NotificationType.CERT_RENEWED,
        certCtx,
      ],
      [
        'sendCertExpiryWarning',
        'sendCertExpiryWarning',
        NotificationType.CERT_EXPIRY_WARNING,
        certCtx,
      ],
      [
        'sendCertFailed',
        'sendCertFailed',
        NotificationType.CERT_FAILED,
        certCtx,
      ],
      [
        'sendCertRenewalFailed',
        'sendCertRenewalFailed',
        NotificationType.CERT_FAILED,
        certCtx,
      ],
      [
        'sendCertRevoked',
        'sendCertRevoked',
        NotificationType.CERT_REVOKED,
        certCtx,
      ],
      [
        'sendDomainVerificationFailed',
        'sendDomainVerificationFailed',
        NotificationType.DOMAIN_VERIFICATION_FAILED,
        domainCtx,
      ],
      [
        'sendDeployFailed',
        'sendDeployFailed',
        NotificationType.DEPLOY_FAILED,
        deployCtx,
      ],
      [
        'sendConnectorStale',
        'sendConnectorStale',
        NotificationType.CONNECTOR_STALE,
        staleCtx,
      ],
    ];

    it.each(cases)(
      '%s respects its notification type preference',
      async (_name, method, type, ctx) => {
        mockUserRepo.findOne.mockResolvedValue({
          id: 'u1',
          notificationPreferences: { [type]: false },
        });

        await (service[method] as (...args: unknown[]) => Promise<void>)(ctx);

        expect(mockSendMail).not.toHaveBeenCalled();
      },
    );
  });

  describe('connector emails', () => {
    const sent = () =>
      mockSendMail.mock.calls[0][0] as {
        subject: string;
        html: string;
        text: string;
      };

    beforeEach(() => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'u1',
        notificationPreferences: {},
      });
    });

    it('describes a single failed deployment', async () => {
      await service.sendDeployFailed(deployCtx);
      const { subject, html, text } = sent();
      expect(subject).toBe('Deployment failed: web.example.com on web-01');
      for (const part of [
        'web-01',
        'Acme',
        'web.example.com',
        'nginx-main',
        'reload_failed',
        '04ab',
      ]) {
        expect(text).toContain(part);
      }
      expect(text).toContain('Failed');
      expect(html).toContain('/dashboard/certificates');
      expect(html).toContain('/settings');
    });

    it('summarises many failures and says how many are not shown', async () => {
      await service.sendDeployFailed({
        ...deployCtx,
        failures: [
          { ...deployCtx.failures[0], state: 'rolled_back' },
          { ...deployCtx.failures[0], label: 'haproxy', commonName: undefined },
        ],
        total: 12,
      });
      const { subject, text } = sent();
      expect(subject).toBe('Deployment failed on 12 targets: web-01');
      expect(text).toContain('Rolled back');
      expect(text).toContain('web.example.com (#7)');
      expect(text).toContain('certificate #7');
      expect(text).toContain('10 more not shown');
    });

    it('mentions failures held back since the last email', async () => {
      await service.sendDeployFailed({ ...deployCtx, heldBack: 3 });
      expect(sent().text).toContain(
        '3 more failed deployments on this connector since the last email',
      );
    });

    it('escapes connector-supplied values', async () => {
      await service.sendDeployFailed({
        ...deployCtx,
        connectorName: '<b>x</b>',
        failures: [{ ...deployCtx.failures[0], error: '<img src=x>' }],
      });
      expect(sent().html).not.toContain('<img src=x>');
      expect(sent().html).not.toContain('<b>x</b>');
    });

    it('lists stale connectors with when they were last seen', async () => {
      await service.sendConnectorStale(staleCtx);
      expect(sent().subject).toBe('Connector not seen for 24 hours: web-01');
      expect(sent().text).toContain('30 hours ago');
      expect(sent().text).toContain('0.2.0');

      mockSendMail.mockClear();
      await service.sendConnectorStale({
        ...staleCtx,
        connectors: [
          ...staleCtx.connectors,
          { name: 'db-01', lastSeenAt: null, clientLabel: 'Acme' },
        ],
      });
      expect(sent().subject).toBe('2 connectors not seen for 24 hours');
      expect(sent().text).toContain('db-01');
      expect(sent().text).toContain('never');
    });
  });

  describe('content and branding', () => {
    const withConfig = (extra: Record<string, unknown>) => {
      const base = mockConfigService.get.getMockImplementation()!;
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: any) =>
          key in extra ? extra[key] : base(key, defaultValue),
      );
    };
    const sent = () =>
      mockSendMail.mock.calls[0][0] as {
        html: string;
        text: string;
        replyTo?: string;
      };

    beforeEach(() => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'u1',
        notificationPreferences: {},
      });
    });

    it('sends a plain-text part alongside the HTML', async () => {
      await service.sendCertIssued(certCtx);

      const { html, text } = sent();
      expect(html).toContain('<!DOCTYPE html>');
      expect(text).toContain('example.com');
      expect(text).toContain('krakenkey cert download 42');
      expect(text).not.toContain('<');
    });

    it('links to the dashboard on KK_APP_DOMAIN', async () => {
      withConfig({ KK_APP_DOMAIN: 'dev-web.krakenkey.io' });

      await service.sendCertIssued(certCtx);

      expect(sent().html).toContain(
        'https://dev-web.krakenkey.io/dashboard/certificates',
      );
      expect(sent().html).not.toContain('app.krakenkey.io');
    });

    it('escapes user-controlled values', async () => {
      await service.sendCertIssued({
        ...certCtx,
        username: '<script>x</script>',
      });

      expect(sent().html).not.toContain('<script>');
      expect(sent().html).toContain('&lt;script&gt;');
    });

    it('omits Reply-To unless KK_SMTP_REPLY_TO is set', async () => {
      await service.sendWelcome(certCtx);
      expect(sent().replyTo).toBeUndefined();

      mockSendMail.mockClear();
      withConfig({ KK_SMTP_REPLY_TO: 'support@krakenkey.io' });
      await service.sendWelcome(certCtx);
      expect(sent().replyTo).toBe('support@krakenkey.io');
    });

    it('links email addresses in body text in the brand color', async () => {
      await service.sendWelcome(certCtx);

      expect(sent().html).toContain(
        '<a href="mailto:support@krakenkey.io" style="color:#0e7490',
      );
    });

    it('shows the postal address in the footer when configured', async () => {
      withConfig({ KK_MAIL_POSTAL_ADDRESS: '123 Example St, Springfield' });

      await service.sendActivationReminder({ ...certCtx, userId: 'u1' });

      expect(sent().html).toContain('123 Example St, Springfield');
      expect(sent().text).toContain('123 Example St, Springfield');
    });

    it('links to notification settings except on security notices', async () => {
      await service.sendCertIssued(certCtx);
      expect(sent().html).toContain('Manage email notifications');

      mockSendMail.mockClear();
      await service.sendApiKeyExpiredUse({
        ...certCtx,
        keyId: 'k1',
        keyName: 'ci',
      });
      expect(sent().html).not.toContain('Manage email notifications');
    });
  });

  describe('payment failed email', () => {
    const ctx = {
      userId: 'u1',
      username: 'testuser',
      email: 'test@example.com',
      plan: 'team',
      graceEndsAt: new Date('2026-10-26T15:00:00Z'),
    };
    const sent = () =>
      mockSendMail.mock.calls[0][0] as {
        to: string;
        subject: string;
        html: string;
        text: string;
      };

    it('says when the paid limits end and links to billing', async () => {
      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: any) =>
          key === 'KK_APP_DOMAIN'
            ? 'dev-web.krakenkey.io'
            : key === 'KK_SMTP_HOST'
              ? 'smtp.example.com'
              : defaultValue,
      );

      await service.sendPaymentFailed(ctx);

      const mail = sent();
      expect(mail.to).toBe('test@example.com');
      expect(mail.subject).toBe(
        'Action required: your KrakenKey payment failed',
      );
      expect(mail.html).toContain('October 26, 2026');
      expect(mail.html).toContain('Team limits');
      expect(mail.html).toContain(
        'https://dev-web.krakenkey.io/dashboard/billing',
      );
      expect(mail.html).toContain('<table role="presentation"');
      expect(mail.text).toContain('October 26, 2026');
      expect(mail.text).toContain(
        'Update payment method: https://dev-web.krakenkey.io/dashboard/billing',
      );
      expect(mail.text).not.toContain('<');
    });

    it('names the organization for an org subscription', async () => {
      await service.sendPaymentFailed({ ...ctx, organizationName: 'Acme' });

      expect(sent().text).toContain(
        "the Acme organization's Team subscription",
      );
    });

    it('is sent regardless of notification preferences', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'u1',
        notificationPreferences: Object.fromEntries(
          Object.values(NotificationType).map((t) => [t, false]),
        ),
      });

      await service.sendPaymentFailed(ctx);

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      expect(sent().html).not.toContain('Manage email notifications');
    });
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
