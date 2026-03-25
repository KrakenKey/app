import {
  IsNotEmpty,
  IsString,
  IsInt,
  IsOptional,
  IsArray,
  Min,
  Max,
  MaxLength,
  IsFQDN,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEndpointDto {
  @ApiProperty({
    description: 'Hostname to monitor',
    example: 'example.com',
  })
  @IsNotEmpty()
  @IsFQDN()
  @MaxLength(253)
  host: string;

  @ApiPropertyOptional({
    description: 'Port to connect to (default: 443)',
    example: 443,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @ApiPropertyOptional({
    description: 'SNI override (defaults to host)',
    example: 'example.com',
  })
  @IsOptional()
  @IsString()
  @MaxLength(253)
  sni?: string;

  @ApiPropertyOptional({
    description: 'User-friendly label',
    example: 'Production API',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @ApiPropertyOptional({
    description: 'IDs of connected probes to assign for scanning',
    example: ['probe-uuid-1'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  probeIds?: string[];

  @ApiPropertyOptional({
    description: 'Hosted probe regions to enable for scanning (Team tier+)',
    example: ['us-east-1'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hostedRegions?: string[];
}
