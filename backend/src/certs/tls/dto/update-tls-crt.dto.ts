import { PartialType, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
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
}

/**
 * Internal update DTO used by background jobs (queue processors).
 * Allows setting crtPem, which is not exposed to users.
 */
export class InternalUpdateTlsCrtDto extends UpdateTlsCrtDto {
  crtPem?: string | null;
}
