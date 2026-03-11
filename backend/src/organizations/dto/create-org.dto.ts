import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateOrgDto {
  @ApiProperty({ example: 'Acme Corp', description: 'Organization name' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;
}
