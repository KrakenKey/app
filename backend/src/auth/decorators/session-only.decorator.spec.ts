import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { SESSION_ONLY_KEY } from './session-only.decorator';
import { AuthController } from '../auth.controller';
import { UsersController } from '../../users/users.controller';
import { OrganizationsController } from '../../organizations/organizations.controller';
import { BillingController } from '../../billing/billing.controller';
import { DomainsController } from '../../domains/domains.controller';
import { TlsController } from '../../certs/tls/tls.controller';
import { EndpointsController } from '../../endpoints/endpoints.controller';
import { ConnectorsController } from '../../connectors/connectors.controller';
import { GithubOidcController } from '../oidc/github-oidc.controller';

// Pins which routes refuse API keys. Adding or dropping one should be a
// deliberate change to this list, not a side effect.
const controllers = [
  AuthController,
  UsersController,
  OrganizationsController,
  BillingController,
  DomainsController,
  TlsController,
  EndpointsController,
  GithubOidcController,
  ConnectorsController,
];

function sessionOnlyRoutes(): string[] {
  const routes: string[] = [];
  for (const ctrl of controllers) {
    const base = Reflect.getMetadata(PATH_METADATA, ctrl) as string;
    for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
      const handler = ctrl.prototype[name];
      if (!Reflect.getMetadata(SESSION_ONLY_KEY, handler)) continue;
      const method =
        RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)];
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
      routes.push(`${method} /${base}${path === '/' ? '' : `/${path}`}`);
    }
  }
  return routes.sort();
}

describe('@SessionOnly routes', () => {
  it('covers key and connector management, account, org and billing changes', () => {
    expect(sessionOnlyRoutes()).toEqual(
      [
        'POST /auth/api-keys',
        'DELETE /auth/api-keys/:id',
        'PATCH /users/:id',
        'DELETE /users/:id',
        'POST /organizations',
        'POST /organizations/:id/members',
        'DELETE /organizations/:id/members/:userId',
        'PATCH /organizations/:id',
        'DELETE /organizations/:id',
        'POST /organizations/:id/transfer-ownership',
        'PATCH /organizations/:id/members/:userId',
        'POST /billing/checkout',
        'POST /billing/portal',
        'POST /billing/upgrade',
        'POST /auth/github-oidc/trusts',
        'DELETE /auth/github-oidc/trusts/:id',
        'POST /connectors',
        'POST /connectors/:id/enrollment-token',
        'PATCH /connectors/:id',
        'DELETE /connectors/:id',
      ].sort(),
    );
  });
});
