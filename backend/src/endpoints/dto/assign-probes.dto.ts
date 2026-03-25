import { IsArray, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignProbesDto {
  @ApiProperty({
    description: 'IDs of connected probes to assign',
    example: ['probe-uuid-1'],
  })
  @IsArray()
  @IsNotEmpty()
  @IsString({ each: true })
  probeIds: string[];
}
