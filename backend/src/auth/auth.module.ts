import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy';
import { ApiKeyStrategy } from './strategies/api-key.strategy';
import { ServiceKeyStrategy } from './strategies/service-key.strategy';
import { ApiKeyUserResolverService } from './services/api-key-user-resolver.service';
import { ApiKeySecurityService } from './services/api-key-security.service';
import { DeviceAuthService } from './services/device-auth.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserApiKey } from './entities/user-api-key.entity';
import { ServiceApiKey } from './entities/service-api-key.entity';
import { User } from '../users/entities/user.entity';
import { Domain } from '../domains/entities/domain.entity';
import { TlsCrt } from '../certs/tls/entities/tls-crt.entity';
import { BillingModule } from '../billing/billing.module';
import { GithubOidcTrust } from './entities/github-oidc-trust.entity';
import { GithubOidcController } from './oidc/github-oidc.controller';
import { GithubOidcService } from './oidc/github-oidc.service';
import { GithubOidcVerifier } from './oidc/github-oidc.verifier';
import { GithubRepoLookup } from './oidc/github-repo-lookup';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    TypeOrmModule.forFeature([
      UserApiKey,
      ServiceApiKey,
      User,
      Domain,
      TlsCrt,
      GithubOidcTrust,
    ]),
    BillingModule,
  ],
  controllers: [AuthController, GithubOidcController],
  providers: [
    AuthService,
    ApiKeySecurityService,
    DeviceAuthService,
    JwtStrategy,
    ApiKeyStrategy,
    ServiceKeyStrategy,
    GithubOidcVerifier,
    GithubRepoLookup,
    GithubOidcService,
    ApiKeyUserResolverService,
  ],
  exports: [AuthService, ApiKeyUserResolverService],
})
export class AuthModule {}
