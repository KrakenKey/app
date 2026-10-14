import { IsNotEmpty, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
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
}
