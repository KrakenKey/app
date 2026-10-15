import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ScheduledJobLock } from '../../common/scheduling/scheduled-job-lock.service';
import { AwsMarketplaceConfig } from './aws-marketplace.config';
import { AwsMarketplaceService } from './aws-marketplace.service';

/**
 * Hourly re-check of every pending or active AWS Marketplace license with
 * GetEntitlements, for anything the event queue missed: a lost or delayed
 * event, a contract that expired, a link made before AWS granted the
 * entitlement. Runs once across API processes (see ScheduledJobLock), and
 * not at all while AWS Marketplace is off.
 */
@Injectable()
export class AwsMarketplaceReconciler {
  constructor(
    private readonly config: AwsMarketplaceConfig,
    private readonly service: AwsMarketplaceService,
    private readonly jobLock: ScheduledJobLock,
  ) {}

  @Cron('25 * * * *')
  async reconcileLicenses(): Promise<void> {
    if (!this.config.enabled) return;
    await this.jobLock.runOnce('aws-marketplace-reconcile', () =>
      this.service.reconcile(),
    );
  }
}
