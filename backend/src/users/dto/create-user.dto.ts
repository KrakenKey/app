import {
  IsEmail,
  IsString,
  IsOptional,
  IsArray,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ description: 'Unique username', example: 'jdoe' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  username: string;

  @ApiProperty({
    description: 'User email address',
    example: 'jdoe@example.com',
  })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ description: 'User groups', example: ['users'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  groups?: string[];
}
