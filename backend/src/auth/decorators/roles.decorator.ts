import { SetMetadata } from '@nestjs/common';
import type { OrgRole } from '@krakenkey/shared';

export const ROLES_KEY = 'roles';

/**
 * Restricts an endpoint to users with one of the specified org roles.
 * Solo users (role = null) always pass through regardless of this decorator.
 * Only enforced when the controller applies RoleGuard after the auth guard:
 * @UseGuards(JwtOrApiKeyGuard, RoleGuard).
 *
 * @example
 * @Roles('owner', 'admin', 'member')  // viewers and unauthenticated org users are blocked
 */
export const Roles = (...roles: OrgRole[]) => SetMetadata(ROLES_KEY, roles);
