import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsISO8601,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateApiKeyDto {
  @ApiPropertyOptional({
    description: 'A human-friendly name for this API key',
    example: 'my-ci-key',
    default: 'default',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string = 'default';

  @ApiPropertyOptional({
    description: 'ISO 8601 expiration date (optional, null = never expires)',
    example: '2027-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
