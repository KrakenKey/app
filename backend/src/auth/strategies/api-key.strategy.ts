import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import { Request } from 'express';
import { AuthService } from '../auth.service';
import { ApiKeySecurityService } from '../services/api-key-security.service';

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(Strategy, 'api-key') {
  constructor(
    private readonly authService: AuthService,
    private readonly apiKeySecurity: ApiKeySecurityService,
  ) {
    super();
  }

  async validate(req: Request) {
    const authHeader = req.headers['authorization'];
    if (
      !authHeader?.startsWith('Bearer kk_') ||
      authHeader.startsWith('Bearer kk_svc_')
    ) {
      // Not an API key token — return null so Passport tries other strategies
      return null;
    }

    // Brute-force lockout check runs before any hashing work.
    const ip = req.ip ?? '';
    if (await this.apiKeySecurity.isLockedOut(ip)) {
      throw new HttpException(
        'Too many failed API key attempts. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const apiKey = authHeader.split(' ')[1];
    const record = await this.authService.validateApiKey(apiKey, { ip });
    if (!record) {
      await this.apiKeySecurity.recordFailure(ip);
      throw new UnauthorizedException('Invalid API key');
    }

    return {
      userId: record.user.id,
      apiKeyId: record.id,
      groups: record.user.groups,
    };
  }
}
