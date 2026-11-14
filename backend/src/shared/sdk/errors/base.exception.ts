// ═══════════════════════════════════════════
// Errors SDK — Base Exception
// ═══════════════════════════════════════════

import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes.enum';

export class BaseException extends HttpException {
  public readonly code: ErrorCode;
  public readonly details: unknown;

  constructor(
    message: string,
    code: ErrorCode,
    status: HttpStatus,
    details?: unknown,
  ) {
    super(
      {
        success: false,
        message,
        error: {
          code,
          type: new.target.name,
          details: details || null,
        },
      },
      status,
    );
    this.code = code;
    this.details = details;
  }
}
