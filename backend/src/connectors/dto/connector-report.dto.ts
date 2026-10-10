import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CONNECTOR_DEPLOYMENT_STATES,
  CONNECTOR_REPORT_LIMITS,
  CONNECTOR_TARGET_LABEL_PATTERN,
  type ConnectorDeploymentState,
} from '@krakenkey/shared';

/** Printable ASCII without spaces, as at enrolment. */
const AGENT_INFO_PATTERN = /^[\x21-\x7E]+$/;

/** Control characters become spaces, so an error can't break a log line or an email. */
function sanitiseError(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
  return clean === '' ? null : clean;
}

export class ConnectorReportTargetDto {
  @ApiProperty({ example: 'nginx-main', pattern: '^[A-Za-z0-9._-]{1,64}$' })
  @IsString()
  @Matches(CONNECTOR_TARGET_LABEL_PATTERN, {
    message: 'label must be 1 to 64 letters, digits, ".", "_" or "-"',
  })
  label: string;

  @ApiProperty({ enum: CONNECTOR_DEPLOYMENT_STATES })
  @IsIn(CONNECTOR_DEPLOYMENT_STATES)
  state: ConnectorDeploymentState;

  @ApiPropertyOptional({
    description: 'Hex serial of the installed certificate',
    nullable: true,
    maxLength: CONNECTOR_REPORT_LIMITS.serialLength,
  })
  @IsOptional()
  @Matches(/^[0-9A-Fa-f]{1,64}$/, {
    message: 'serial must be hex, at most 64 characters',
  })
  serial?: string | null;

  @ApiPropertyOptional({
    description: 'Short error code or message',
    nullable: true,
    maxLength: CONNECTOR_REPORT_LIMITS.errorLength,
  })
  @IsOptional()
  @Transform(({ value }) => sanitiseError(value))
  @IsString()
  @MaxLength(CONNECTOR_REPORT_LIMITS.errorLength)
  error?: string | null;

  @ApiProperty({
    description: 'When the target last changed (RFC 3339)',
    example: '2026-10-10T14:00:00.000Z',
  })
  @IsISO8601({ strict: true })
  updatedAt: string;
}

export class ConnectorReportCertificateDto {
  @ApiProperty({ example: 42 })
  @IsInt()
  @Min(1)
  certificateId: number;

  @ApiProperty({
    type: [ConnectorReportTargetDto],
    maxItems: CONNECTOR_REPORT_LIMITS.targetsPerCertificate,
    description:
      'Every target the certificate is deployed to. Targets left out are removed.',
  })
  @IsArray()
  @ArrayMaxSize(CONNECTOR_REPORT_LIMITS.targetsPerCertificate)
  @ValidateNested({ each: true })
  @Type(() => ConnectorReportTargetDto)
  targets: ConnectorReportTargetDto[];
}

export class ConnectorReportDto {
  @ApiProperty({ example: '0.2.0', maxLength: 64 })
  @IsString()
  @Matches(AGENT_INFO_PATTERN, { message: 'version must be printable ASCII' })
  @MaxLength(64)
  version: string;

  @ApiProperty({ example: 'linux', maxLength: 32 })
  @IsString()
  @Matches(AGENT_INFO_PATTERN, { message: 'os must be printable ASCII' })
  @MaxLength(32)
  os: string;

  @ApiProperty({ example: 'amd64', maxLength: 32 })
  @IsString()
  @Matches(AGENT_INFO_PATTERN, { message: 'arch must be printable ASCII' })
  @MaxLength(32)
  arch: string;

  @ApiProperty({
    type: [ConnectorReportCertificateDto],
    maxItems: CONNECTOR_REPORT_LIMITS.certificates,
  })
  @IsArray()
  @ArrayMaxSize(CONNECTOR_REPORT_LIMITS.certificates)
  @ValidateNested({ each: true })
  @Type(() => ConnectorReportCertificateDto)
  certificates: ConnectorReportCertificateDto[];
}

export class ConnectorDeploymentsQueryDto {
  @ApiProperty({ example: 42 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  certificateId: number;
}
