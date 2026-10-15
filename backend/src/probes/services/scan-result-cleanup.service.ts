import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProbeScanResult } from '../entities/probe-scan-result.entity';
import { PLAN_LIMITS } from '../../billing/constants/plan-limits';
import { LEGACY_PLAN_ALIASES, type SubscriptionPlan } from '@krakenkey/shared';
import {
  entitledSubscriptionSql,
  entitlementSqlParams,
} from '../../billing/entitlement';

const BATCH_SIZE = 10_000;
/** Results with no owner are kept as long as the shortest plan keeps them. */
const DEFAULT_RETENTION_DAYS = PLAN_LIMITS.free.scanResultRetentionDays;

/**
 * The plan id and any legacy ids that read as it, so rows an older release
 * wrote (for example `starter` for `pro`) get the same retention.
 */
function planIds(tier: SubscriptionPlan): string[] {
  return [
    tier,
    ...Object.entries(LEGACY_PLAN_ALIASES)
      .filter(([, plan]) => plan === tier)
      .map(([legacy]) => legacy),
  ];
}

@Injectable()
export class ScanResultCleanupService {
  private readonly logger = new Logger(ScanResultCleanupService.name);

  constructor(
    @InjectRepository(ProbeScanResult)
    private readonly scanResultRepo: Repository<ProbeScanResult>,
  ) {}

  /**
   * Runs daily at 4 AM. Deletes scan results older than the plan's retention
   * period. Batches deletes to avoid locking the table.
   */
  @Cron('0 4 * * *')
  async cleanupExpiredResults(): Promise<void> {
    let totalDeleted = 0;

    // Clean up orphaned results (no userId) using shortest retention
    totalDeleted += await this.deleteOrphanedResults();

    // Clean up per tier (only tiers with < 90 day retention for efficiency)
    const tiersToClean: SubscriptionPlan[] = ['free', 'pro'];
    for (const tier of tiersToClean) {
      const retentionDays = PLAN_LIMITS[tier].scanResultRetentionDays;
      totalDeleted += await this.deleteByTier(tier, retentionDays);
    }

    if (totalDeleted > 0) {
      this.logger.log(
        `Scan result cleanup: deleted ${totalDeleted} expired result(s)`,
      );
    } else {
      this.logger.log('Scan result cleanup: no expired results found');
    }
  }

  private async deleteOrphanedResults(): Promise<number> {
    const cutoff = new Date(
      Date.now() - DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    let deleted = 0;
    let affected: number;

    do {
      const result = await this.scanResultRepo
        .createQueryBuilder()
        .delete()
        .where(
          `id IN (
            SELECT id FROM probe_scan_result
            WHERE "userId" IS NULL AND "scannedAt" < :cutoff
            LIMIT :limit
          )`,
          { cutoff, limit: BATCH_SIZE },
        )
        .execute();
      affected = result.affected ?? 0;
      deleted += affected;
    } while (affected === BATCH_SIZE);

    return deleted;
  }

  private async deleteByTier(
    tier: SubscriptionPlan,
    retentionDays: number,
  ): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    let deleted = 0;
    let affected: number;

    // Delete scan results for users on this tier whose results are past retention.
    // Join through subscription to determine tier. Handles both personal and
    // org-based subscriptions. A past_due subscription keeps its plan's
    // retention during the grace period.
    const graceParams = entitlementSqlParams();
    do {
      const result = await this.scanResultRepo
        .createQueryBuilder()
        .delete()
        .where(
          `id IN (
            SELECT psr.id FROM probe_scan_result psr
            INNER JOIN "user" u ON u.id = psr."userId"
            LEFT JOIN subscription s_personal
              ON s_personal."userId" = u.id
              AND ${entitledSubscriptionSql('s_personal')}
            LEFT JOIN subscription s_org
              ON s_org."organizationId" = u."organizationId"
              AND ${entitledSubscriptionSql('s_org')}
              AND u."organizationId" IS NOT NULL
            WHERE psr."scannedAt" < :cutoff
              AND COALESCE(s_org.plan, s_personal.plan, 'free') IN (:...plans)
            LIMIT :limit
          )`,
          { cutoff, plans: planIds(tier), ...graceParams, limit: BATCH_SIZE },
        )
        .execute();
      affected = result.affected ?? 0;
      deleted += affected;
    } while (affected === BATCH_SIZE);

    return deleted;
  }
}
