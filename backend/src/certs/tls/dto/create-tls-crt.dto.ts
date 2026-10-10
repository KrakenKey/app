import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateBy,
  ValidateIf,
  type ValidationOptions,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CERT_MANAGERS, MAX_REQUESTED_NAMES } from '@krakenkey/shared';
import type { CertManagedBy } from '@krakenkey/shared';

/**
 * A DNS name as a certificate can carry it: labels of letters, digits and
 * hyphens, a top-level label starting with a letter (so no IP addresses),
 * an optional leading "*." wildcard, no trailing dot.
 */
export const CERT_NAME_PATTERN =
  /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/i;

/** Fails when `other` is also set on the object. */
function NotWith(other: string, options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'notWith',
      validator: {
        validate: (_value, args) =>
          (args?.object as Record<string, unknown>)[other] === undefined,
      },
    },
    options,
  );
}

/** Fails unless `other` is also set on the object. */
function OnlyWith(other: string, options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'onlyWith',
      validator: {
        validate: (_value, args) =>
          (args?.object as Record<string, unknown>)[other] !== undefined,
      },
    },
    options,
  );
}

/**
 * Body for POST /certs/tls: exactly one of `csrPem` (issue now) or `names`
 * with `managedBy: 'connector'` (create an awaiting_csr certificate that a
 * connector completes with its own CSR). TlsService.create checks the same
 * rules again for callers that skip validation.
 */
export class CreateTlsCrtDto {
  @ApiPropertyOptional({
    description:
      'PEM-encoded Certificate Signing Request. Required unless `names` is given.',
    example:
      '-----BEGIN CERTIFICATE REQUEST-----\n...\n-----END CERTIFICATE REQUEST-----',
  })
  // Validated when given, or when names is missing too (so {} still says
  // what is required)
  @ValidateIf(
    (o: CreateTlsCrtDto) => o.csrPem !== undefined || o.names === undefined,
  )
  @IsDefined({ message: 'csrPem or names is required' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000, { message: 'CSR PEM must be 10,000 characters or less' })
  @Matches(
    /^-----BEGIN CERTIFICATE REQUEST-----[\s\S]+-----END CERTIFICATE REQUEST-----\s*$/,
    { message: 'CSR must be in valid PEM format' },
  )
  csrPem?: string;

  @ApiPropertyOptional({
    description:
      'Instead of `csrPem`: the DNS names (wildcards allowed) of a ' +
      'certificate a connector will issue with its own key. Needs ' +
      "`managedBy: 'connector'`. Creates the certificate with status " +
      '`awaiting_csr`; the connector completes it with ' +
      '`POST /certs/tls/:id/renew` and a CSR for exactly these names. ' +
      'Names get the same domain ownership checks as CSR names.',
    type: [String],
    example: ['example.com', 'www.example.com'],
    maxItems: MAX_REQUESTED_NAMES,
  })
  @IsOptional()
  @NotWith('csrPem', { message: 'Send either csrPem or names, not both' })
  @IsArray()
  @ArrayMinSize(1, { message: 'names must contain at least one name' })
  @ArrayMaxSize(MAX_REQUESTED_NAMES, {
    message: `names must contain at most ${MAX_REQUESTED_NAMES} names`,
  })
  @IsString({ each: true })
  @MaxLength(253, {
    each: true,
    message: 'each name must be 253 characters or less',
  })
  @Matches(CERT_NAME_PATTERN, {
    each: true,
    message: 'each name must be a DNS name, optionally starting with "*."',
  })
  names?: string[];

  @ApiPropertyOptional({
    description:
      "Required with `names`, and must be 'connector'. Not accepted with " +
      '`csrPem`; use PATCH /certs/tls/:id to change it later.',
    enum: CERT_MANAGERS,
  })
  @ValidateIf(
    (o: CreateTlsCrtDto) => o.names !== undefined || o.managedBy !== undefined,
  )
  @OnlyWith('names', {
    message:
      'managedBy is only accepted with names. Use PATCH /certs/tls/:id to change it on a certificate.',
  })
  @IsIn(CERT_MANAGERS, {
    message: "managedBy must be 'connector' when names is given",
  })
  managedBy?: CertManagedBy;
}
