import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { AiAgentMode } from '@prisma/client';
import { RedisService } from '../../../redis/redis.service';
import { MetricsService } from '../../../metrics/metrics.service';
import {
  computeSemanticEmbedding,
  cosineSimilarity,
  normalizeVietnameseText,
  type RagRetrievedCitation,
} from '../rag/ai-rag.service';

export interface CacheKeyContext {
  question: string;
  mode: AiAgentMode;
  promptVersion: string;
  routeVersion: string;
  modelId: string;
  language: string;
  knowledgeVersion: string;
  authPartition: string;
  contextScope: string;
}

export interface CachedAnswerEntry {
  answer: string;
  citations: RagRetrievedCitation[];
  lane: string;
  model: string;
  provider: string;
  promptVersion: string;
  knowledgeVersion: string;
  authPartition: string;
  contextScope: string;
  intent: string;
  embedding: number[];
  cachedAt: string;
}

export interface CacheLookupResult {
  hit: boolean;
  level?: 'L1_EXACT' | 'L2_SEMANTIC';
  similarity?: number;
  entry?: CachedAnswerEntry;
  bypassedReason?: string;
}

const BYPASS_LIVE_OR_MUTATION_PATTERNS =
  /(?:bao\s+nhiêu|how\s+many|hiện\s+tại|current\s+count|live|thời\s+gian\s+thực|real-?time|tạo\s+bản\s+nháp|create\s+draft|xuất\s+bản|publish|cập\s+nhật|update\s+course|xóa|delete|gán\s+vai\s+trò|assign\s+role|bổ\s+nhiệm|appoint|phê\s+duyệt\s+ngay|approve\s+now|tình\s+trạng\s+tài\s+khoản|account\s+status|sức\s+khỏe\s+hệ\s+thống\s+hiện|system\s+health\s+now|chi\s+phí\s+hôm\s+nay|cost\s+today|usage\s+today|đang\s+chờ\s+duyệt|waiting\s+requests|pending\s+count)/i;

@Injectable()
export class AiCacheService {
  private readonly exactMemory = new Map<string, { entry: CachedAnswerEntry; expiresAt: number }>();
  private readonly semanticMemory = new Map<
    string,
    Array<{ key: string; entry: CachedAnswerEntry; expiresAt: number }>
  >();

  private stats = {
    l1Hits: 0,
    l1Misses: 0,
    l2Hits: 0,
    l2Rejected: 0,
    bypasses: 0,
    invalidations: 0,
  };

  private epoch = 1;

  constructor(
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  private isEnabled(): boolean {
    return this.config?.get<boolean>('AI_CACHE_ENABLED', true) ?? true;
  }

  private isSemanticEnabled(): boolean {
    return this.config?.get<boolean>('AI_SEMANTIC_CACHE_ENABLED', true) ?? true;
  }

  private similarityThreshold(): number {
    return Number(this.config?.get('AI_SEMANTIC_SIMILARITY_THRESHOLD', 0.88) ?? 0.88);
  }

  private ttlSeconds(): number {
    return Number(this.config?.get('AI_CACHE_TTL_SECONDS', 900) ?? 900);
  }

  private maxEntries(): number {
    return Number(this.config?.get('AI_CACHE_MAX_ENTRIES', 500) ?? 500);
  }

  detectLanguage(text: string): 'vi' | 'en' {
    if (
      /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(
        text,
      ) ||
      /\b(?:là\s+gì|như\s+thế\s+nào|quy\s+trình|hướng\s+dẫn|chính\s+sách|khóa\s+học|giảng\s+viên|quản\s+trị)\b/i.test(
        text,
      )
    ) {
      return 'vi';
    }
    return 'en';
  }

  classifyIntent(question: string): string {
    const q = normalizeVietnameseText(question);
    if (/\b(?:phe\s+duyet|approval|teacher|giang\s+vien|bo\s+nhiem)\b/.test(q))
      return 'policy_approval';
    if (/\b(?:khoa\s+hoc|course|xuat\s+ban|publish|bai\s+hoc|lesson)\b/.test(q))
      return 'policy_course';
    if (/\b(?:provider|openrouter|cloudflare|workers|retry|503|failover|circuit)\b/.test(q))
      return 'policy_ai_infra';
    if (/\b(?:rbac|quyen|security|bao\s+mat|kill\s+switch|model\s+b)\b/.test(q))
      return 'policy_security';
    if (/\b(?:backup|sao\s+luu|van\s+hanh|alert|runbook)\b/.test(q)) return 'policy_operations';
    return 'general_informational';
  }

  isCacheEligible(question: string, hasToolsExecuted = false, isMutation = false): { eligible: boolean; reason?: string } {
    if (!this.isEnabled()) return { eligible: false, reason: 'cache_disabled' };
    if (isMutation) return { eligible: false, reason: 'mutation_request' };
    if (hasToolsExecuted) return { eligible: false, reason: 'live_tool_execution' };
    if (BYPASS_LIVE_OR_MUTATION_PATTERNS.test(question)) {
      return { eligible: false, reason: 'live_or_sensitive_query' };
    }
    return { eligible: true };
  }

  buildAuthPartition(
    mode: AiAgentMode,
    permissions: readonly string[],
    scope = 'global',
    authVersion = 0,
  ): string {
    const sortedPerms = [...permissions].sort().join(',');
    const hash = createHash('sha256')
      .update(`${mode}|${scope}|v${authVersion}|${sortedPerms}`)
      .digest('hex')
      .slice(0, 24);
    return `${mode}:${scope}:${hash}`;
  }

  buildExactKey(ctx: CacheKeyContext): string {
    const canonicalQuestion = normalizeVietnameseText(ctx.question);
    const raw = JSON.stringify({
      epoch: this.epoch,
      q: canonicalQuestion,
      mode: ctx.mode,
      pv: ctx.promptVersion,
      rv: ctx.routeVersion,
      m: ctx.modelId,
      lang: ctx.language,
      kb: ctx.knowledgeVersion,
      ap: ctx.authPartition,
      cs: ctx.contextScope,
    });
    const digest = createHash('sha256').update(raw).digest('hex');
    return `ai-cache:v1:exact:${digest}`;
  }

  private buildSemanticPartitionKey(ctx: CacheKeyContext): string {
    const raw = JSON.stringify({
      epoch: this.epoch,
      mode: ctx.mode,
      modelId: ctx.modelId,
      pv: ctx.promptVersion,
      rv: ctx.routeVersion,
      lang: ctx.language,
      kb: ctx.knowledgeVersion,
      ap: ctx.authPartition,
      cs: ctx.contextScope,
    });
    return createHash('sha256').update(raw).digest('hex').slice(0, 32);
  }

  async lookup(ctx: CacheKeyContext): Promise<CacheLookupResult> {
    const eligibility = this.isCacheEligible(ctx.question);
    if (!eligibility.eligible) {
      this.stats.bypasses += 1;
      this.metrics?.aiCacheHits.inc({ level: 'L1', outcome: 'bypass' });
      return { hit: false, bypassedReason: eligibility.reason };
    }

    const now = Date.now();
    const exactKey = this.buildExactKey(ctx);

    // 1. L1 Exact Match Lookup
    try {
      const redisClient = this.redis?.getClient();
      if (redisClient) {
        const cachedRaw = await redisClient.get(exactKey);
        if (cachedRaw) {
          const parsed = JSON.parse(cachedRaw) as CachedAnswerEntry;
          if (
            parsed.authPartition === ctx.authPartition &&
            parsed.knowledgeVersion === ctx.knowledgeVersion &&
            parsed.promptVersion === ctx.promptVersion
          ) {
            this.stats.l1Hits += 1;
            this.metrics?.aiCacheHits.inc({ level: 'L1', outcome: 'hit' });
            return { hit: true, level: 'L1_EXACT', similarity: 1, entry: parsed };
          }
        }
      }
    } catch {
      // Safe degradation on Redis error
    }

    const memExact = this.exactMemory.get(exactKey);
    if (memExact && memExact.expiresAt > now) {
      const e = memExact.entry;
      if (
        e.authPartition === ctx.authPartition &&
        e.knowledgeVersion === ctx.knowledgeVersion &&
        e.promptVersion === ctx.promptVersion
      ) {
        this.stats.l1Hits += 1;
        this.metrics?.aiCacheHits.inc({ level: 'L1', outcome: 'hit' });
        return { hit: true, level: 'L1_EXACT', similarity: 1, entry: e };
      }
    }
    this.stats.l1Misses += 1;
    this.metrics?.aiCacheHits.inc({ level: 'L1', outcome: 'miss' });

    // 2. L2 Semantic Match Lookup (Restricted to informational queries within identical security/KB/prompt partition)
    if (!this.isSemanticEnabled()) {
      return { hit: false };
    }

    const partitionKey = this.buildSemanticPartitionKey(ctx);
    const candidates = (this.semanticMemory.get(partitionKey) ?? []).filter(
      (item) => item.expiresAt > now,
    );
    if (!candidates.length) {
      return { hit: false };
    }

    const queryEmbedding = computeSemanticEmbedding(ctx.question);
    const queryIntent = this.classifyIntent(ctx.question);
    const threshold = this.similarityThreshold();

    let bestCandidate: { entry: CachedAnswerEntry; similarity: number } | null = null;
    for (const candidate of candidates) {
      if (
        candidate.entry.authPartition !== ctx.authPartition ||
        candidate.entry.contextScope !== ctx.contextScope ||
        candidate.entry.knowledgeVersion !== ctx.knowledgeVersion ||
        candidate.entry.promptVersion !== ctx.promptVersion ||
        candidate.entry.intent !== queryIntent
      ) {
        continue;
      }
      const sim = cosineSimilarity(queryEmbedding, candidate.entry.embedding);
      if (sim >= threshold && (!bestCandidate || sim > bestCandidate.similarity)) {
        bestCandidate = { entry: candidate.entry, similarity: Number(sim.toFixed(4)) };
      }
    }

    if (bestCandidate) {
      this.stats.l2Hits += 1;
      this.metrics?.aiCacheHits.inc({ level: 'L2', outcome: 'hit' });
      return {
        hit: true,
        level: 'L2_SEMANTIC',
        similarity: bestCandidate.similarity,
        entry: bestCandidate.entry,
      };
    }

    this.stats.l2Rejected += 1;
    this.metrics?.aiCacheHits.inc({ level: 'L2', outcome: 'rejected' });
    return { hit: false };
  }

  async store(
    ctx: CacheKeyContext,
    payload: {
      answer: string;
      citations?: RagRetrievedCitation[];
      lane: string;
      model: string;
      provider: string;
      hasToolsExecuted?: boolean;
      isMutation?: boolean;
      isError?: boolean;
    },
  ): Promise<boolean> {
    if (payload.isError || !payload.answer.trim()) return false;
    const eligibility = this.isCacheEligible(
      ctx.question,
      payload.hasToolsExecuted ?? false,
      payload.isMutation ?? false,
    );
    if (!eligibility.eligible) return false;

    const ttlSec = this.ttlSeconds();
    const expiresAt = Date.now() + ttlSec * 1000;
    const exactKey = this.buildExactKey(ctx);
    const entry: CachedAnswerEntry = {
      answer: payload.answer,
      citations: payload.citations ?? [],
      lane: payload.lane,
      model: payload.model,
      provider: payload.provider,
      promptVersion: ctx.promptVersion,
      knowledgeVersion: ctx.knowledgeVersion,
      authPartition: ctx.authPartition,
      contextScope: ctx.contextScope,
      intent: this.classifyIntent(ctx.question),
      embedding: computeSemanticEmbedding(ctx.question),
      cachedAt: new Date().toISOString(),
    };

    // Enforce bounded cache size
    if (this.exactMemory.size >= this.maxEntries()) {
      const oldestKey = this.exactMemory.keys().next().value;
      if (oldestKey) this.exactMemory.delete(oldestKey);
    }
    this.exactMemory.set(exactKey, { entry, expiresAt });

    const partitionKey = this.buildSemanticPartitionKey(ctx);
    const list = (this.semanticMemory.get(partitionKey) ?? []).filter(
      (item) => item.expiresAt > Date.now() && item.key !== exactKey,
    );
    if (list.length >= 50) list.shift();
    list.push({ key: exactKey, entry, expiresAt });
    this.semanticMemory.set(partitionKey, list);

    try {
      const redisClient = this.redis?.getClient();
      if (redisClient) {
        await redisClient.set(exactKey, JSON.stringify(entry), 'EX', ttlSec);
      }
    } catch {
      // Degrade safely if Redis write fails
    }

    return true;
  }

  async invalidateAll(reason = 'policy_or_knowledge_change'): Promise<{ invalidatedEpoch: number; reason: string }> {
    this.epoch += 1;
    this.exactMemory.clear();
    this.semanticMemory.clear();
    this.stats.invalidations += 1;
    try {
      const redisClient = this.redis?.getClient();
      if (redisClient) {
        const keys = await redisClient.keys('ai-cache:v1:exact:*');
        if (keys.length) await redisClient.del(...keys);
      }
    } catch {
      // Safe degradation
    }
    return { invalidatedEpoch: this.epoch, reason };
  }

  getMetrics() {
    const totalLookups = this.stats.l1Hits + this.stats.l1Misses;
    return {
      enabled: this.isEnabled(),
      semanticEnabled: this.isSemanticEnabled(),
      similarityThreshold: this.similarityThreshold(),
      ttlSeconds: this.ttlSeconds(),
      maxEntries: this.maxEntries(),
      epoch: this.epoch,
      activeExactEntries: this.exactMemory.size,
      l1Hits: this.stats.l1Hits,
      l1Misses: this.stats.l1Misses,
      l2SemanticHits: this.stats.l2Hits,
      l2SemanticRejected: this.stats.l2Rejected,
      bypasses: this.stats.bypasses,
      invalidations: this.stats.invalidations,
      hitRatio: totalLookups > 0 ? Number(((this.stats.l1Hits + this.stats.l2Hits) / totalLookups).toFixed(4)) : 0,
    };
  }
}
