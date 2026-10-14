import { IsNotEmpty, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
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
}
