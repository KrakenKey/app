import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDeviceCodeDto {
  @ApiPropertyOptional({
    description:
      'Shown on the approval page and used in the API key name, e.g. the machine hostname',
    example: 'build-01',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[\w .@()-]*$/, {
    message:
      'clientName may contain letters, digits, spaces and . _ - @ ( ) only',
  })
  clientName?: string;
}

export class DeviceTokenDto {
  @ApiProperty({ description: 'Device code from POST /auth/device/code' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  deviceCode: string;
}

export class DeviceUserCodeDto {
  @ApiProperty({
    description: 'User code shown by the CLI',
    example: 'BCDF-GHJK',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  userCode: string;
}
