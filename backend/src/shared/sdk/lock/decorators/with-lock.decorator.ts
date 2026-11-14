// ═══════════════════════════════════════════
// Lock SDK — @WithLock() Decorator
// ═══════════════════════════════════════════

import { SetMetadata } from '@nestjs/common';

export const WITH_LOCK_KEY = 'withLock';

export interface WithLockOptions {
  key: string;
  ttlMs?: number;
}

/**
 * Decorator to enforce distributed lock on a method.
 *
 * @example
 * @WithLock({ key: 'backup:daily', ttlMs: 300000 })
 * async runDailyBackup() { ... }
 */
export const WithLock = (options: WithLockOptions) =>
  SetMetadata(WITH_LOCK_KEY, options);
