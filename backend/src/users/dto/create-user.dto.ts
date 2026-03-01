import { IsEmail, IsString, IsOptional, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ description: 'Unique username', example: 'jdoe' })
  @IsString()
  username: string;

  @ApiProperty({
    description: 'User email address',
    example: 'jdoe@example.com',
  })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ description: 'User groups', example: ['users'] })
  @IsOptional()
  @IsArray()
  groups?: string[];
}
