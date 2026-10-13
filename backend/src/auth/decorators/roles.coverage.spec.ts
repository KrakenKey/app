import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import type { OrgRole } from '@krakenkey/shared';
import { ROLES_KEY } from './roles.decorator';
import { JwtOrApiKeyGuard } from '../guards/jwt-or-api-key.guard';
import { ServiceOrUserKeyGuard } from '../guards/service-or-user-key.guard';
import { RoleGuard } from '../guards/role.guard';

/**
 * Authenticated write routes an org viewer may still call, and why. Every
 * other POST, PUT, PATCH or DELETE behind the auth guards must refuse
 * viewers with @Roles(). Adding a route here should be a deliberate choice.
 */
const OPEN_TO_VIEWERS: Record<string, string> = {
  'DELETE /auth/api-keys/:id': "the caller's own credentials",
  'DELETE /auth/github-oidc/trusts/:id': "the caller's own credentials",
  'DELETE /connectors/:id': "revokes the caller's own connector credentials",
  'DELETE /connectors/config': 'connector-issued keys only',
  'DELETE /users/:id': "the caller's own account",
  'PATCH /auth/profile': "the caller's own profile",
  'PATCH /users/:id': "the caller's own account",
  'POST /auth/api-keys': "the caller's own credentials",
  'POST /auth/confirm-auto-renewal': "the caller's own setting",
  'POST /auth/device/approve': "the caller's own credentials",
  'POST /auth/device/deny': "the caller's own credentials",
  'POST /auth/github-oidc/trusts': "the caller's own credentials",
  'POST /billing/checkout': 'BillingService allows only the org owner',
  'POST /billing/marketplace/activate':
    'MarketplaceService allows only the org owner',
  'POST /billing/marketplace/resolve': 'read-only purchase lookup',
  'POST /billing/portal': 'BillingService allows only the org owner',
  'POST /billing/upgrade': 'BillingService allows only the org owner',
  'POST /billing/upgrade/preview': 'read-only price preview',
  'POST /connectors/report': 'connector-issued keys only',
  'POST /feedback': 'anyone may send feedback',
  'POST /organizations': 'creating a new organization',
  'POST /probes/register': 'probe keys; endpoints are assigned by members',
  'POST /probes/report': 'probe keys; endpoints are assigned by members',
  'PUT /connectors/config': 'connector-issued keys only',
};

const WRITE_VERBS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type Ctor = { new (...args: any[]): any; name: string };

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return controllerFiles(full);
    return entry.endsWith('.controller.ts') ? [full] : [];
  });
}

function allControllers(): Ctor[] {
  const root = join(__dirname, '..', '..');
  return controllerFiles(root).flatMap((file) =>
    // Loaded by path so a new controller file is checked without editing this test.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Object.values(require(file) as Record<string, unknown>).filter(
      (v): v is Ctor =>
        typeof v === 'function' &&
        Reflect.hasMetadata(PATH_METADATA, v as object),
    ),
  );
}

interface Route {
  route: string;
  verb: string;
  authenticated: boolean;
  roleGuard: boolean;
  roles: OrgRole[] | undefined;
}

function routes(): Route[] {
  const out: Route[] = [];
  for (const ctrl of allControllers()) {
    const base = (Reflect.getMetadata(PATH_METADATA, ctrl) as string).replace(
      /^\/|\/$/g,
      '',
    );
    const classGuards: unknown[] =
      Reflect.getMetadata(GUARDS_METADATA, ctrl) ?? [];
    for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
      const handler = ctrl.prototype[name];
      if (typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler);
      if (method === undefined) continue;
      const verb = RequestMethod[method];
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
      const guards = [
        ...classGuards,
        ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []),
      ];
      out.push({
        route: `${verb} /${base}${path === '/' ? '' : `/${path}`}`,
        verb,
        authenticated:
          guards.includes(JwtOrApiKeyGuard) ||
          guards.includes(ServiceOrUserKeyGuard),
        roleGuard: guards.includes(RoleGuard),
        roles:
          Reflect.getMetadata(ROLES_KEY, handler) ??
          Reflect.getMetadata(ROLES_KEY, ctrl),
      });
    }
  }
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

describe('@Roles coverage', () => {
  const all = routes();
  const writes = all.filter((r) => r.authenticated && WRITE_VERBS.has(r.verb));

  it('finds the controllers', () => {
    expect(writes.length).toBeGreaterThan(40);
  });

  it('applies RoleGuard wherever @Roles() is set', () => {
    // Without the guard the decorator does nothing.
    expect(
      all.filter((r) => r.roles?.length && !r.roleGuard).map((r) => r.route),
    ).toEqual([]);
  });

  it('refuses viewers on every authenticated write route unless listed', () => {
    const open = writes
      .filter((r) => !r.roles?.length || r.roles.includes('viewer'))
      .map((r) => r.route)
      .sort();
    expect(open).toEqual(Object.keys(OPEN_TO_VIEWERS).sort());
  });

  it('refuses viewers on report and alert channel changes', () => {
    const viewerBlocked = (route: string) => {
      const r = all.find((x) => x.route === route);
      return Boolean(
        r?.roleGuard && r.roles?.length && !r.roles.includes('viewer'),
      );
    };
    for (const route of [
      'POST /reports',
      'DELETE /reports/:id',
      'POST /reports/:id/share',
      'DELETE /reports/:id/share',
      'POST /notifications/channels',
      'PATCH /notifications/channels/:id',
      'DELETE /notifications/channels/:id',
      'POST /notifications/channels/:id/test',
      'POST /notifications/channels/:id/rotate-secret',
      'POST /connectors',
      'POST /connectors/:id/enrollment-token',
      'PATCH /connectors/:id',
    ]) {
      expect([route, viewerBlocked(route)]).toEqual([route, true]);
    }
  });
});
