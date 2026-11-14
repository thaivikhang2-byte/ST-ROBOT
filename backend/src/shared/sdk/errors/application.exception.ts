// ═══════════════════════════════════════════
// Errors SDK — Application Exception
// HTTP 500 — Unexpected / internal errors
// ═══════════════════════════════════════════

import { HttpStatus } from '@nestjs/common';
import { BaseException } from './base.exception';
import { ErrorCode } from './error-codes.enum';

export class ApplicationException extends BaseException {
  constructor(
    message = 'An unexpected error occurred',
    code: ErrorCode = ErrorCode.INTERNAL_ERROR,
    details?: unknown,
  ) {
    super(message, code, HttpStatus.INTERNAL_SERVER_ERROR, details);
  }
}
