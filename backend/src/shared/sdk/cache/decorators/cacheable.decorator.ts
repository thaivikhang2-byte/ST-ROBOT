// ═══════════════════════════════════════════
// Cache SDK — Cacheable Decorator
// Mark methods for automatic caching
// ═══════════════════════════════════════════

import { SetMetadata } from '@nestjs/common';

export const CACHEABLE_KEY = 'cacheable';

export interface CacheableOptions {
  key: string;
  ttl?: number; // seconds
}

/**
 * Decorator to mark a method result as cacheable.
 * Used with CacheInterceptor.
 *
 * @example
 * @Cacheable({ key: 'courses:list', ttl: 60 })
 * async findAll() { ... }
 */
export const Cacheable = (options: CacheableOptions) =>
  SetMetadata(CACHEABLE_KEY, options);
