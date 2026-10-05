import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { REQUIRED_SCOPES_KEY } from './require-scope.decorator';
import { SESSION_ONLY_KEY } from './session-only.decorator';
import { JwtOrApiKeyGuard } from '../guards/jwt-or-api-key.guard';
import { ServiceOrUserKeyGuard } from '../guards/service-or-user-key.guard';

/**
 * Routes that accept a user API key but declare no scope on purpose. A
 * scoped key is refused on them (fail closed); full-access keys are refused
 * by the handler itself.
 */
const NO_SCOPE_BY_DESIGN: Record<string, string> = {
  'GET /users': 'AdminGuard refuses every API key',
  'GET /auth/device/:userCode': 'assertBrowserSession refuses API keys',
  'POST /auth/device/approve': 'assertBrowserSession refuses API keys',
  'POST /auth/device/deny': 'assertBrowserSession refuses API keys',
};

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
  acceptsKeys: boolean;
  sessionOnly: boolean;
  scopes: string[] | undefined;
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
      const verb = Reflect.getMetadata(METHOD_METADATA, handler);
      if (verb === undefined) continue;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
      const guards = [
        ...classGuards,
        ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []),
      ];
      out.push({
        route: `${RequestMethod[verb]} /${base}${path === '/' ? '' : `/${path}`}`,
        acceptsKeys:
          guards.includes(JwtOrApiKeyGuard) ||
          guards.includes(ServiceOrUserKeyGuard),
        sessionOnly: Boolean(
          Reflect.getMetadata(SESSION_ONLY_KEY, handler) ??
          Reflect.getMetadata(SESSION_ONLY_KEY, ctrl),
        ),
        scopes:
          Reflect.getMetadata(REQUIRED_SCOPES_KEY, handler) ??
          Reflect.getMetadata(REQUIRED_SCOPES_KEY, ctrl),
      });
    }
  }
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

describe('@RequireScope coverage', () => {
  const all = routes();

  it('finds the controllers', () => {
    expect(all.filter((r) => r.acceptsKeys).length).toBeGreaterThan(40);
  });

  it('every route that accepts API keys declares a scope or is session-only', () => {
    const missing = all
      .filter((r) => r.acceptsKeys && !r.sessionOnly && !r.scopes?.length)
      .map((r) => r.route)
      .filter((route) => !(route in NO_SCOPE_BY_DESIGN));
    expect(missing).toEqual([]);
  });

  it('keeps the no-scope exceptions current', () => {
    const known = new Set(all.map((r) => r.route));
    for (const route of Object.keys(NO_SCOPE_BY_DESIGN)) {
      expect(known).toContain(route);
    }
  });

  it('does not put scopes on session-only routes', () => {
    expect(
      all.filter((r) => r.sessionOnly && r.scopes).map((r) => r.route),
    ).toEqual([]);
  });

  // Pins the scope of every route. Changing one should be a deliberate edit
  // here, since it changes what existing scoped keys can do.
  it('maps routes to scopes', () => {
    const map = Object.fromEntries(
      all.filter((r) => r.scopes).map((r) => [r.route, r.scopes!.join('|')]),
    );
    expect(map).toEqual({
      'DELETE /certs/tls/:id': 'certs:revoke',
      'DELETE /domains/:id': 'domains:write',
      'DELETE /endpoints/:id': 'endpoints:write',
      'DELETE /endpoints/:id/probes/:probeId': 'endpoints:write',
      'DELETE /endpoints/:id/regions/:region': 'endpoints:write',
      'GET /auth/api-keys': 'account:read',
      'GET /auth/profile': 'account:read',
      'GET /billing/subscription': 'account:read',
      'GET /certs/tls': 'certs:read',
      'GET /certs/tls/:id': 'certs:read',
      'GET /certs/tls/:id/chain': 'certs:read',
      'GET /certs/tls/:id/details': 'certs:read',
      'GET /domains': 'domains:read',
      'GET /domains/:id': 'domains:read',
      'GET /endpoints': 'endpoints:read',
      'GET /endpoints/:id': 'endpoints:read',
      'GET /endpoints/:id/results': 'endpoints:read',
      'GET /endpoints/:id/results/export': 'endpoints:read',
      'GET /endpoints/:id/results/latest': 'endpoints:read',
      'GET /endpoints/probes/mine': 'endpoints:read',
      'GET /organizations/:id': 'account:read',
      'GET /probes/:probeId/config': 'probes:report',
      'GET /users/:id': 'account:read',
      'PATCH /auth/profile': 'account:write',
      'PATCH /certs/tls/:id': 'certs:renew',
      'PATCH /endpoints/:id': 'endpoints:write',
      'POST /auth/confirm-auto-renewal': 'account:write',
      'POST /billing/upgrade/preview': 'account:read',
      'POST /certs/tls': 'certs:issue',
      'POST /certs/tls/:id/renew': 'certs:renew',
      'POST /certs/tls/:id/retry': 'certs:issue',
      'POST /certs/tls/:id/revoke': 'certs:revoke',
      'POST /domains': 'domains:write',
      'POST /domains/:id/verify': 'domains:write',
      'POST /endpoints': 'endpoints:write',
      'POST /endpoints/:id/probes': 'endpoints:write',
      'POST /endpoints/:id/regions': 'endpoints:write',
      'POST /endpoints/:id/scan': 'endpoints:write',
      'POST /feedback': 'account:write',
      'POST /probes/register': 'probes:report',
      'POST /probes/report': 'probes:report',
    });
  });
});
