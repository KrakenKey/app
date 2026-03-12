import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';

export class TransferOwnershipDto {
  @ApiProperty({
    description: 'Email address of the member to transfer ownership to',
    example: 'alice@example.com',
  })
  @IsEmail()
  @IsString()
  email: string;
}
