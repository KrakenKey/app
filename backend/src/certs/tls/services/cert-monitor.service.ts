import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { TlsCrt } from '../entities/tls-crt.entity';
import { TlsService } from '../tls.service';
import { CertStatus } from '@krakenkey/shared';
import { MetricsService } from '../../../metrics/metrics.service';

@Injectable()
export class CertMonitorService {
  private readonly logger = new Logger(CertMonitorService.name);

  constructor(
    @InjectRepository(TlsCrt)
    private readonly tlsCrtRepository: Repository<TlsCrt>,
    private readonly tlsService: TlsService,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * Runs daily at 6 AM. Finds all issued certificates expiring within 30 days
   * and queues a renewal job for each via BullMQ.
   */
  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async checkExpiringCertificates(): Promise<void> {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() + 30);

    // Update active certificates gauge
    const activeCount = await this.tlsCrtRepository.count({
      where: { status: CertStatus.ISSUED },
    });
    this.metricsService.activeCertificatesTotal.set(activeCount);

    const expiring = await this.tlsCrtRepository.find({
      where: {
        status: CertStatus.ISSUED,
        autoRenew: true,
        expiresAt: LessThan(threshold),
      },
    });

    // Update nearest expiry gauge
    const withExpiry = expiring.filter((c) => c.expiresAt !== null);
    if (withExpiry.length > 0) {
      const nearest = withExpiry.reduce((min, c) =>
        c.expiresAt! < min.expiresAt! ? c : min,
      );
      const daysUntilExpiry = Math.floor(
        (nearest.expiresAt!.getTime() - Date.now()) / 86_400_000,
      );
      this.metricsService.certExpiryDays.set(daysUntilExpiry);
    }

    this.logger.log(
      `Certificate expiry check: ${expiring.length} certificate(s) expiring within 30 days`,
    );

    for (const cert of expiring) {
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
}
