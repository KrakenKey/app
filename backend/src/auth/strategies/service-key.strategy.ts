import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import type { Request } from 'express';
import { AuthService } from '../auth.service';

@Injectable()
export class ServiceKeyStrategy extends PassportStrategy(
  Strategy,
  'service-key',
) {
  constructor(private readonly authService: AuthService) {
    super();
  }

  async validate(req: Request) {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer kk_svc_')) {
      return null;
    }

    const rawKey = authHeader.split(' ')[1];
    const record = await this.authService.validateServiceKey(rawKey);
    if (!record) throw new UnauthorizedException('Invalid service key');

    return {
      serviceKeyId: record.id,
      isServiceKey: true,
    };
  }
}
