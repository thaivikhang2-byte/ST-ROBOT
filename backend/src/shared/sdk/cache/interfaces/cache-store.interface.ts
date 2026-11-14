// ═══════════════════════════════════════════
// Cache SDK — Cache Store Interface
// ═══════════════════════════════════════════

export interface ICacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  delByPattern(pattern: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  ttl(key: string): Promise<number>;
  reset(): Promise<void>;
}
