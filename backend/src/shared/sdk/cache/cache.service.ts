// ═══════════════════════════════════════════
// Cache SDK — Cache Service
// Abstraction layer over Redis
// ═══════════════════════════════════════════

import { Injectable, Inject, Optional } from '@nestjs/common';
import { ICacheStore } from './interfaces/cache-store.interface';

export const CACHE_STORE = 'CACHE_STORE';

@Injectable()
export class CacheService implements ICacheStore {
  constructor(
    @Optional() @Inject(CACHE_STORE) private readonly store?: ICacheStore,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    if (!this.store) return null;
    return this.store.get<T>(key);
  }

  async set<T>(key: string, value: T, ttlSeconds = 300): Promise<void> {
    if (!this.store) return;
    return this.store.set(key, value, ttlSeconds);
  }

  async del(key: string): Promise<void> {
    if (!this.store) return;
    return this.store.del(key);
  }

  async delByPattern(pattern: string): Promise<void> {
    if (!this.store) return;
    return this.store.delByPattern(pattern);
  }

  async exists(key: string): Promise<boolean> {
    if (!this.store) return false;
    return this.store.exists(key);
  }

  async ttl(key: string): Promise<number> {
    if (!this.store) return -1;
    return this.store.ttl(key);
  }

  async reset(): Promise<void> {
    if (!this.store) return;
    return this.store.reset();
  }

  /**
   * Get or set pattern: returns cached value if exists,
   * otherwise calls factory, caches and returns result.
   */
  async getOrSet<T>(key: string, factory: () => Promise<T>, ttlSeconds = 300): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const result = await factory();
    await this.set(key, result, ttlSeconds);
    return result;
  }
}
