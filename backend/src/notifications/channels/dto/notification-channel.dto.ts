import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ALERT_EVENTS,
  DEFAULT_ALERT_EVENTS,
  NOTIFICATION_CHANNEL_TYPES,
  type AlertEvent,
  type NotificationChannelType,
} from '@krakenkey/shared';
import { MAX_CHANNEL_URL_LENGTH } from '../channel-url';

const URL_DESCRIPTION =
  'Destination URL. Slack: an incoming webhook (https://hooks.slack.com/services/...). ' +
  'Teams: a Workflows webhook URL (Office 365 connectors are retired). ' +
  'Webhook: any https URL that resolves only to public addresses. Stored encrypted and never returned in full.';

export class CreateNotificationChannelDto {
  @ApiProperty({ enum: NOTIFICATION_CHANNEL_TYPES, example: 'slack' })
  @IsIn(NOTIFICATION_CHANNEL_TYPES as unknown as string[])
  type: NotificationChannelType;

  @ApiProperty({ example: 'Ops alerts', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: URL_DESCRIPTION,
    example: 'https://hooks.slack.com/services/T000/B000/XXXX',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CHANNEL_URL_LENGTH)
  url: string;

  @ApiPropertyOptional({
    enum: ALERT_EVENTS,
    isArray: true,
    description: `Events to send. Defaults to ${DEFAULT_ALERT_EVENTS.join(', ')}.`,
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(ALERT_EVENTS.length)
  @IsIn(ALERT_EVENTS, { each: true })
  events?: AlertEvent[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateNotificationChannelDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: URL_DESCRIPTION })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CHANNEL_URL_LENGTH)
  url?: string;

  @ApiPropertyOptional({ enum: ALERT_EVENTS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(ALERT_EVENTS.length)
  @IsIn(ALERT_EVENTS, { each: true })
  events?: AlertEvent[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
