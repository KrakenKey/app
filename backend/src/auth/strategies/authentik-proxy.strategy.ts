import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom'; // npm install passport-custom
import { Request } from 'express';

@Injectable()
export class AuthentikProxyStrategy extends PassportStrategy(
  Strategy,
  'forward-auth',
) {
  validate(req: Request) {
    // Verify that the request is coming from the authentik-proxy by checking the client IP address
    const forwarded = req.headers['x-forwarded-for'];
    const forwardedFirst =
      typeof forwarded === 'string'
        ? forwarded.split(',')[0].trim()
        : undefined;

    const rawClientIp =
      forwardedFirst || req.ip || req.socket?.remoteAddress || null;
    const normalizedClientIp =
      typeof rawClientIp === 'string' && rawClientIp.startsWith('::ffff:')
        ? rawClientIp.split(':').pop()
        : rawClientIp;

    if (normalizedClientIp !== '172.22.0.2') {
      throw new UnauthorizedException('Request must come from Proxy');
    }
    // These headers are defined in docker-compose labels
    const username = req.headers['x-authentik-username'];
    const email = req.headers['x-authentik-email'];
    const groups = req.headers['x-authentik-groups'];
    // !!! Needs Implementation
    // allowed domains to request certs for

    if (!username) {
      return null; // Unauthorized
    }

    return {
      username,
      email,
      groups: groups ? String(groups).split(',') : [],
    };
  }
}
