import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import { MetricsService } from '../../metrics/metrics.service';
import { AiError } from './ai.error';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitSnapshot {
  providerId: string;
  state: CircuitState;
  consecutiveFailures: number;
  openedAt?: string | null;
  lastErrorStatus?: number | null;
}

@Injectable()
export class AiCircuitBreakerService {
  private readonly memoryFallback = new Map<
    string,
    { state: CircuitState; failures: number; openUntil: number; lastStatus?: number }
  >();

  constructor(
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  private threshold(): number {
    return Number(this.config?.get('AI_CIRCUIT_FAILURE_THRESHOLD', 3) ?? 3);
  }

  private openTtlMs(): number {
    return Number(this.config?.get('AI_CIRCUIT_OPEN_TTL_MS', 30000) ?? 30000);
  }

  private updateMetric(providerId: string, state: CircuitState) {
    const val = state === 'OPEN' ? 2 : state === 'HALF_OPEN' ? 1 : 0;
    this.metrics?.aiCircuitState.set({ provider: providerId.slice(0, 32) }, val);
  }

  async checkAdmission(providerId: string): Promise<{ allowed: boolean; state: CircuitState }> {
    const now = Date.now();
    try {
      const client = this.redis?.getClient();
      if (client) {
        const stateKey = `ai-cb:${providerId}:state`;
        const probeKey = `ai-cb:${providerId}:probe`;
        const current = await client.get(stateKey);
        if (current === 'OPEN') {
          const ttl = await client.pttl(stateKey);
          if (ttl > 0) {
            this.updateMetric(providerId, 'OPEN');
            return { allowed: false, state: 'OPEN' };
          }
        }
        const wasOpen = await client.get(`ai-cb:${providerId}:was_open`);
        if (wasOpen === '1') {
          const acquired = await client.set(probeKey, '1', 'PX', 15000, 'NX');
          if (!acquired) {
            this.updateMetric(providerId, 'HALF_OPEN');
            return { allowed: false, state: 'HALF_OPEN' };
          }
          this.updateMetric(providerId, 'HALF_OPEN');
          return { allowed: true, state: 'HALF_OPEN' };
        }
        this.updateMetric(providerId, 'CLOSED');
        return { allowed: true, state: 'CLOSED' };
      }
    } catch {
      // Fall back to process-local circuit state if Redis is unavailable
    }

    const mem = this.memoryFallback.get(providerId);
    if (!mem) {
      this.updateMetric(providerId, 'CLOSED');
      return { allowed: true, state: 'CLOSED' };
    }
    if (mem.state === 'OPEN') {
      if (now < mem.openUntil) {
        this.updateMetric(providerId, 'OPEN');
        return { allowed: false, state: 'OPEN' };
      }
      mem.state = 'HALF_OPEN';
      this.updateMetric(providerId, 'HALF_OPEN');
      return { allowed: true, state: 'HALF_OPEN' };
    }
    if (mem.state === 'HALF_OPEN') {
      return { allowed: true, state: 'HALF_OPEN' };
    }
    this.updateMetric(providerId, 'CLOSED');
    return { allowed: true, state: 'CLOSED' };
  }

  async recordSuccess(providerId: string): Promise<void> {
    this.memoryFallback.delete(providerId);
    this.updateMetric(providerId, 'CLOSED');
    try {
      const client = this.redis?.getClient();
      if (client) {
        await client.del(
          `ai-cb:${providerId}:state`,
          `ai-cb:${providerId}:failures`,
          `ai-cb:${providerId}:was_open`,
          `ai-cb:${providerId}:probe`,
        );
      }
    } catch {
      // Ignore Redis transient error on circuit reset
    }
  }

  async recordFailure(providerId: string, error: unknown): Promise<CircuitState> {
    const isTransient =
      error instanceof AiError
        ? error.retryable && [502, 503, 504].includes(error.upstreamStatus ?? -1)
        : false;
    if (!isTransient) {
      const snap = await this.snapshot(providerId);
      return snap.state;
    }

    const threshold = this.threshold();
    const openTtlMs = this.openTtlMs();
    const status =
      error instanceof AiError ? (error.upstreamStatus ?? error.getStatus()) : 503;

    const now = Date.now();
    const mem = this.memoryFallback.get(providerId) ?? {
      state: 'CLOSED' as CircuitState,
      failures: 0,
      openUntil: 0,
    };
    mem.failures += 1;
    mem.lastStatus = status;
    if (mem.state === 'HALF_OPEN' || mem.failures >= threshold) {
      mem.state = 'OPEN';
      mem.openUntil = now + openTtlMs;
    }
    this.memoryFallback.set(providerId, mem);

    try {
      const client = this.redis?.getClient();
      if (client) {
        const wasOpen = await client.get(`ai-cb:${providerId}:was_open`);
        const count = await client.incr(`ai-cb:${providerId}:failures`);
        await client.expire(`ai-cb:${providerId}:failures`, 120);
        await client.set(`ai-cb:${providerId}:last_status`, String(status), 'EX', 300);
        if (wasOpen === '1' || count >= threshold) {
          await client.set(`ai-cb:${providerId}:state`, 'OPEN', 'PX', openTtlMs);
          await client.set(`ai-cb:${providerId}:was_open`, '1', 'EX', 300);
          await client.set(
            `ai-cb:${providerId}:opened_at`,
            new Date(now).toISOString(),
            'EX',
            300,
          );
          await client.del(`ai-cb:${providerId}:probe`);
          this.updateMetric(providerId, 'OPEN');
          return 'OPEN';
        }
      }
    } catch {
      // Fallback to in-memory state
    }

    this.updateMetric(providerId, mem.state);
    return mem.state;
  }

  async snapshot(providerId: string): Promise<CircuitSnapshot> {
    try {
      const client = this.redis?.getClient();
      if (client) {
        const [stateRaw, failuresRaw, wasOpen, openedAt, lastStatus] = await Promise.all([
          client.get(`ai-cb:${providerId}:state`),
          client.get(`ai-cb:${providerId}:failures`),
          client.get(`ai-cb:${providerId}:was_open`),
          client.get(`ai-cb:${providerId}:opened_at`),
          client.get(`ai-cb:${providerId}:last_status`),
        ]);
        const state: CircuitState =
          stateRaw === 'OPEN' ? 'OPEN' : wasOpen === '1' ? 'HALF_OPEN' : 'CLOSED';
        return {
          providerId,
          state,
          consecutiveFailures: Number(failuresRaw ?? 0),
          openedAt: openedAt ?? null,
          lastErrorStatus: lastStatus ? Number(lastStatus) : null,
        };
      }
    } catch {
      // Fallback to memory
    }
    const mem = this.memoryFallback.get(providerId);
    const now = Date.now();
    const state: CircuitState = !mem
      ? 'CLOSED'
      : mem.state === 'OPEN' && now >= mem.openUntil
        ? 'HALF_OPEN'
        : mem.state;
    return {
      providerId,
      state,
      consecutiveFailures: mem?.failures ?? 0,
      openedAt: mem?.openUntil ? new Date(mem.openUntil - this.openTtlMs()).toISOString() : null,
      lastErrorStatus: mem?.lastStatus ?? null,
    };
  }

  computeBackoffMs(
    attemptIndex: number,
    retryAfterMs: number | undefined,
    remainingDeadlineMs: number,
  ): number | null {
    const baseDelay = Number(this.config?.get('AI_RETRY_BASE_DELAY_MS', 500) ?? 500);
    const maxDelay = Number(this.config?.get('AI_RETRY_MAX_DELAY_MS', 5000) ?? 5000);
    let delayMs: number;
    if (retryAfterMs !== undefined && retryAfterMs >= 0) {
      if (retryAfterMs + 150 > remainingDeadlineMs) {
        return null;
      }
      delayMs = retryAfterMs;
    } else {
      const exp = Math.min(maxDelay, baseDelay * Math.pow(2, Math.max(0, attemptIndex)));
      const jitter = Math.floor(exp * (0.75 + Math.random() * 0.25));
      delayMs = Math.min(maxDelay, jitter);
    }
    if (delayMs + 150 > remainingDeadlineMs) {
      return null;
    }
    return delayMs;
  }

  async waitWithSignal(delayMs: number, signal: AbortSignal): Promise<void> {
    if (delayMs <= 0) return;
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('Aborted during retry backoff'));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, delayMs);
      timer.unref?.();
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
