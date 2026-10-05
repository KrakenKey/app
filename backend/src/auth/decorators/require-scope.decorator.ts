import {
  ExecutionContext,
  ForbiddenException,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { ApiKeyScope } from '@krakenkey/shared';
import type { ApiKeyContext } from '../api-key-restrictions';

export const REQUIRED_SCOPES_KEY = 'requiredScopes';

/**
 * The scope an API key needs for this route (any one of them, if several
 * are listed). Keys with full access and dashboard sessions are not
 * affected.
 *
 * A key with scopes is refused on any route that declares none, so a route
 * that forgets this decorator fails closed. require-scope.coverage.spec.ts
 * checks that every key-accepting route declares one.
 */
export const RequireScope = (...scopes: ApiKeyScope[]) =>
  SetMetadata(REQUIRED_SCOPES_KEY, scopes);

/**
 * Throws 403 when the request was made with a scoped API key that lacks
 * the route's scope. Called by JwtOrApiKeyGuard and ServiceOrUserKeyGuard
 * after authentication.
 */
export function assertApiKeyScope(
  reflector: Reflector,
  context: ExecutionContext,
): void {
  const req = context.switchToHttp().getRequest();
  const key: ApiKeyContext | undefined = req.user?.apiKey;
  if (!key?.scopes) return;

  const required = reflector.getAllAndOverride<ApiKeyScope[] | undefined>(
    REQUIRED_SCOPES_KEY,
    [context.getHandler(), context.getClass()],
  );
  if (required?.some((scope) => key.scopes!.includes(scope))) return;

  Logger.warn(
    `API key ${key.id} refused on ${req.method} ${req.url}: needs ${
      required?.length
        ? required.join(' or ')
        : 'a scope this route does not offer'
    }, has ${key.scopes.join(', ') || 'none'}`,
  );
  throw new ForbiddenException(
    required?.length
      ? `This API key needs the ${required.join(' or ')} scope for this request.`
      : 'This API key is limited to specific scopes and cannot be used for this request.',
  );
}
