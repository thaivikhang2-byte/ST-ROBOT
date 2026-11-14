// ═══════════════════════════════════════════
// Errors SDK — Prisma Exception Filter
// Translates Prisma errors to domain errors
// ═══════════════════════════════════════════

import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorCode } from '../error-codes.enum';

/**
 * Catches Prisma client known request errors by checking the error's
 * constructor name and code property. This avoids a hard compile-time
 * dependency on a generated Prisma client.
 */
@Catch()
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    if (!this.isPrismaError(exception)) {
      throw exception;
    }

    const error = exception as { code: string; meta?: Record<string, unknown> };
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: string;
    let code: ErrorCode;

    switch (error.code) {
      case 'P2002':
        status = HttpStatus.CONFLICT;
        message = `A record with this ${this.extractField(error)} already exists`;
        code = ErrorCode.CONFLICT;
        break;

      case 'P2025':
        status = HttpStatus.NOT_FOUND;
        message = 'The requested record was not found';
        code = ErrorCode.NOT_FOUND;
        break;

      case 'P2003':
        status = HttpStatus.BAD_REQUEST;
        message = 'Related record not found';
        code = ErrorCode.NOT_FOUND;
        break;

      case 'P2014':
        status = HttpStatus.BAD_REQUEST;
        message = 'Required relation violation';
        code = ErrorCode.VALIDATION_ERROR;
        break;

      default:
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        message = 'A database error occurred';
        code = ErrorCode.DATABASE_ERROR;
        break;
    }

    response.status(status).json({
      success: false,
      message,
      error: {
        code,
        type: 'PrismaException',
        details:
          process.env.NODE_ENV === 'production'
            ? null
            : { prismaCode: error.code, meta: error.meta },
      },
      meta: {
        timestamp: new Date().toISOString(),
        path: request.url,
        method: request.method,
      },
    });
  }

  private isPrismaError(exception: unknown): boolean {
    if (!exception || typeof exception !== 'object') return false;
    const name = (exception as Record<string, unknown>).constructor?.name || '';
    return (
      name === 'PrismaClientKnownRequestError' ||
      name === 'PrismaClientValidationError'
    );
  }

  private extractField(error: { meta?: Record<string, unknown> }): string {
    const target = error.meta?.target;
    if (Array.isArray(target)) {
      return target.join(', ');
    }
    return String(target || 'value');
  }
}
