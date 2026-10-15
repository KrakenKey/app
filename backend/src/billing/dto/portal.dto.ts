import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePortalDto {
  @ApiPropertyOptional({
    description:
      'Open the portal on confirming a switch between monthly and yearly billing',
    enum: ['switch_interval'],
  })
  @IsOptional()
  @IsIn(['switch_interval'])
  flow?: 'switch_interval';
}
