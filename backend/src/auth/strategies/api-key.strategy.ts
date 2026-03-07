import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import { Request } from 'express';
import { AuthService } from '../auth.service';

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(Strategy, 'api-key') {
  constructor(private readonly authService: AuthService) {
    super();
  }

  async validate(req: Request) {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer kk_')) {
      // Not an API key token — return null so Passport tries other strategies
      return null;
    }

    const apiKey = authHeader.split(' ')[1];
    const record = await this.authService.validateApiKey(apiKey);
    if (!record) throw new UnauthorizedException('Invalid API key');

    return {
      userId: record.user.id,
      apiKeyId: record.id,
      groups: record.user.groups,
    };
  }
}
