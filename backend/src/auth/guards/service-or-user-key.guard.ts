import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Dual-auth guard for probe endpoints.
 *
 * Tries all three strategies in order:
 * 1. service-key  (hosted probes: kk_svc_ prefix)
 * 2. api-key      (connected probes: kk_ prefix)
 * 3. jwt          (connected probes: OIDC JWT)
 *
 * The first strategy that returns a non-null user wins.
 */
@Injectable()
export class ServiceOrUserKeyGuard extends AuthGuard([
  'service-key',
  'api-key',
  'jwt',
]) {
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
