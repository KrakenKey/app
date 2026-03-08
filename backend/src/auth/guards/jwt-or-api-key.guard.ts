import { Injectable, ExecutionContext, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Logger } from '@nestjs/common';
import { MetricsService } from '../../metrics/metrics.service';

@Injectable()
export class JwtOrApiKeyGuard extends AuthGuard(['jwt', 'api-key']) {
  constructor(
    @Inject(MetricsService) private readonly metricsService: MetricsService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const result = (await super.canActivate(context)) as boolean;
      const req = context.switchToHttp().getRequest();
      const method = req.headers?.['x-api-key'] ? 'api-key' : 'jwt';
      this.metricsService.authTotal.inc({ method, status: 'success' });
      return result;
    } catch (e) {
      Logger.error('Authentication guard failed', e);
      const req = context.switchToHttp().getRequest();
      const method = req.headers?.['x-api-key'] ? 'api-key' : 'jwt';
      this.metricsService.authTotal.inc({ method, status: 'failed' });
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
