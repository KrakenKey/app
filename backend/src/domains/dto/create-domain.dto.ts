import { IsFQDN, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDomainDto {
  @ApiProperty({
    description: 'Fully qualified domain name',
    example: 'example.com',
  })
  @IsNotEmpty()
  @IsFQDN()
  @MaxLength(253)
  hostname: string;
}
