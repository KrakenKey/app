import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private configService: ConfigService) {
    const jwksUri = `${(configService.get<string>('KK_AUTHENTIK_ISSUER_URL') || '').replace(/\/$/, '')}/jwks/`;

    const jwksProvider = passportJwtSecret({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri,
    });

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKeyProvider: (req: any, rawJwtToken: any, done: any) => {
        jwksProvider(req, rawJwtToken, (err: any, key: any) => {
          if (err) {
            Logger.error(
              `JWKS key fetch failed from ${jwksUri}: ${err.message}`,
              'JwtStrategy',
            );
          }
          done(err, key);
        });
      },
      algorithms: ['RS256'],
      ignoreExpiration: false,
    });
    Logger.log(
      `JwtStrategy initialized with JWKS URI: ${jwksUri}`,
      'JwtStrategy',
    );
  }

  validate(payload: JwtPayload) {
    const expectedIssuer = this.configService.get<string>(
      'KK_AUTHENTIK_ISSUER_URL',
    );
    if (payload.iss !== expectedIssuer) {
      throw new UnauthorizedException(
        `Issuer mismatch: expected ${expectedIssuer}, got ${payload.iss}`,
      );
    }

    return {
      userId: payload.sub,
      username: payload.preferred_username,
      email: payload.email,
      groups: payload.groups || [],
    };
  }
}
