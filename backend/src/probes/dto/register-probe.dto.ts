import { IsString, IsNotEmpty, IsIn, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterProbeDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsString()
  @IsNotEmpty()
  probeId: string;

  @ApiProperty({ example: 'krakenkey-prd' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: '0.1.0' })
  @IsString()
  @IsNotEmpty()
  version: string;

  @ApiProperty({
    enum: ['standalone', 'connected', 'hosted'],
    example: 'connected',
  })
  @IsIn(['standalone', 'connected', 'hosted'])
  mode: string;

  @ApiPropertyOptional({ example: 'us-east-1' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiProperty({ example: 'linux' })
  @IsString()
  @IsNotEmpty()
  os: string;

  @ApiProperty({ example: 'amd64' })
  @IsString()
  @IsNotEmpty()
  arch: string;
}
