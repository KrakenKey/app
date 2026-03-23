import { of, throwError } from 'rxjs';
import { MetricsInterceptor } from './metrics.interceptor';

describe('MetricsInterceptor', () => {
  let interceptor: MetricsInterceptor;
  let mockMetricsService: any;
  let endTimer: jest.Mock;

  beforeEach(() => {
    endTimer = jest.fn();
    mockMetricsService = {
      httpRequestDuration: {
        startTimer: jest.fn().mockReturnValue(endTimer),
      },
      httpRequestsTotal: {
        inc: jest.fn(),
      },
    };

    interceptor = new MetricsInterceptor(mockMetricsService);
  });

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  function createMockContext(
    method = 'GET',
    route = '/test',
    statusCode = 200,
  ) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ method, route: { path: route }, url: route }),
        getResponse: () => ({ statusCode }),
      }),
    } as any;
  }

  describe('intercept', () => {
    it('should record metrics on successful request', (done) => {
      const context = createMockContext('GET', '/api/certs', 200);
      const next = { handle: () => of('result') };

      interceptor.intercept(context, next).subscribe({
        complete: () => {
          expect(
            mockMetricsService.httpRequestDuration.startTimer,
          ).toHaveBeenCalledWith({
            method: 'GET',
            route: '/api/certs',
          });
          expect(mockMetricsService.httpRequestsTotal.inc).toHaveBeenCalledWith(
            {
              method: 'GET',
              route: '/api/certs',
              status_code: 200,
            },
          );
          expect(endTimer).toHaveBeenCalled();
          done();
        },
      });
    });

    it('should record metrics on error', (done) => {
      const context = createMockContext('POST', '/api/domains');
      const error = { status: 400, message: 'Bad Request' };
      const next = { handle: () => throwError(() => error) };

      interceptor.intercept(context, next).subscribe({
        error: () => {
          expect(mockMetricsService.httpRequestsTotal.inc).toHaveBeenCalledWith(
            {
              method: 'POST',
              route: '/api/domains',
              status_code: 400,
            },
          );
          expect(endTimer).toHaveBeenCalled();
          done();
        },
      });
    });

    it('should default to 500 when error has no status', (done) => {
      const context = createMockContext('DELETE', '/api/keys');
      const next = { handle: () => throwError(() => new Error('unexpected')) };

      interceptor.intercept(context, next).subscribe({
        error: () => {
          expect(mockMetricsService.httpRequestsTotal.inc).toHaveBeenCalledWith(
            {
              method: 'DELETE',
              route: '/api/keys',
              status_code: 500,
            },
          );
          done();
        },
      });
    });

    it('should use url when route.path is not available', (done) => {
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ method: 'GET', url: '/fallback-url' }),
          getResponse: () => ({ statusCode: 200 }),
        }),
      } as any;
      const next = { handle: () => of('ok') };

      interceptor.intercept(context, next).subscribe({
        complete: () => {
          expect(
            mockMetricsService.httpRequestDuration.startTimer,
          ).toHaveBeenCalledWith({
            method: 'GET',
            route: '/fallback-url',
          });
          done();
        },
      });
    });
  });
});
