import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, Max } from 'class-validator';

export class RevokeTlsCrtDto {
  @ApiPropertyOptional({
    description:
      'RFC 5280 revocation reason code: 0=unspecified, 1=keyCompromise, 3=affiliationChanged, 4=superseded, 5=cessationOfOperation',
    example: 0,
    minimum: 0,
    maximum: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  reason?: number;
}
