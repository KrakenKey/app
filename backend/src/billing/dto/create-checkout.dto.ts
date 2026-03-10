import { IsNotEmpty, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCheckoutDto {
  @ApiProperty({
    description: 'Plan to subscribe to',
    example: 'starter',
    enum: ['starter', 'team', 'business', 'enterprise'],
  })
  @IsNotEmpty()
  @IsIn(['starter', 'team', 'business', 'enterprise'])
  plan: string;
}
