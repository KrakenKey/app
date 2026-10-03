import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

export const ADMIN_GROUP = 'authentik Admins';

// Admin is a dashboard-session privilege. An admin's API key acts as a
// regular user, so a leaked key can't reach other accounts.
export function isAdmin(user: {
  groups?: string[];
  apiKeyId?: string;
}): boolean {
  if (user?.apiKeyId) return false;
  return user?.groups?.includes(ADMIN_GROUP) ?? false;
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    return isAdmin(request.user);
  }
}
