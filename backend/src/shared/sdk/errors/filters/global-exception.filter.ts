// ═══════════════════════════════════════════
// Errors SDK — Global Exception Filter
// Catches all exceptions and formats response
// ═══════════════════════════════════════════

import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { BaseException } from '../base.exception';
import { ErrorCode } from '../error-codes.enum';
import { currentContext } from '../../logger/request-context';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const safePath = request.path;

    let status: number;
    let body: Record<string, unknown>;

    if (exception instanceof BaseException) {
      // Our custom exceptions — already formatted correctly
      status = exception.getStatus();
      body = {
        ...(exception.getResponse() as object),
        meta: {
          timestamp: new Date().toISOString(),
          path: safePath,
          method: request.method,
        },
      };
    } else if (exception instanceof HttpException) {
      // NestJS built-in exceptions
      status = exception.getStatus();
      const exResponse = exception.getResponse();
      const message =
        typeof exResponse === 'string'
          ? exResponse
          : (exResponse as Record<string, unknown>).message || 'An error occurred';

      body = {
        success: false,
        message: Array.isArray(message) ? message.join(', ') : message,
        error: {
          code:
            (
              {
                400: ErrorCode.VALIDATION_ERROR,
                401: ErrorCode.UNAUTHORIZED,
                403: ErrorCode.FORBIDDEN,
                404: ErrorCode.NOT_FOUND,
                409: ErrorCode.CONFLICT,
                429: ErrorCode.TOO_MANY_REQUESTS,
                503: ErrorCode.SERVICE_UNAVAILABLE,
              } as Record<number, ErrorCode>
            )[status] ?? ErrorCode.INTERNAL_ERROR,
          type: exception.constructor.name,
          details: Array.isArray(message) ? message : null,
        },
        meta: {
          timestamp: new Date().toISOString(),
          path: safePath,
          method: request.method,
        },
      };
    } else if (
      exception instanceof Error &&
      'status' in exception &&
      typeof exception.status === 'number' &&
      [400, 413, 415].includes(exception.status) &&
      (('type' in exception &&
        typeof exception.type === 'string' &&
        /^(entity|encoding|charset|request|stream)\./.test(exception.type)) ||
        ('code' in exception && exception.code === 'Z_DATA_ERROR' && exception.status === 400))
    ) {
      // Express body-parser errors are not Nest HttpExceptions. Never echo the rejected body.
      status = exception.status;
      body = {
        success: false,
        message: 'Invalid request body',
        error: { code: ErrorCode.VALIDATION_ERROR, type: 'RequestBodyError', details: null },
        meta: { timestamp: new Date().toISOString(), path: safePath, method: request.method },
      };
    } else {
      // Unhandled exceptions
      status = HttpStatus.INTERNAL_SERVER_ERROR;

      body = {
        success: false,
        message: 'An unexpected error occurred',
        error: {
          code: ErrorCode.INTERNAL_ERROR,
          type: 'UnhandledException',
          details: null,
        },
        meta: {
          timestamp: new Date().toISOString(),
          path: safePath,
          method: request.method,
        },
      };

      // Log unhandled exceptions
      // Request completion middleware records a redacted, correlated error classification.
    }

    body.meta = { ...(body.meta as object), requestId: currentContext()?.requestId };
    response.status(status).json(body);
  }
}
