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
 * Global role guard — checks @Roles() decorator against the user's org role stored in DB.
 *
 * Behaviour:
 * - No @Roles() on handler/class → always passes (open to any authenticated user)
 * - User has role = null (solo user, no org) → always passes (no org restrictions apply)
 * - User has role in the required list → passes
 * - User has role NOT in the required list → 403 Forbidden
 *
 * Registered as APP_GUARD in AppModule so it runs on every route after
 * JwtOrApiKeyGuard populates req.user.
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
    // No user context yet — JwtOrApiKeyGuard runs after this global guard.
    // Authentication rejection is its responsibility, not ours.
    if (!userId) return true;

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
