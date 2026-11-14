// ═══════════════════════════════════════════
// Idempotency SDK — @Idempotent() Decorator
// ═══════════════════════════════════════════

import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'idempotent';

export interface IdempotentOptions {
  ttlSeconds?: number; // How long to cache the response (default: 86400 = 24h)
}

/**
 * Mark an endpoint as idempotent.
 * Requires Idempotency-Key header from client.
 *
 * @example
 * @Idempotent({ ttlSeconds: 3600 })
 * @Post('enrollments')
 * enroll() { ... }
 */
export const Idempotent = (options?: IdempotentOptions) =>
  SetMetadata(IDEMPOTENT_KEY, { ttlSeconds: 86400, ...options });
