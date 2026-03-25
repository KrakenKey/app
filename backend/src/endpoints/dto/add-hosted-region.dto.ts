import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddHostedRegionDto {
  @ApiProperty({
    description: 'Hosted probe region identifier',
    example: 'us-east-1',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  region: string;
}
