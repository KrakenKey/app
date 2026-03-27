import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PassportModule } from '@nestjs/passport';
import { AuthentikProxyStrategy } from './strategies/authentik-proxy.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { ApiKeyStrategy } from './strategies/api-key.strategy';
import { ServiceKeyStrategy } from './strategies/service-key.strategy';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserApiKey } from './entities/user-api-key.entity';
import { ServiceApiKey } from './entities/service-api-key.entity';
import { User } from '../users/entities/user.entity';
import { Domain } from '../domains/entities/domain.entity';
import { TlsCrt } from '../certs/tls/entities/tls-crt.entity';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    TypeOrmModule.forFeature([UserApiKey, ServiceApiKey, User, Domain, TlsCrt]),
    BillingModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthentikProxyStrategy,
    JwtStrategy,
    ApiKeyStrategy,
    ServiceKeyStrategy,
  ],
  exports: [AuthService],
})
export class AuthModule {}
