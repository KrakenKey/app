import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  API_KEY_RESTRICTION_LIMITS,
  CONNECTOR_SCOPES,
  type ConnectorScope,
} from '@krakenkey/shared';
import {
  NONCE_PATTERN,
  PUBLIC_KEY_PATTERN,
  SIGNATURE_PATTERN,
  TIMESTAMP_PATTERN,
} from '../connector-crypto';

/** Printable ASCII without spaces, for version, os and arch. */
const AGENT_INFO_PATTERN = /^[\x21-\x7E]+$/;

export class CreateConnectorDto {
  @ApiProperty({ example: 'web-01', minLength: 1, maxLength: 64 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name: string;

  @ApiPropertyOptional({
    description: 'Customer or site the connector runs for',
    example: 'Acme Corp',
    minLength: 1,
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  clientLabel?: string;

  @ApiProperty({
    enum: CONNECTOR_SCOPES,
    isArray: true,
    description:
      'Scopes of the keys the connector gets. Must include certs:read.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(CONNECTOR_SCOPES, { each: true })
  scopes: ConnectorScope[];

  @ApiPropertyOptional({
    type: [Number],
    description:
      'Certificates the connector may use. At least one of allowedCertIds and allowedDomainIds is required.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(API_KEY_RESTRICTION_LIMITS.certs)
  @IsInt({ each: true })
  @Min(1, { each: true })
  allowedCertIds?: number[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Domains the connector may use certificates for. At least one of allowedCertIds and allowedDomainIds is required.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(API_KEY_RESTRICTION_LIMITS.domains)
  @IsUUID('all', { each: true })
  allowedDomainIds?: string[];
}

export class UpdateConnectorDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 64 })
  @ValidateIf((o: UpdateConnectorDto) => o.name !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name?: string;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 64,
    description: 'null clears it',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  clientLabel?: string | null;
}

export class ConnectorEnrolDto {
  @ApiProperty({ description: 'Enrolment token from the dashboard (kkce_...)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  token: string;

  @ApiProperty({
    description:
      'Standard base64 (padded) of the raw 32-byte Ed25519 public key',
  })
  @Matches(PUBLIC_KEY_PATTERN, {
    message: 'publicKey must be the base64 of a 32-byte Ed25519 public key',
  })
  publicKey: string;

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
}

class SignedConnectorRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  connectorId: string;

  @ApiProperty({
    description: 'RFC 3339 UTC with second precision',
    example: '2026-10-10T14:00:00Z',
  })
  @Matches(TIMESTAMP_PATTERN, {
    message: 'timestamp must be RFC 3339 UTC with second precision',
  })
  timestamp: string;

  @ApiProperty({
    description:
      'base64url (no padding) of at least 16 random bytes, at most 64 characters',
  })
  @Matches(NONCE_PATTERN, {
    message: 'nonce must be base64url without padding, 22 to 64 characters',
  })
  nonce: string;

  @ApiProperty({
    description: 'Standard base64 of the 64-byte Ed25519 signature',
  })
  @Matches(SIGNATURE_PATTERN, {
    message: 'signature must be the base64 of a 64-byte Ed25519 signature',
  })
  signature: string;
}

export class ConnectorTokenDto extends SignedConnectorRequestDto {}

export class ConnectorRotateDto extends SignedConnectorRequestDto {
  @ApiProperty({
    description:
      'The new key: standard base64 (padded) of the raw 32-byte Ed25519 public key',
  })
  @Matches(PUBLIC_KEY_PATTERN, {
    message: 'newPublicKey must be the base64 of a 32-byte Ed25519 public key',
  })
  newPublicKey: string;
}
