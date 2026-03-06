import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const method = req.method;
    const route = req.route?.path || req.url;
    const end = this.metricsService.httpRequestDuration.startTimer({
      method,
      route,
    });

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse();
          this.metricsService.httpRequestsTotal.inc({
            method,
            route,
            status_code: res.statusCode,
          });
          end();
        },
        error: (err) => {
          this.metricsService.httpRequestsTotal.inc({
            method,
            route,
            status_code: err.status || 500,
          });
          end();
        },
      }),
    );
  }
}
