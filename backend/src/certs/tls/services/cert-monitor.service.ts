import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { TlsCrt } from '../entities/tls-crt.entity';
import { TlsService } from '../tls.service';
import { CertStatus } from '@krakenkey/shared';
import type { SubscriptionPlan } from '@krakenkey/shared';
import { MetricsService } from '../../../metrics/metrics.service';
import { EmailService } from '../../../notifications/email.service';
import { AlertsService } from '../../../notifications/channels/alerts.service';
import { BillingService } from '../../../billing/billing.service';
import { daysUntilExpiry, renewalWindowDays } from '../util/renewal-window';
import { User } from '../../../users/entities/user.entity';
import { certDisplayName } from '../util/cert-names';

@Injectable()
export class CertMonitorService {
  private readonly logger = new Logger(CertMonitorService.name);

  constructor(
    @InjectRepository(TlsCrt)
    private readonly tlsCrtRepository: Repository<TlsCrt>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly tlsService: TlsService,
    private readonly metricsService: MetricsService,
    private readonly emailService: EmailService,
    private readonly billingService: BillingService,
    private readonly alerts: AlertsService,
  ) {}

  /**
   * Runs daily at 6 AM. Finds all issued certificates expiring within their
   * tier-specific renewal window and queues a renewal job for each via BullMQ.
   * Free tier: 5-day window, paid tiers: 30-day window.
   *
   * Connector-managed certificates get the expiry warning but are never
   * renewed here: the connector renews them with its own keys. They are
   * checked whatever their autoRenew flag, which only controls server-side
   * renewal.
   */
  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async checkExpiringCertificates(): Promise<void> {
    // Use max window (30 days) for the DB query, then filter per-user by tier
    const threshold = new Date();
    threshold.setDate(threshold.getDate() + 30);

    // Update active certificates gauge
    const activeCount = await this.tlsCrtRepository.count({
      where: { status: CertStatus.ISSUED },
    });
    this.metricsService.activeCertificatesTotal.set(activeCount);

    const expiring = await this.tlsCrtRepository.find({
      where: [
        {
          status: CertStatus.ISSUED,
          autoRenew: true,
          expiresAt: LessThan(threshold),
        },
        {
          status: CertStatus.ISSUED,
          managedBy: 'connector',
          expiresAt: LessThan(threshold),
        },
      ],
      relations: ['user'],
    });

    // Update nearest expiry gauge
    const withExpiry = expiring.filter((c) => c.expiresAt !== null);
    if (withExpiry.length > 0) {
      const nearest = withExpiry.reduce((min, c) =>
        c.expiresAt! < min.expiresAt! ? c : min,
      );
      this.metricsService.certExpiryDays.set(
        daysUntilExpiry(nearest.expiresAt!),
      );
    }

    this.logger.log(
      `Certificate expiry check: ${expiring.length} certificate(s) expiring within 30 days`,
    );

    // Cache plan lookups and lapsed status to avoid redundant calls per user
    const planCache = new Map<string, SubscriptionPlan>();
    const lapsedCache = new Map<string, boolean>();

    for (const cert of expiring) {
      if (!cert.expiresAt) continue;

      const daysLeft = daysUntilExpiry(cert.expiresAt);

      // Determine tier-specific renewal window (cached per user)
      let userPlan = planCache.get(cert.userId);
      if (!userPlan) {
        userPlan = (await this.billingService.resolveUserTier(
          cert.userId,
        )) as SubscriptionPlan;
        planCache.set(cert.userId, userPlan);
      }
      const windowDays = renewalWindowDays(userPlan);

      // Skip certs outside this user's renewal window
      if (daysLeft > windowDays) continue;

      const connector = cert.managedBy === 'connector';

      // Free-tier auto-renewal confirmation check (server-side renewal only)
      if (userPlan === 'free' && !connector) {
        let lapsed = lapsedCache.get(cert.userId);
        if (lapsed === undefined) {
          const user =
            cert.user ??
            (await this.userRepository.findOneBy({ id: cert.userId }));
          const sixMonthsAgo = new Date();
          sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
          lapsed =
            !user?.autoRenewalConfirmedAt ||
            user.autoRenewalConfirmedAt < sixMonthsAgo;
          lapsedCache.set(cert.userId, lapsed);
          if (lapsed && user) {
            await this.maybeSendRenewalPausedReminder(user);
          }
        }
        if (lapsed) continue;
      }

      if (cert.user) {
        const commonName = certDisplayName(cert);
        await this.emailService.sendCertExpiryWarning({
          userId: cert.user.id,
          username: cert.user.username,
          email: cert.user.email,
          certId: cert.id,
          commonName,
          expiresAt: cert.expiresAt,
          daysUntilExpiry: daysLeft,
        });
        await this.alerts.emit(cert.user.id, 'cert.expiring', {
          subject: commonName,
          resource: { type: 'certificate', id: cert.id },
          details: {
            certificateId: cert.id,
            expiresAt: cert.expiresAt
              ? new Date(cert.expiresAt).toISOString()
              : null,
            daysUntilExpiry: daysLeft,
          },
        });
      }

      if (connector) {
        this.logger.log(
          `Not renewing certificate #${cert.id}: managed by a connector`,
        );
        continue;
      }

      try {
        await this.tlsService.renewInternal(cert.id);
        this.logger.log(`Queued renewal for certificate #${cert.id}`);
      } catch (err) {
        this.logger.error(
          `Failed to queue renewal for certificate #${cert.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private async maybeSendRenewalPausedReminder(user: User): Promise<void> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    if (
      user.autoRenewalReminderSentAt &&
      user.autoRenewalReminderSentAt > thirtyDaysAgo
    ) {
      return;
    }
    await this.emailService.sendAutoRenewalPaused({
      userId: user.id,
      username: user.username,
      email: user.email,
    });
    user.autoRenewalReminderSentAt = new Date();
    await this.userRepository.save(user);
  }
}
