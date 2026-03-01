import { IsString, IsNotEmpty, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTlsCrtDto {
  @ApiProperty({
    description: 'PEM-encoded Certificate Signing Request',
    example:
      '-----BEGIN CERTIFICATE REQUEST-----\n...\n-----END CERTIFICATE REQUEST-----',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000, { message: 'CSR PEM must be 10,000 characters or less' })
  @Matches(
    /^-----BEGIN CERTIFICATE REQUEST-----[\s\S]+-----END CERTIFICATE REQUEST-----\s*$/,
    { message: 'CSR must be in valid PEM format' },
  )
  csrPem: string;
}
