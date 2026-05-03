import {
  IsNotEmpty,
  IsString,
  MaxLength,
  IsOptional,
  IsInt,
  IsIn,
  Matches,
} from 'class-validator';

export class PublicScanRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(253)
  @Matches(/^[a-zA-Z0-9]([a-zA-Z0-9\-.]*[a-zA-Z0-9])?$/, {
    message: 'hostname must be a valid DNS name',
  })
  hostname: string;

  @IsOptional()
  @IsInt()
  @IsIn([443, 8443])
  port?: number;
}
