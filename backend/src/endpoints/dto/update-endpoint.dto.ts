import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateEndpointDto {
  @ApiPropertyOptional({
    description: 'SNI override',
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
    description: 'Whether endpoint monitoring is active',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
