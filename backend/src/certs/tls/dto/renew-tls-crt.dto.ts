import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Optional body for POST /certs/tls/:id/renew. Without it the certificate is
 * renewed with the CSR stored at first issuance. An awaiting_csr certificate
 * needs it.
 */
export class RenewTlsCrtDto {
  @ApiPropertyOptional({
    description:
      'PEM-encoded CSR to renew with, usually for a new private key. It gets ' +
      'the same checks as a new request, and its names (CN and DNS SANs, ' +
      "case-insensitive) must equal the certificate's names. It replaces the " +
      'stored CSR, so later renewals use it too. Not stored when ifDue=true ' +
      'skips the renewal. Required for an awaiting_csr certificate, whose ' +
      'names are its requestedNames; it is then issued for the first time.',
    example:
      '-----BEGIN CERTIFICATE REQUEST-----\n...\n-----END CERTIFICATE REQUEST-----',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000, { message: 'CSR PEM must be 10,000 characters or less' })
  @Matches(
    /^-----BEGIN CERTIFICATE REQUEST-----[\s\S]+-----END CERTIFICATE REQUEST-----\s*$/,
    { message: 'CSR must be in valid PEM format' },
  )
  csrPem?: string;
}
