import { IsNotEmpty, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpgradePlanDto {
  @ApiProperty({
    description: 'Plan to upgrade to',
    example: 'team',
    enum: ['starter', 'team', 'business', 'enterprise'],
  })
  @IsNotEmpty()
  @IsIn(['starter', 'team', 'business', 'enterprise'])
  plan: string;
}
