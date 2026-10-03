import type { Type } from '@nestjs/common';
import { AppController } from '../app.controller';
import { AuthController } from '../auth/auth.controller';
import { BillingController } from '../billing/billing.controller';
import { TlsController } from '../certs/tls/tls.controller';
import { DomainsController } from '../domains/domains.controller';
import { EndpointsController } from '../endpoints/endpoints.controller';
import { FeedbackController } from '../feedback/feedback.controller';
import { HealthController } from '../health/health.controller';
import { OrganizationsController } from '../organizations/organizations.controller';
import { ProbesController } from '../probes/probes.controller';
import { PublicScanController } from '../public-scan/public-scan.controller';
import { UsersController } from '../users/users.controller';

/**
 * Controllers included in the exported OpenAPI spec (scripts/export-openapi.ts),
 * which scans them without booting the app. Controllers marked
 * @ApiExcludeController are left out; openapi-controllers.spec.ts fails if a
 * new controller is neither listed here nor excluded.
 */
export const OPENAPI_CONTROLLERS: Type<unknown>[] = [
  AppController,
  AuthController,
  BillingController,
  TlsController,
  DomainsController,
  EndpointsController,
  FeedbackController,
  HealthController,
  OrganizationsController,
  ProbesController,
  PublicScanController,
  UsersController,
];
