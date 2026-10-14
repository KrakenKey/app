import { IsNotEmpty, IsIn, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BILLING_INTERVALS, type BillingInterval } from '@krakenkey/shared';
import { AcceptLegacyPlanId, PAID_PLANS, type PaidPlan } from './paid-plan';

export class CreateCheckoutDto {
  @ApiProperty({
    description: 'Plan to subscribe to',
    example: 'pro',
    enum: PAID_PLANS,
  })
  @AcceptLegacyPlanId()
  @IsNotEmpty()
  @IsIn(PAID_PLANS)
  plan: PaidPlan;
  @ApiPropertyOptional({
    description: 'Billing interval; `month` when left out',
    enum: BILLING_INTERVALS,
  })
  @IsOptional()
  @IsIn(BILLING_INTERVALS)
  interval?: BillingInterval;
}
