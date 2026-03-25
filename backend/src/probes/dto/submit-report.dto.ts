import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsArray,
  ValidateNested,
  IsBoolean,
  IsInt,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EndpointDto {
  @ApiProperty({ example: 'example.com' })
  @IsString()
  @IsNotEmpty()
  host: string;

  @ApiProperty({ example: 443 })
  @IsInt()
  port: number;

  @ApiPropertyOptional({ example: 'example.com' })
  @IsOptional()
  @IsString()
  sni?: string;
}

export class ConnectionResultDto {
  @ApiProperty()
  @IsBoolean()
  success: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  error?: string;

  @ApiPropertyOptional({ example: 42 })
  @IsOptional()
  @IsNumber()
  latencyMs?: number;

  @ApiPropertyOptional({ example: 'TLS 1.3' })
  @IsOptional()
  @IsString()
  tlsVersion?: string;

  @ApiPropertyOptional({ example: 'TLS_AES_256_GCM_SHA384' })
  @IsOptional()
  @IsString()
  cipherSuite?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ocspStapled?: boolean;
}

export class CertificateResultDto {
  @ApiPropertyOptional({ example: 'CN=example.com' })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiPropertyOptional({ example: ['example.com', 'www.example.com'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sans?: string[];

  @ApiPropertyOptional({ example: "CN=Let's Encrypt Authority X3" })
  @IsOptional()
  @IsString()
  issuer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  serialNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  notBefore?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  notAfter?: string;

  @ApiPropertyOptional({ example: 243 })
  @IsOptional()
  @IsInt()
  daysUntilExpiry?: number;

  @ApiPropertyOptional({ example: 'RSA' })
  @IsOptional()
  @IsString()
  keyType?: string;

  @ApiPropertyOptional({ example: 2048 })
  @IsOptional()
  @IsInt()
  keySize?: number;

  @ApiPropertyOptional({ example: 'sha256WithRSAEncryption' })
  @IsOptional()
  @IsString()
  signatureAlgorithm?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fingerprint?: string;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  chainDepth?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  chainComplete?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  trusted?: boolean;
}

export class ScanResultDto {
  @ApiProperty()
  @ValidateNested()
  @Type(() => EndpointDto)
  endpoint: EndpointDto;

  @ApiProperty()
  @ValidateNested()
  @Type(() => ConnectionResultDto)
  connection: ConnectionResultDto;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => CertificateResultDto)
  certificate?: CertificateResultDto;
}

export class SubmitReportDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  probeId: string;

  @ApiProperty({ enum: ['standalone', 'connected', 'hosted'] })
  @IsString()
  @IsNotEmpty()
  mode: string;

  @ApiPropertyOptional({ example: 'us-east-1' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiProperty()
  @IsDateString()
  timestamp: string;

  @ApiProperty({ type: [ScanResultDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScanResultDto)
  results: ScanResultDto[];
}
