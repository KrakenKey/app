import { IsNotEmpty, IsIn, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BILLING_INTERVALS, type BillingInterval } from '@krakenkey/shared';
import { AcceptLegacyPlanId, PAID_PLANS, type PaidPlan } from './paid-plan';

export class UpgradePlanDto {
  @ApiProperty({
    description: 'Plan to upgrade to',
    example: 'business',
    enum: PAID_PLANS,
  })
  @AcceptLegacyPlanId()
  @IsNotEmpty()
  @IsIn(PAID_PLANS)
  plan: PaidPlan;
  @ApiPropertyOptional({
    description:
      'Billing interval after the upgrade; the current one when left out',
    enum: BILLING_INTERVALS,
  })
  @IsOptional()
  @IsIn(BILLING_INTERVALS)
  interval?: BillingInterval;
}
