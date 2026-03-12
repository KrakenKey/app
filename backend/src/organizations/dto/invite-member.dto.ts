import { IsString, IsIn, IsOptional, IsEmail } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { OrgRole } from '@krakenkey/shared';

export class InviteMemberDto {
  @ApiProperty({
    description:
      'Email address of the user to invite (must already exist in the system)',
    example: 'alice@example.com',
  })
  @IsEmail()
  @IsString()
  email: string;

  @ApiPropertyOptional({
    enum: ['admin', 'member', 'viewer'],
    default: 'member',
    description: 'Role to assign to the invited user',
  })
  @IsOptional()
  @IsIn(['admin', 'member', 'viewer'])
  role?: Exclude<OrgRole, 'owner'>;
}
