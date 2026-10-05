import {
  Injectable,
  ExecutionContext,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Logger } from '@nestjs/common';
import { MetricsService } from '../../metrics/metrics.service';
import { SESSION_ONLY_KEY } from '../decorators/session-only.decorator';
import { assertApiKeyScope } from '../decorators/require-scope.decorator';

@Injectable()
export class JwtOrApiKeyGuard extends AuthGuard(['jwt', 'api-key']) {
  constructor(
    @Inject(MetricsService) private readonly metricsService: MetricsService,
    private readonly reflector: Reflector,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    let result: boolean;
    try {
      result = (await super.canActivate(context)) as boolean;
    } catch (e) {
      Logger.error('Authentication guard failed', e);
      this.metricsService.authTotal.inc({
        method: guessMethod(req),
        status: 'failed',
      });
      throw e;
    }

    // Only ApiKeyStrategy sets apiKeyId; a JWT can't carry one.
    const viaApiKey = Boolean(req.user?.apiKeyId);
    this.metricsService.authTotal.inc({
      method: viaApiKey ? 'api-key' : 'jwt',
      status: 'success',
    });

    const sessionOnly = this.reflector.getAllAndOverride<boolean>(
      SESSION_ONLY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (sessionOnly && viaApiKey) {
      Logger.warn(
        `API key ${req.user.apiKeyId} refused on session-only ${req.method} ${req.url}`,
      );
      throw new ForbiddenException(
        'API keys cannot be used for this action. Sign in to the dashboard instead.',
      );
    }

    assertApiKeyScope(this.reflector, context);

    return result;
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

// No user yet when authentication fails. API keys arrive as `Bearer kk_`.
function guessMethod(req: any): 'api-key' | 'jwt' {
  const auth: string | undefined = req.headers?.authorization;
  return auth?.startsWith('Bearer kk_') ? 'api-key' : 'jwt';
}
