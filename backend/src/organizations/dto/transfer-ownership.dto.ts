import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class TransferOwnershipDto {
  @ApiProperty({
    description: 'User ID of the member to transfer ownership to',
  })
  @IsString()
  targetUserId: string;
}
