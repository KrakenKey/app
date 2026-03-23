import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { BillingService } from '../billing.service';

export interface OrgDissolutionJobPayload {
  organizationId: string;
  cancelSubscription?: boolean;
}

@Processor('orgDissolution')
export class OrgDissolutionProcessor extends WorkerHost {
  private readonly logger = new Logger(OrgDissolutionProcessor.name);

  constructor(private readonly billingService: BillingService) {
    super();
  }

  async process(
    job: Job<OrgDissolutionJobPayload>,
  ): Promise<{ success: boolean }> {
    const { organizationId, cancelSubscription } = job.data;
    this.logger.log(`Processing org dissolution: org=${organizationId}`);

    await this.billingService.dissolveOrganization(
      organizationId,
      cancelSubscription,
    );

    this.logger.log(`Org dissolution complete: org=${organizationId}`);
    return { success: true };
  }
}
