// ═══════════════════════════════════════════
// Idempotency SDK — Service
// Redis-backed idempotency key store
// ═══════════════════════════════════════════

import { Injectable, Optional, Inject } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';

export interface IdempotencyRecord {
  statusCode: number;
  response: unknown;
  createdAt: string;
}

@Injectable()
export class IdempotencyService {
  private readonly PREFIX = 'idempotency:';

  constructor(@Optional() private readonly cache?: CacheService) {}

  async get(key: string): Promise<IdempotencyRecord | null> {
    if (!this.cache) return null;
    return this.cache.get<IdempotencyRecord>(`${this.PREFIX}${key}`);
  }

  async set(key: string, record: IdempotencyRecord, ttlSeconds: number): Promise<void> {
    if (!this.cache) return;
    await this.cache.set(`${this.PREFIX}${key}`, record, ttlSeconds);
  }

  async exists(key: string): Promise<boolean> {
    if (!this.cache) return false;
    return this.cache.exists(`${this.PREFIX}${key}`);
  }
}
