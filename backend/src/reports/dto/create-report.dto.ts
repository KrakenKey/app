import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateReportDto {
  @ApiPropertyOptional({
    description: 'Name shown in the report list and on the shared page',
    example: 'Client sites, October',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({
    description:
      'Hostnames to scan, one per entry, optionally with :port (default 443). Duplicates are dropped. Starter plan: up to 25 hosts, Pro: up to 250, Business and Enterprise: up to 1000.',
    example: ['example.com', 'api.example.com:8443'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  hosts: string[];
}
