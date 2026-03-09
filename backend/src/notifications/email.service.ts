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
} from './templates';
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

  private async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.transporter) {
      this.logger.debug(`Email skipped (no SMTP): "${subject}" → ${to}`);
      return;
    }

    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html });
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
      certIssuedTemplate(ctx),
    );
  }

  async sendCertRenewed(ctx: CertEmailContext): Promise<void> {
    if (!(await this.shouldSend(ctx.userId, NotificationType.CERT_RENEWED)))
      return;
    await this.send(
      ctx.email,
      `Certificate renewed for ${ctx.commonName}`,
      certRenewedTemplate(ctx),
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
      certExpiryWarningTemplate(ctx),
    );
  }

  async sendCertFailed(ctx: CertEmailContext): Promise<void> {
    if (!(await this.shouldSend(ctx.userId, NotificationType.CERT_FAILED)))
      return;
    await this.send(
      ctx.email,
      `Certificate issuance failed for ${ctx.commonName}`,
      certFailedTemplate(ctx),
    );
  }

  async sendCertRevoked(ctx: CertEmailContext): Promise<void> {
    if (!(await this.shouldSend(ctx.userId, NotificationType.CERT_REVOKED)))
      return;
    await this.send(
      ctx.email,
      `Certificate revoked: ${ctx.commonName}`,
      certRevokedTemplate(ctx),
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
      domainVerificationFailedTemplate(ctx),
    );
  }
}
