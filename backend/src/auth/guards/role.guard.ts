import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { User } from '../../users/entities/user.entity';
import type { OrgRole } from '@krakenkey/shared';

/**
 * Role guard — checks @Roles() decorator against the user's org role stored in DB.
 *
 * Behaviour:
 * - No @Roles() on handler/class → always passes (open to any authenticated user)
 * - @Roles() present but no req.user → 403 (fail closed)
 * - User has role = null (solo user, no org) → always passes (no org restrictions apply)
 * - User has role in the required list → passes
 * - User has role NOT in the required list → 403 Forbidden
 *
 * Must run after authentication, so apply it per controller after the auth
 * guard: @UseGuards(JwtOrApiKeyGuard, RoleGuard). Do not register it as an
 * APP_GUARD; global guards run before controller guards, so req.user would
 * not be populated yet.
 */
@Injectable()
export class RoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<OrgRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @Roles() decorator — allow all authenticated users
    if (!requiredRoles?.length) return true;

    const req = context.switchToHttp().getRequest();
    const userId: string | undefined = req.user?.userId;
    if (!userId) {
      throw new ForbiddenException('Authentication required');
    }

    const user = await this.dataSource
      .getRepository(User)
      .findOne({ where: { id: userId }, select: { id: true, role: true } });

    // Solo user (not in any org) — no role restrictions apply
    if (!user?.role) return true;

    if (!requiredRoles.includes(user.role as OrgRole)) {
      throw new ForbiddenException(
        `Role '${user.role}' is not allowed for this action. Required: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
