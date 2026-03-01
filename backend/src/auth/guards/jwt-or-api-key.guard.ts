import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { Logger } from '@nestjs/common';

@Injectable()
export class JwtOrApiKeyGuard extends AuthGuard(['jwt', 'api-key']) {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return (await super.canActivate(context)) as boolean;
    } catch (e) {
      Logger.error('Authentication guard failed', e);
      throw e;
    }
  }

  handleRequest(
    err: any,
    user: any,
    info: any,
    context: ExecutionContext,
    status?: any,
  ) {
    if (err || !user) {
      const req = context.switchToHttp().getRequest();
      Logger.warn(`Authentication failed for ${req.url}`);
    }
    return super.handleRequest(err, user, info, context, status);
  }
}
