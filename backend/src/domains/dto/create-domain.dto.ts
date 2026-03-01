import { IsNotEmpty, IsString, IsFQDN } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDomainDto {
  @ApiProperty({
    description: 'Fully qualified domain name',
    example: 'example.com',
  })
  @IsNotEmpty()
  @IsString()
  hostname: string;
}
