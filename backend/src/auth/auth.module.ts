import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PassportModule } from '@nestjs/passport';
import { AuthentikProxyStrategy } from './strategies/authentik-proxy.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { ApiKeyStrategy } from './strategies/api-key.strategy';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserApiKey } from './entities/user-api-key.entity';
import { User } from '../users/entities/user.entity';
import { Domain } from '../domains/entities/domain.entity';
import { TlsCrt } from '../certs/tls/entities/tls-crt.entity';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    TypeOrmModule.forFeature([UserApiKey, User, Domain, TlsCrt]),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthentikProxyStrategy, JwtStrategy, ApiKeyStrategy],
})
export class AuthModule {}
