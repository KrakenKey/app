import { IsIn, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LOGIN_SOURCES, type LoginSource } from '../login-sources';

export class LoginQueryDto {
  @ApiPropertyOptional({
    description:
      'Sign in with an external account instead of showing the login page. "microsoft" accepts work, school and personal Microsoft accounts and creates a KrakenKey account on first sign-in.',
    enum: LOGIN_SOURCES,
  })
  @IsOptional()
  @IsIn(LOGIN_SOURCES)
  source?: LoginSource;
}

export class ConnectQueryDto {
  @ApiProperty({
    description: 'External account to connect to the signed-in account',
    enum: LOGIN_SOURCES,
  })
  @IsIn(LOGIN_SOURCES)
  source: LoginSource;
}
