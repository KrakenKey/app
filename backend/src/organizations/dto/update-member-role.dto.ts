import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { OrgRole } from '@krakenkey/shared';

export class UpdateMemberRoleDto {
  @ApiProperty({
    enum: ['admin', 'member', 'viewer'],
    description: 'New role for the member',
  })
  @IsIn(['admin', 'member', 'viewer'])
  role: Exclude<OrgRole, 'owner'>;
}
