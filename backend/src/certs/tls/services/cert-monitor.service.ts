import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Not, Repository } from 'typeorm';
import { TlsCrt } from '../entities/tls-crt.entity';
import { TlsService } from '../tls.service';
import { CertStatus } from '@krakenkey/shared';
import type { SubscriptionPlan } from '@krakenkey/shared';
import { MetricsService } from '../../../metrics/metrics.service';
import { EmailService } from '../../../notifications/email.service';
import { AlertsService } from '../../../notifications/channels/alerts.service';
import { BillingService } from '../../../billing/billing.service';
import {
  daysUntilExpiry,
  renewalRetryAt,
  renewalWindowDays,
} from '../util/renewal-window';
import { User } from '../../../users/entities/user.entity';
import { certDisplayName } from '../util/cert-names';
import { ScheduledJobLock } from '../../../common/scheduling/scheduled-job-lock.service';

const WARNED_STATUSES = [CertStatus.ISSUED, CertStatus.RENEWING];

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
    private readonly jobLock: ScheduledJobLock,
  ) {}

  /**
   * Runs daily at 6 AM. Finds all issued certificates expiring within their
   * tier-specific renewal window and queues a renewal job for each via BullMQ.
   * Free plan (Starter): 10-day window, paid plans: 30-day window.
   *
   * Connector-managed certificates get the expiry warning but are never
   * renewed here: the connector renews them with its own keys. They are
   * checked whatever their autoRenew flag, which only controls server-side
   * renewal.
   *
   * Runs once across API processes (see ScheduledJobLock), so each expiry
   * warning goes out once.
   */
  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async checkExpiringCertificates(): Promise<void> {
    await this.jobLock.runOnce('cert-monitor', () => this.checkExpiring());
  }

  private async checkExpiring(): Promise<void> {
    // Use max window (30 days) for the DB query, then filter per-user by tier
    const threshold = new Date();
    threshold.setDate(threshold.getDate() + 30);

    // Update active certificates gauge
    const activeCount = await this.tlsCrtRepository.count({
      where: { status: CertStatus.ISSUED },
    });
    this.metricsService.activeCertificatesTotal.set(activeCount);

    // Renewing certificates (started or waiting for a slot) still get the
    // warning: the renewal may not finish before expiry
    const expiring = await this.tlsCrtRepository.find({
      where: [
        {
          status: In(WARNED_STATUSES),
          autoRenew: true,
          expiresAt: LessThan(threshold),
        },
        {
          status: In(WARNED_STATUSES),
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
          lapsed = confirmationLapsed(user);
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

      if (cert.status !== CertStatus.ISSUED) {
        this.logger.log(
          `Not queuing renewal for certificate #${cert.id}: already renewing`,
        );
        continue;
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

  /**
   * Hourly: renews again the certificates whose last renewal failed (they
   * stay issued with renewalFailedAt) once their retry time has passed (see
   * renewalRetryAt: up to 20 hours after the failure, sooner near the
   * deadline). The daily check above only runs at 6 AM, which alone would
   * space retries a day or two apart and miss a deadline a few hours out.
   *
   * Only certificates KrakenKey renews on its own and that are due: inside
   * the plan's renewal window, or past the start of a CA early-replacement
   * window. A failed manual renewal before the window is not retried
   * here; the daily check picks the certificate up once it is due. Free-plan
   * owners need a current auto-renewal confirmation, as for the daily check.
   * Runs once across API processes.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async retryFailedRenewals(now = new Date()): Promise<void> {
    await this.jobLock.runOnce('renewal-retry', () => this.retryFailed(now), {
      now,
    });
  }

  private async retryFailed(now: Date): Promise<void> {
    const failed = await this.tlsCrtRepository.find({
      where: {
        status: CertStatus.ISSUED,
        autoRenew: true,
        managedBy: IsNull(),
        renewalFailedAt: Not(IsNull()),
      },
    });
    const plans = new Map<string, SubscriptionPlan>();
    const lapsed = new Map<string, boolean>();
    for (const cert of failed) {
      const retryAt = renewalRetryAt(cert);
      if (!retryAt || retryAt > now || !cert.expiresAt) continue;

      let plan = plans.get(cert.userId);
      if (!plan) {
        plan = (await this.billingService.resolveUserTier(
          cert.userId,
        )) as SubscriptionPlan;
        plans.set(cert.userId, plan);
      }
      const inWindow =
        daysUntilExpiry(cert.expiresAt, now.getTime()) <=
        renewalWindowDays(plan);
      const replacementOpen =
        !!cert.ariReplacementRequestedAt &&
        !!cert.ariWindowStart &&
        cert.ariWindowStart <= now;
      if (!inWindow && !replacementOpen) continue;

      if (plan === 'free') {
        let isLapsed = lapsed.get(cert.userId);
        if (isLapsed === undefined) {
          const user = await this.userRepository.findOneBy({
            id: cert.userId,
          });
          isLapsed = confirmationLapsed(user, now);
          lapsed.set(cert.userId, isLapsed);
        }
        if (isLapsed) continue;
      }

      try {
        await this.tlsService.renewInternal(cert.id);
        this.logger.log(
          `Renewing certificate #${cert.id} again after a failed renewal`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to queue the renewal retry for certificate #${cert.id}: ${err instanceof Error ? err.message : String(err)}`,
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

/** Free-plan auto-renewal needs a confirmation in the last six months. */
function confirmationLapsed(user: User | null, now = new Date()): boolean {
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  return (
    !user?.autoRenewalConfirmedAt || user.autoRenewalConfirmedAt < sixMonthsAgo
  );
}
