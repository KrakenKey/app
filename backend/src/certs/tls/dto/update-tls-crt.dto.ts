import { PartialType, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { CERT_MANAGERS } from '@krakenkey/shared';
import type { CertManagedBy } from '@krakenkey/shared';
import { CreateTlsCrtDto } from './create-tls-crt.dto';

/**
 * User-facing update DTO.
 *
 * NOTE: crtPem is intentionally excluded from the user-facing DTO.
 * Certificate PEM data is only set by internal system methods (updateInternal)
 * via background jobs after ACME issuance completes.
 */
export class UpdateTlsCrtDto extends PartialType(CreateTlsCrtDto) {
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
