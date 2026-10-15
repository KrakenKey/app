import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ScheduledJobLock } from '../../common/scheduling/scheduled-job-lock.service';
import { AwsMarketplaceService } from './aws-marketplace.service';

/**
 * Hourly re-check of every pending or active AWS Marketplace license with
 * GetEntitlements, for anything the event queue missed: a lost or delayed
 * event, a contract that expired, a link made before AWS granted the
 * entitlement. Runs once across API processes (see ScheduledJobLock), with
 * or without KK_AWS_MARKETPLACE_ENABLED: the flag only stops new purchases,
 * and licenses already sold must keep being checked. Without the seller
 * account role the service logs an error and skips the run.
 */
@Injectable()
export class AwsMarketplaceReconciler {
  constructor(
    private readonly service: AwsMarketplaceService,
    private readonly jobLock: ScheduledJobLock,
  ) {}

  @Cron('25 * * * *')
  async reconcileLicenses(): Promise<void> {
    await this.jobLock.runOnce('aws-marketplace-reconcile', () =>
      this.service.reconcile(),
    );
  }
}
