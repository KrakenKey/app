import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import * as x509 from '@peculiar/x509';
import { CertStatus } from '@krakenkey/shared';
import { TlsCrt } from '../entities/tls-crt.entity';
import { User } from '../../../users/entities/user.entity';
import { TlsService } from '../tls.service';
import { AriService } from './ari.service';
import { BillingService } from '../../../billing/billing.service';
import { MetricsService } from '../../../metrics/metrics.service';
import { ariCertId, isEarlyReplacement } from '../util/ari';

type AriField =
  | 'ariCertId'
  | 'ariWindowStart'
  | 'ariWindowEnd'
  | 'ariExplanationUrl'
  | 'ariNextCheckAt'
  | 'ariReplacementRequestedAt';

/** Certificates checked per run; the rest wait for the next hour. */
const BATCH = 200;
const HOUR_MS = 3600_000;
/** Back-off when the CA has no renewal info for a certificate. */
const NO_INFO_RETRY_MS = 24 * HOUR_MS;
/** Back-off after a failed check (network error, 5xx). */
const ERROR_RETRY_MS = 6 * HOUR_MS;

/**
 * Polls ACME Renewal Information (RFC 9773) for issued, auto-renewing
 * certificates and stores the CA's suggested window.
 *
 * Normal renewals still follow the plan window (CertMonitorService). ARI only
 * pulls a renewal earlier when the CA asks for early replacement, for
 * example before a mass revocation (see isEarlyReplacement). Then the
 * certificate is renewed as soon as the CA's window opens, whatever the plan.
 */
@Injectable()
export class AriMonitorService {
  private readonly logger = new Logger(AriMonitorService.name);

  constructor(
    @InjectRepository(TlsCrt)
    private readonly tlsCrtRepository: Repository<TlsCrt>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly tlsService: TlsService,
    private readonly ariService: AriService,
    private readonly billingService: BillingService,
    private readonly metricsService: MetricsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async checkRenewalInfo(now = new Date()): Promise<void> {
    if (!this.ariService.isEnabled()) return;

    const due = await this.tlsCrtRepository.find({
      where: [
        {
          status: CertStatus.ISSUED,
          autoRenew: true,
          ariNextCheckAt: IsNull(),
        },
        {
          status: CertStatus.ISSUED,
          autoRenew: true,
          ariNextCheckAt: LessThanOrEqual(now),
        },
      ],
      order: { ariNextCheckAt: { direction: 'ASC', nulls: 'FIRST' } },
      take: BATCH,
    });

    for (const cert of due) {
      await this.checkOne(cert, now);
    }
  }

  private async checkOne(cert: TlsCrt, now: Date): Promise<void> {
    const later = (ms: number) => new Date(now.getTime() + ms);

    let leaf: x509.X509Certificate | null = null;
    try {
      leaf = cert.crtPem ? new x509.X509Certificate(cert.crtPem) : null;
    } catch {
      leaf = null;
    }
    const certId = cert.ariCertId ?? (cert.crtPem ? safe(cert.crtPem) : null);
    if (!leaf || !certId) {
      await this.save(cert.id, { ariNextCheckAt: later(NO_INFO_RETRY_MS) });
      return;
    }

    let info;
    try {
      info = await this.ariService.getRenewalInfo(certId);
    } catch (err) {
      this.metricsService.ariChecksTotal.inc({ result: 'error' });
      this.logger.warn(
        `ARI check failed for certificate #${cert.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.save(cert.id, {
        ariCertId: certId,
        ariNextCheckAt: later(ERROR_RETRY_MS),
      });
      return;
    }

    if (!info) {
      this.metricsService.ariChecksTotal.inc({ result: 'none' });
      await this.save(cert.id, {
        ariCertId: certId,
        ariNextCheckAt: later(NO_INFO_RETRY_MS),
      });
      return;
    }

    const { window } = info;
    const early = isEarlyReplacement(
      window,
      { notBefore: leaf.notBefore, notAfter: leaf.notAfter },
      cert.ariWindowStart,
    );
    const requestedAt = cert.ariReplacementRequestedAt ?? (early ? now : null);

    let nextCheck = later(info.retryAfterSeconds * 1000);
    // Waiting for an early-replacement window to open: look again when it does
    if (requestedAt && window.start > now && window.start < nextCheck) {
      nextCheck = window.start;
    }

    await this.save(cert.id, {
      ariCertId: certId,
      ariWindowStart: window.start,
      ariWindowEnd: window.end,
      ariExplanationUrl: window.explanationUrl,
      ariNextCheckAt: nextCheck,
      ariReplacementRequestedAt: requestedAt,
    });

    if (!requestedAt) {
      this.metricsService.ariChecksTotal.inc({ result: 'ok' });
      return;
    }

    this.metricsService.ariChecksTotal.inc({ result: 'early_replacement' });
    if (early && !cert.ariReplacementRequestedAt) {
      this.logger.warn(
        `CA asked for early replacement of certificate #${cert.id}: window ${window.start.toISOString()} to ${window.end.toISOString()}` +
          (window.explanationUrl ? ` (${window.explanationUrl})` : ''),
      );
    }
    if (window.start > now) return;

    if (await this.autoRenewalLapsed(cert.userId)) {
      this.logger.warn(
        `Not renewing certificate #${cert.id} early: the owner's free-plan auto-renewal confirmation has lapsed`,
      );
      return;
    }
    try {
      await this.tlsService.renewInternal(cert.id);
      this.logger.log(
        `Queued early renewal for certificate #${cert.id} (CA request)`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to queue early renewal for certificate #${cert.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Free-plan auto-renewal needs a confirmation in the last six months, the
   * same rule CertMonitorService applies.
   */
  private async autoRenewalLapsed(userId: string): Promise<boolean> {
    const plan = await this.billingService.resolveUserTier(userId);
    if (plan !== 'free') return false;
    const user = await this.userRepository.findOneBy({ id: userId });
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    return (
      !user?.autoRenewalConfirmedAt ||
      user.autoRenewalConfirmedAt < sixMonthsAgo
    );
  }

  private save(id: number, data: Partial<Pick<TlsCrt, AriField>>) {
    return this.tlsCrtRepository.update(id, data);
  }
}

function safe(pem: string): string | null {
  try {
    return ariCertId(pem);
  } catch {
    return null;
  }
}
