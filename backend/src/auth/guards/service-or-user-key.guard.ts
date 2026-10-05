import {
  Injectable,
  ExecutionContext,
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { assertApiKeyScope } from '../decorators/require-scope.decorator';
import { hasResourceRestrictions } from '../api-key-restrictions';

/**
 * Dual-auth guard for probe endpoints.
 *
 * Tries all three strategies in order:
 * 1. service-key  (hosted probes: kk_svc_ prefix)
 * 2. api-key      (connected probes: kk_ prefix)
 * 3. jwt          (connected probes: OIDC JWT)
 *
 * The first strategy that returns a non-null user wins. A user API key must
 * carry the route's scope (probes:report) and must not be limited to
 * specific domains or certificates: a probe sees every endpoint assigned to
 * it, so those limits could not be honoured.
 */
@Injectable()
export class ServiceOrUserKeyGuard extends AuthGuard([
  'service-key',
  'api-key',
  'jwt',
]) {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const result = (await super.canActivate(context)) as boolean;
    const req = context.switchToHttp().getRequest();
    assertApiKeyScope(this.reflector, context);
    if (hasResourceRestrictions(req.user?.apiKey)) {
      Logger.warn(
        `API key ${req.user.apiKey.id} refused on ${req.method} ${req.url}: limited to specific domains or certificates`,
      );
      throw new ForbiddenException(
        'API keys limited to specific domains or certificates cannot be used by probes.',
      );
    }
    return result;
  }

  handleRequest(
    err: any,
    user: any,
    _info: any,
    _context: ExecutionContext,
    _status?: any,
  ) {
    if (err || !user) {
      throw err || new UnauthorizedException();
    }
    return user;
  }
}
