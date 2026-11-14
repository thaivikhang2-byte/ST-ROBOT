// ═══════════════════════════════════════════
// Errors SDK — Validation Exception
// HTTP 422 — Input validation errors
// ═══════════════════════════════════════════

import { HttpStatus } from '@nestjs/common';
import { BaseException } from './base.exception';
import { ErrorCode } from './error-codes.enum';

export interface ValidationDetail {
  field: string;
  message: string;
  value?: unknown;
}

export class ValidationException extends BaseException {
  constructor(
    details: ValidationDetail[],
    message = 'Validation failed',
  ) {
    super(message, ErrorCode.VALIDATION_ERROR, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
}
