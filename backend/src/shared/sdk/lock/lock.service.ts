// ═══════════════════════════════════════════
// Lock SDK — Distributed Lock Service
// Redis-based distributed locking
// ═══════════════════════════════════════════

import { Injectable, Optional, Inject } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';

export interface LockOptions {
  ttl: number; // Lock TTL in milliseconds
  retries?: number; // Number of acquire retries
  retryDelay?: number; // Delay between retries in ms
}

@Injectable()
export class LockService {
  private readonly PREFIX = 'lock:';

  constructor(@Optional() private readonly cache?: CacheService) {}

  /**
   * Try to acquire a distributed lock.
   * Returns true if acquired, false if already held.
   */
  async acquire(key: string, ttlMs: number): Promise<boolean> {
    if (!this.cache) return true; // No cache = single instance, always succeed

    const lockKey = `${this.PREFIX}${key}`;
    const exists = await this.cache.exists(lockKey);
    if (exists) return false;

    await this.cache.set(lockKey, { lockedAt: Date.now() }, Math.ceil(ttlMs / 1000));
    return true;
  }

  /**
   * Release a distributed lock.
   */
  async release(key: string): Promise<void> {
    if (!this.cache) return;
    await this.cache.del(`${this.PREFIX}${key}`);
  }

  /**
   * Execute a callback with a distributed lock.
   * Throws if lock cannot be acquired.
   */
  async withLock<T>(
    key: string,
    callback: () => Promise<T>,
    options: LockOptions = { ttl: 60000 },
  ): Promise<T> {
    const acquired = await this.acquire(key, options.ttl);

    if (!acquired) {
      throw new Error(`Failed to acquire lock: ${key}`);
    }

    try {
      return await callback();
    } finally {
      await this.release(key);
    }
  }
}
