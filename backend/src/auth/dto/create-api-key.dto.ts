import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  API_KEY_RESTRICTION_LIMITS,
  API_KEY_SCOPES,
  type ApiKeyScope,
} from '@krakenkey/shared';

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

  @ApiPropertyOptional({
    description:
      'Scopes the key may use. Omit for full access. Cannot be changed after creation.',
    enum: API_KEY_SCOPES,
    isArray: true,
    example: ['certs:read', 'certs:renew', 'account:read'],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(API_KEY_SCOPES, { each: true })
  scopes?: ApiKeyScope[];

  @ApiPropertyOptional({
    description:
      'Limit the key to these domain ids: certificates, domains and endpoints under other domains are hidden and new ones are refused.',
    type: [String],
    maxItems: API_KEY_RESTRICTION_LIMITS.domains,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(API_KEY_RESTRICTION_LIMITS.domains)
  @IsUUID('all', { each: true })
  allowedDomainIds?: string[];

  @ApiPropertyOptional({
    description:
      'Limit the key to these certificate ids. Such a key cannot request new certificates.',
    type: [Number],
    maxItems: API_KEY_RESTRICTION_LIMITS.certs,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(API_KEY_RESTRICTION_LIMITS.certs)
  @IsInt({ each: true })
  @Min(1, { each: true })
  allowedCertIds?: number[];

  @ApiPropertyOptional({
    description:
      'IP addresses or CIDR ranges (IPv4 or IPv6) the key may be used from. Requests from elsewhere get 403.',
    type: [String],
    maxItems: API_KEY_RESTRICTION_LIMITS.ips,
    example: ['203.0.113.10', '2001:db8::/48'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(API_KEY_RESTRICTION_LIMITS.ips)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  allowedIps?: string[];
}
