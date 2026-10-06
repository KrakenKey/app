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
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  API_KEY_RESTRICTION_LIMITS,
  API_KEY_SCOPES,
  type ApiKeyScope,
} from '@krakenkey/shared';

/** `owner/name`, GitHub's character rules. */
export const REPOSITORY_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
/** A full ref, optionally ending in `*` for a prefix match. */
export const REF_PATTERN = /^refs\/[A-Za-z0-9._/-]+\*?$|^refs\/\*$/;

export class GithubOidcExchangeDto {
  @ApiProperty({ description: 'GitHub Actions OIDC token (JWT)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  token: string;

  @ApiPropertyOptional({
    description:
      'Trust policy id; needed only when several policies match the repository',
  })
  @IsOptional()
  @IsUUID()
  trustId?: string;
}

export class CreateGithubOidcTrustDto {
  @ApiProperty({ example: 'pfe renewal' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'krakenkey/website' })
  @Matches(REPOSITORY_PATTERN, { message: 'repository must be owner/name' })
  repository: string;

  @ApiPropertyOptional({
    description:
      'Refs allowed to exchange tokens, e.g. refs/heads/main or refs/tags/v*. Omit for any ref.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @Matches(REF_PATTERN, {
    each: true,
    message: 'each ref must start with refs/ and may only end in *',
  })
  allowedRefs?: string[];

  @ApiPropertyOptional({
    description: 'Only jobs in this GitHub environment match',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  environment?: string;

  @ApiPropertyOptional({ enum: API_KEY_SCOPES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(API_KEY_SCOPES, { each: true })
  scopes?: ApiKeyScope[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(API_KEY_RESTRICTION_LIMITS.domains)
  @IsUUID('all', { each: true })
  allowedDomainIds?: string[];

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(API_KEY_RESTRICTION_LIMITS.certs)
  @IsInt({ each: true })
  @Min(1, { each: true })
  allowedCertIds?: number[];
}
