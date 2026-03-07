import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

export const ADMIN_GROUP = 'authentik Admins';

export function isAdmin(user: { groups?: string[] }): boolean {
  return user?.groups?.includes(ADMIN_GROUP) ?? false;
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    return isAdmin(request.user);
  }
}
