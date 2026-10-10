import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { CERT_MANAGERS } from '@krakenkey/shared';
import type { CertManagedBy } from '@krakenkey/shared';

/**
 * Body for PATCH /certs/tls/:id: only the settings a user can change.
 *
 * Declared field by field on purpose. The global ValidationPipe strips any
 * property not declared here, so the CSR, the certificate PEM and status
 * fields can never be set through this route. To renew with a new CSR, use
 * POST /certs/tls/:id/renew with a `csrPem` body.
 */
export class UpdateTlsCrtDto {
  @ApiPropertyOptional({ description: 'Enable or disable automatic renewal' })
  @IsOptional()
  @IsBoolean()
  autoRenew?: boolean;

  @ApiPropertyOptional({
    description:
      "Who renews the certificate. 'connector': a customer-hosted connector " +
      'renews it with its own keys and KrakenKey never renews it on its own ' +
      '(expiry alerts and ARI checks still run). null: KrakenKey renews it as usual.',
    enum: CERT_MANAGERS,
    nullable: true,
  })
  @IsOptional()
  @IsIn(CERT_MANAGERS, { message: "managedBy must be 'connector' or null" })
  managedBy?: CertManagedBy | null;
}

/**
 * Internal update DTO used by background jobs (queue processors).
 * Allows setting crtPem, which is not exposed to users.
 */
export class InternalUpdateTlsCrtDto extends UpdateTlsCrtDto {
  crtPem?: string | null;
  chainPem?: string | null;
  failureReason?: string | null;
  ariCertId?: string | null;
  ariWindowStart?: Date | null;
  ariWindowEnd?: Date | null;
  ariExplanationUrl?: string | null;
  ariNextCheckAt?: Date | null;
  ariReplacementRequestedAt?: Date | null;
}
