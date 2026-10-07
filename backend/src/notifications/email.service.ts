import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import {
  certIssuedTemplate,
  certRenewedTemplate,
  certExpiryWarningTemplate,
  certFailedTemplate,
  certRevokedTemplate,
  domainVerificationFailedTemplate,
  planLimitReachedTemplate,
  autoRenewalPausedTemplate,
  welcomeTemplate,
  activationReminderTemplate,
  apiKeyExpiredUseTemplate,
} from './templates';
import type { EmailBranding, EmailContent } from './templates';
import { User } from '../users/entities/user.entity';
import { NotificationType } from '@krakenkey/shared';

export interface CertEmailContext {
  userId?: string;
  username: string;
  email: string;
  certId: number;
  commonName: string;
  expiresAt?: Date;
  daysUntilExpiry?: number;
  errorMessage?: string;
}

export interface DomainVerificationFailedContext {
  userId?: string;
  username: string;
  email: string;
  hostname: string;
  verificationCode: string;
}

export interface PlanLimitReachedContext {
  userId?: string;
  username: string;
  email: string;
  plan: string;
  resourceType: string;
  current: number;
  limit: number;
}

export interface AutoRenewalPausedContext {
  userId?: string;
  username: string;
  email: string;
}

export interface WelcomeContext {
  userId?: string;
  username: string;
  email: string;
}

export interface ActivationReminderContext {
  userId: string;
  username: string;
  email: string;
}

export interface ApiKeyExpiredUseContext {
  userId?: string;
  username: string;
  email: string;
  keyId: string;
  keyName: string;
  ip?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {
    const host = this.configService.get<string>('KK_SMTP_HOST');
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: this.configService.get<number>('KK_SMTP_PORT', 587),
        secure: this.configService.get<number>('KK_SMTP_PORT', 587) === 465,
        auth: {
          user: this.configService.get<string>('KK_SMTP_USER'),
          pass: this.configService.get<string>('KK_SMTP_PASSWORD'),
        },
      });
      this.logger.log(`SMTP transport configured (host: ${host})`);
    } else {
      this.logger.warn(
        'KK_SMTP_HOST not configured — email notifications disabled',
      );
    }
  }

  private get from(): string {
    return this.configService.get<string>(
      'KK_SMTP_FROM',
      'KrakenKey <noreply@krakenkey.io>',
    );
  }

  private get replyTo(): string | undefined {
    return this.configService.get<string>('KK_SMTP_REPLY_TO') || undefined;
  }

  private get brand(): EmailBranding {
    const appDomain = this.configService.get<string>(
      'KK_APP_DOMAIN',
      'app.krakenkey.io',
    );
    return {
      appUrl: `https://${appDomain}`,
      logoUrl: this.configService.get<string>(
        'KK_MAIL_LOGO_URL',
        'https://krakenkey.io/email/logo.png',
      ),
      postalAddress:
        this.configService.get<string>('KK_MAIL_POSTAL_ADDRESS') || undefined,
    };
  }

  private async shouldSend(
    userId: string | undefined,
    type: NotificationType,
  ): Promise<boolean> {
    if (!userId) return true;
    try {
      const user = await this.userRepo.findOne({
        where: { id: userId },
        select: ['id', 'notificationPreferences'],
      });
      if (!user) return true;
      const pref = user.notificationPreferences[type];
      // Undefined/missing means enabled (opt-out model)
      return pref !== false;
    } catch {
      // On error, default to sending
      return true;
    }
  }

  private async send(
    to: string,
    subject: string,
    content: EmailContent,
  ): Promise<void> {
    if (!this.transporter) {
      this.logger.debug(`Email skipped (no SMTP): "${subject}" → ${to}`);
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        html: content.html,
        text: content.text,
        ...(this.replyTo && { replyTo: this.replyTo }),
      });
      this.logger.log(`Email sent: "${subject}" → ${to}`);
    } catch (err) {
      this.logger.error(
        `Failed to send email: "${subject}" → ${to}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  async sendCertIssued(ctx: CertEmailContext): Promise<void> {
    if (!(await this.shouldSend(ctx.userId, NotificationType.CERT_ISSUED)))
      return;
    await this.send(
      ctx.email,
      `Certificate issued for ${ctx.commonName}`,
      certIssuedTemplate(ctx, this.brand),
    );
  }

  async sendCertRenewed(ctx: CertEmailContext): Promise<void> {
    if (!(await this.shouldSend(ctx.userId, NotificationType.CERT_RENEWED)))
      return;
    await this.send(
      ctx.email,
      `Certificate renewed for ${ctx.commonName}`,
      certRenewedTemplate(ctx, this.brand),
    );
  }

  async sendCertExpiryWarning(ctx: CertEmailContext): Promise<void> {
    if (
      !(await this.shouldSend(ctx.userId, NotificationType.CERT_EXPIRY_WARNING))
    )
      return;
    await this.send(
      ctx.email,
      `Certificate expiring soon: ${ctx.commonName}`,
      certExpiryWarningTemplate(ctx, this.brand),
    );
  }

  async sendCertFailed(ctx: CertEmailContext): Promise<void> {
    if (!(await this.shouldSend(ctx.userId, NotificationType.CERT_FAILED)))
      return;
    await this.send(
      ctx.email,
      `Certificate issuance failed for ${ctx.commonName}`,
      certFailedTemplate(ctx, this.brand),
    );
  }

  async sendCertRevoked(ctx: CertEmailContext): Promise<void> {
    if (!(await this.shouldSend(ctx.userId, NotificationType.CERT_REVOKED)))
      return;
    await this.send(
      ctx.email,
      `Certificate revoked: ${ctx.commonName}`,
      certRevokedTemplate(ctx, this.brand),
    );
  }

  async sendDomainVerificationFailed(
    ctx: DomainVerificationFailedContext,
  ): Promise<void> {
    if (
      !(await this.shouldSend(
        ctx.userId,
        NotificationType.DOMAIN_VERIFICATION_FAILED,
      ))
    )
      return;
    await this.send(
      ctx.email,
      `Domain verification failed: ${ctx.hostname}`,
      domainVerificationFailedTemplate(ctx, this.brand),
    );
  }

  async sendAutoRenewalPaused(ctx: AutoRenewalPausedContext): Promise<void> {
    if (
      !(await this.shouldSend(ctx.userId, NotificationType.AUTO_RENEWAL_PAUSED))
    )
      return;
    await this.send(
      ctx.email,
      'Action required: KrakenKey auto-renewal is paused',
      autoRenewalPausedTemplate(ctx, this.brand),
    );
  }

  async sendWelcome(ctx: WelcomeContext): Promise<void> {
    if (!(await this.shouldSend(ctx.userId, NotificationType.WELCOME))) return;
    await this.send(
      ctx.email,
      'Welcome to KrakenKey',
      welcomeTemplate(ctx, this.brand),
    );
  }

  async sendActivationReminder(ctx: ActivationReminderContext): Promise<void> {
    if (
      !(await this.shouldSend(ctx.userId, NotificationType.ACTIVATION_REMINDER))
    )
      return;
    await this.send(
      ctx.email,
      'Your KrakenKey account is waiting',
      activationReminderTemplate(ctx, this.brand),
    );
  }

  async sendPlanLimitReached(ctx: PlanLimitReachedContext): Promise<void> {
    if (
      !(await this.shouldSend(ctx.userId, NotificationType.PLAN_LIMIT_REACHED))
    )
      return;
    await this.send(
      ctx.email,
      `Plan limit reached: ${ctx.resourceType}`,
      planLimitReachedTemplate(ctx, this.brand),
    );
  }

  /**
   * Security notification — intentionally not gated by notification
   * preferences: owners should always learn their expired key is in use.
   */
  async sendApiKeyExpiredUse(ctx: ApiKeyExpiredUseContext): Promise<void> {
    await this.send(
      ctx.email,
      `Security notice: expired API key "${ctx.keyName}" was used`,
      apiKeyExpiredUseTemplate(ctx, this.brand),
    );
  }
}
