// ═══════════════════════════════════════════
// Errors SDK — Infrastructure Exception
// HTTP 503 — DB, Redis, external service errors
// ═══════════════════════════════════════════

import { HttpStatus } from '@nestjs/common';
import { BaseException } from './base.exception';
import { ErrorCode } from './error-codes.enum';

export class InfrastructureException extends BaseException {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.SERVICE_UNAVAILABLE,
    details?: unknown,
  ) {
    super(message, code, HttpStatus.SERVICE_UNAVAILABLE, details);
  }
}

// ── Convenience subclasses ────────────────

export class DatabaseException extends InfrastructureException {
  constructor(message = 'Database error occurred', details?: unknown) {
    super(message, ErrorCode.DATABASE_ERROR, details);
  }
}

export class RedisException extends InfrastructureException {
  constructor(message = 'Redis error occurred', details?: unknown) {
    super(message, ErrorCode.REDIS_ERROR, details);
  }
}

export class CdnException extends InfrastructureException {
  constructor(message = 'CDN error occurred', details?: unknown) {
    super(message, ErrorCode.CDN_ERROR, details);
  }
}
