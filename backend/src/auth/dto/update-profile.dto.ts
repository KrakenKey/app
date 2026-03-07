import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: 'User display name',
    example: 'John Doe',
    maxLength: 100,
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  displayName?: string;
}
