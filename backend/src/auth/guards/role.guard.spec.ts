import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { RoleGuard } from './role.guard';
import { JwtOrApiKeyGuard } from './jwt-or-api-key.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { TlsController } from '../../certs/tls/tls.controller';
import { DomainsController } from '../../domains/domains.controller';
import { EndpointsController } from '../../endpoints/endpoints.controller';
import { OrganizationsController } from '../../organizations/organizations.controller';

describe('RoleGuard', () => {
  let reflector: Reflector;
  let findOne: jest.Mock;
  let guard: RoleGuard;

  const context = (user?: { userId: string }) =>
    ({
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = new Reflector();
    findOne = jest.fn();
    const dataSource = {
      getRepository: () => ({ findOne }),
    } as unknown as DataSource;
    guard = new RoleGuard(reflector, dataSource);
  });

  const requireRoles = (roles: string[] | undefined) =>
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles);

  it('passes routes without @Roles()', async () => {
    requireRoles(undefined);
    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('rejects @Roles() routes when no user is authenticated', async () => {
    requireRoles(['owner', 'admin', 'member']);
    await expect(guard.canActivate(context())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects a viewer on a member-only route', async () => {
    requireRoles(['owner', 'admin', 'member']);
    findOne.mockResolvedValue({ id: 'u1', role: 'viewer' });
    await expect(guard.canActivate(context({ userId: 'u1' }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows a member on a member-only route', async () => {
    requireRoles(['owner', 'admin', 'member']);
    findOne.mockResolvedValue({ id: 'u1', role: 'member' });
    await expect(guard.canActivate(context({ userId: 'u1' }))).resolves.toBe(
      true,
    );
  });

  it('allows solo users with no org role', async () => {
    requireRoles(['owner']);
    findOne.mockResolvedValue({ id: 'u1', role: null });
    await expect(guard.canActivate(context({ userId: 'u1' }))).resolves.toBe(
      true,
    );
  });

  // Global guards run before controller guards, so RoleGuard only sees
  // req.user when it is applied after the auth guard on the controller.
  describe.each([
    TlsController,
    DomainsController,
    EndpointsController,
    OrganizationsController,
  ])('%p', (controller) => {
    it('applies RoleGuard after JwtOrApiKeyGuard', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
      expect(guards.indexOf(JwtOrApiKeyGuard)).toBe(0);
      expect(guards.indexOf(RoleGuard)).toBe(1);
    });

    it('uses @Roles() somewhere', () => {
      const handlers = Object.getOwnPropertyNames(controller.prototype).map(
        (name) => controller.prototype[name],
      );
      const withRoles = handlers.filter(
        (h) => typeof h === 'function' && Reflect.getMetadata(ROLES_KEY, h),
      );
      expect(withRoles.length).toBeGreaterThan(0);
    });
  });
});
