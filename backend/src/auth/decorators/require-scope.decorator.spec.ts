import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { API_KEY_PRESETS, type ApiKeyScope } from '@krakenkey/shared';
import { assertApiKeyScope } from './require-scope.decorator';
import type { ApiKeyContext } from '../api-key-restrictions';
import { TlsController } from '../../certs/tls/tls.controller';
import { DomainsController } from '../../domains/domains.controller';
import { EndpointsController } from '../../endpoints/endpoints.controller';
import { AuthController } from '../auth.controller';
import { ProbesController } from '../../probes/probes.controller';
import { ServiceOrUserKeyGuard } from '../guards/service-or-user-key.guard';

function ctx(
  ctrl: { prototype: object },
  method: string,
  user: unknown,
): ExecutionContext {
  const req = { method: 'GET', url: `/${method}`, user };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => (ctrl.prototype as Record<string, unknown>)[method],
    getClass: () => ctrl,
  } as unknown as ExecutionContext;
}

function keyUser(
  scopes: ApiKeyScope[] | null,
  over: Partial<ApiKeyContext> = {},
) {
  return {
    userId: 'u1',
    apiKeyId: 'key-1',
    apiKey: {
      id: 'key-1',
      scopes,
      allowedDomainIds: null,
      allowedCertIds: null,
      ...over,
    },
  };
}

describe('assertApiKeyScope', () => {
  const reflector = new Reflector();
  const check =
    (ctrl: { prototype: object }, method: string, user: unknown) => () =>
      assertApiKeyScope(reflector, ctx(ctrl, method, user));

  it('lets dashboard sessions and full-access keys through', () => {
    expect(check(TlsController, 'revoke', { userId: 'u1' })).not.toThrow();
    expect(check(TlsController, 'revoke', keyUser(null))).not.toThrow();
  });

  it('refuses a scoped key on a route that declares no scope', () => {
    class Bare {
      handler() {}
    }
    expect(check(Bare, 'handler', keyUser(['certs:read']))).toThrow(
      ForbiddenException,
    );
  });

  describe('cert-renewal preset', () => {
    const user = keyUser(API_KEY_PRESETS['cert-renewal']);

    it.each([
      [TlsController, 'findAll'],
      [TlsController, 'findOne'],
      [TlsController, 'getDetails'],
      [TlsController, 'getChain'],
      [TlsController, 'renew'],
      [TlsController, 'update'],
      [AuthController, 'getProfile'],
    ])('can use %p.%s', (ctrl, method) => {
      expect(check(ctrl, method, user)).not.toThrow();
    });

    it.each([
      [TlsController, 'revoke'],
      [TlsController, 'remove'],
      [TlsController, 'create'],
      [TlsController, 'retry'],
      [DomainsController, 'create'],
      [DomainsController, 'verify'],
      [DomainsController, 'remove'],
      [EndpointsController, 'create'],
      [ProbesController, 'report'],
    ])('gets 403 on %p.%s', (ctrl, method) => {
      expect(check(ctrl, method, user)).toThrow(ForbiddenException);
    });

    it('names the missing scope in the error', () => {
      expect(check(TlsController, 'revoke', user)).toThrow(
        'This API key needs the certs:revoke scope for this request.',
      );
    });
  });

  describe('read-only preset', () => {
    const user = keyUser(API_KEY_PRESETS['read-only']);

    it('reads but never writes', () => {
      expect(check(TlsController, 'findAll', user)).not.toThrow();
      expect(check(DomainsController, 'findAll', user)).not.toThrow();
      expect(check(EndpointsController, 'getResults', user)).not.toThrow();
      expect(check(TlsController, 'renew', user)).toThrow(ForbiddenException);
      expect(check(DomainsController, 'create', user)).toThrow(
        ForbiddenException,
      );
      expect(check(AuthController, 'updateProfile', user)).toThrow(
        ForbiddenException,
      );
    });
  });

  it('probe preset can only report', () => {
    const user = keyUser(API_KEY_PRESETS.probe);
    expect(check(ProbesController, 'register', user)).not.toThrow();
    expect(check(ProbesController, 'getConfig', user)).not.toThrow();
    expect(check(TlsController, 'findAll', user)).toThrow(ForbiddenException);
  });
});

describe('ServiceOrUserKeyGuard', () => {
  const parent = Object.getPrototypeOf(ServiceOrUserKeyGuard.prototype) as {
    canActivate: () => Promise<boolean>;
  };
  let spy: jest.SpyInstance;
  const guard = new ServiceOrUserKeyGuard(new Reflector());

  beforeEach(() => {
    spy = jest.spyOn(parent, 'canActivate').mockResolvedValue(true);
  });
  afterEach(() => spy.mockRestore());

  it('is built on the passport AuthGuard', () => {
    expect(guard).toBeInstanceOf(AuthGuard(['service-key', 'api-key', 'jwt']));
  });

  it('lets service keys and probe-scoped keys report', async () => {
    await expect(
      guard.canActivate(
        ctx(ProbesController, 'report', { isServiceKey: true }),
      ),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(
        ctx(ProbesController, 'report', keyUser(['probes:report'])),
      ),
    ).resolves.toBe(true);
  });

  it('refuses a key without probes:report', async () => {
    await expect(
      guard.canActivate(
        ctx(ProbesController, 'report', keyUser(['certs:read'])),
      ),
    ).rejects.toThrow('needs the probes:report scope');
  });

  it('refuses keys limited to domains or certificates', async () => {
    await expect(
      guard.canActivate(
        ctx(
          ProbesController,
          'report',
          keyUser(null, { allowedDomainIds: ['d1'] }),
        ),
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
