import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { STATUS_CODES } from 'http';
import { Request, Response } from 'express';
import type { ApiErrorResponse } from '@krakenkey/shared';

/** The plan limit fields of an exception body that are safe to return. */
function pickPlanLimitFields(
  body: Record<string, unknown>,
): Partial<ApiErrorResponse> {
  const out: Partial<ApiErrorResponse> = { code: 'plan_limit_exceeded' };
  // Infinity isn't JSON; an unlimited plan never reaches its limit anyway.
  if (typeof body.limit === 'number' && Number.isFinite(body.limit)) {
    out.limit = body.limit;
  }
  if (typeof body.current === 'number') out.current = body.current;
  if (typeof body.plan === 'string') {
    out.plan = body.plan as ApiErrorResponse['plan'];
  }
  if (typeof body.upgradeTo === 'string' || body.upgradeTo === null) {
    out.upgradeTo = body.upgradeTo as ApiErrorResponse['upgradeTo'];
  }
  return out;
}

/**
 * Global exception filter that catches all HTTP exceptions
 * and formats them consistently for the frontend
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Determine status code
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // Extract error message
    let message: string | string[] = 'Internal server error';
    // Plan limit details (code, limit, current, plan, upgradeTo), so clients
    // can tell a plan limit from other errors and name the next plan.
    let planLimit: Partial<ApiErrorResponse> = {};
    // Standard reason phrase for the status, e.g. "Too Many Requests" for 429,
    // so exceptions built from a plain string still get the right label.
    let error = STATUS_CODES[status] ?? 'Internal Server Error';

    if (exception instanceof HttpException) {
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const responseObj = exceptionResponse as any;
        message = responseObj.message || message;
        error = responseObj.error || error;
        if (responseObj.code === 'plan_limit_exceeded') {
          planLimit = pickPlanLimitFields(responseObj);
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      error = exception.name;
    }

    // Log the error (useful for debugging)
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : exception,
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} - ${status} - ${message}`,
      );
    }

    // Send consistent error response
    const body: ApiErrorResponse = {
      statusCode: status,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...planLimit,
    };
    response.status(status).json(body);
  }
}
