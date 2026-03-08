import { IsString, IsOptional, MaxLength, IsObject } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { NotificationPreferences } from '@krakenkey/shared';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: 'User display name',
    example: 'John Doe',
    maxLength: 100,
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  displayName?: string;

  @ApiPropertyOptional({
    description: 'Notification preferences (omitted keys default to enabled)',
    example: { cert_issued: true, cert_failed: false },
  })
  @IsOptional()
  @IsObject()
  notificationPreferences?: NotificationPreferences;
}
