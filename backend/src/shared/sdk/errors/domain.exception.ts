// ═══════════════════════════════════════════
// Errors SDK — Domain Exception
// HTTP 400/404/409 — Business rule violations
// ═══════════════════════════════════════════

import { HttpStatus } from '@nestjs/common';
import { BaseException } from './base.exception';
import { ErrorCode } from './error-codes.enum';

export class DomainException extends BaseException {
  constructor(
    message: string,
    code: ErrorCode,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    details?: unknown,
  ) {
    super(message, code, status, details);
  }
}

// ── Convenience subclasses ────────────────

export class NotFoundException extends DomainException {
  constructor(resource: string, id?: string) {
    const msg = id ? `${resource} with id '${id}' not found` : `${resource} not found`;
    super(msg, ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
  }
}

export class ConflictException extends DomainException {
  constructor(message: string, code: ErrorCode = ErrorCode.CONFLICT) {
    super(message, code, HttpStatus.CONFLICT);
  }
}

export class ForbiddenException extends DomainException {
  constructor(message = 'You do not have permission to perform this action') {
    super(message, ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN);
  }
}

export class UnauthorizedException extends DomainException {
  constructor(message = 'Authentication required') {
    super(message, ErrorCode.UNAUTHORIZED, HttpStatus.UNAUTHORIZED);
  }
}
