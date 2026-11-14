import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiModel, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AiError } from './ai.error';
import { ErrorCode } from '../../shared/sdk/errors/error-codes.enum';
import { assertActive, lockIdentity } from '../auth/identity.repository';
import type { RequestUser } from '../../shared/sdk';
import type { AiUsage } from './ai.types';
import type { ProviderLease } from './provider-leases';
import { grantPermissions, resolveGrants } from '../roles/authorization';

@Injectable()
export class AiQuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}
  async reserve(
    user: RequestUser,
    model: AiModel & { fallbackFrom?: string },
    endpoint: string,
    tokens: number,
    deadline: Date,
    requiresTools = false,
    lease?: ProviderLease,
    registeredAgentTools = false,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // One short DB lock protects admission across all replicas; never held during provider I/O.
      const defaults = await tx.aiQuotaPolicy.update({
        where: { id: 'default' },
        data: { lock_version: { increment: 1 } },
      });
      const identity = await lockIdentity(tx, user.id);
      assertActive(identity);
      if (!identity.is_email_verified)
        throw new AiError(ErrorCode.EMAIL_NOT_VERIFIED, 403, 'Verify your email before using AI');
      const permissions = grantPermissions(resolveGrants(identity), user.scopeCourseId, user.id);
      if (
        !permissions.includes(endpoint === 'embeddings' ? 'ai:embeddings' : 'ai:chat') ||
        (model.premium && !permissions.includes('ai:premium')) ||
        (requiresTools && !registeredAgentTools && !permissions.includes('ai:tools'))
      )
        throw new AiError(ErrorCode.FORBIDDEN, 403, 'AI permission required');
      const policy =
        (await tx.aiQuotaPolicy.findUnique({ where: { user_id: user.id } })) ?? defaults;
      const now = new Date();
      if (
        !user.sessionId ||
        !(await tx.refreshToken.findFirst({
          where: {
            user_id: user.id,
            family_id: user.sessionId,
            is_revoked: false,
            expires_at: { gt: now },
          },
          select: { id: true },
        }))
      )
        throw new AiError(ErrorCode.UNAUTHORIZED, 401, 'Current session is no longer active');
      if (deadline <= now) throw new AiError(ErrorCode.AI_TIMEOUT, 504, 'AI admission timed out');
      const currentModel = await tx.aiModel.findFirst({
        where: {
          id: model.id,
          updated_at: model.updated_at,
          provider_id: model.provider_id,
          model_id: model.model_id,
          premium: model.premium,
          capabilities: { equals: model.capabilities },
          allowed_tools: { equals: model.allowed_tools },
          max_input_tokens: model.max_input_tokens,
          max_output_tokens: model.max_output_tokens,
          context_tokens: model.context_tokens,
          enabled: true,
          provider: { enabled: true },
        },
      });
      if (!currentModel)
        throw new AiError(
          ErrorCode.AI_MODEL_UNAVAILABLE,
          503,
          'Model configuration changed; retry with current settings',
        );
      const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const bucket = await tx.aiUsageBucket.upsert({
        where: { user_id_day: { user_id: user.id, day } },
        create: { user_id: user.id, day },
        update: {},
      });
      const active = { status: 'reserved', deadline_at: { gt: now } };
      if (
        (await tx.aiUsageRecord.count({ where: { ...active, user_id: user.id } })) >=
          policy.max_concurrent ||
        (await tx.aiUsageRecord.count({ where: active })) >=
          Number(this.config.get('AI_GLOBAL_CONCURRENCY', 8))
      )
        throw new AiError(ErrorCode.AI_CONCURRENCY_EXCEEDED, 429, 'AI concurrency limit reached');
      if (
        (await tx.aiUsageRecord.count({
          where: { user_id: user.id, started_at: { gte: new Date(now.getTime() - 60000) } },
        })) >= policy.requests_per_minute
      )
        throw new AiError(ErrorCode.TOO_MANY_REQUESTS, 429, 'AI user rate limit reached');
      if (
        bucket.requests + 1 > policy.daily_requests ||
        bucket.charged_tokens + tokens > policy.daily_tokens
      )
        throw new AiError(ErrorCode.AI_QUOTA_EXCEEDED, 429, 'AI daily budget exhausted');
      if (lease) {
        // Durable admission remains authoritative when Redis restarts or evicts counters.
        const scopes: [Prisma.AiUsageRecordWhereInput, typeof lease.accountLimits][] = [
          [{ account_group: lease.provider.accountGroup }, lease.accountLimits],
          [
            { provider_id: model.provider_id, credential_id: lease.credential.id },
            lease.credential.limits,
          ],
        ];
        for (const [scope, limits] of scopes) {
          const consumed = await tx.aiUsageRecord.aggregate({
            where: { ...scope, started_at: { gte: day } },
            _sum: { charged_tokens: true },
          });
          if (
            (consumed._sum.charged_tokens ?? 0) + tokens > limits.tokensPerDay ||
            (await tx.aiUsageRecord.count({ where: { ...scope, ...active } })) >=
              limits.maxConcurrent ||
            (await tx.aiUsageRecord.count({
              where: { ...scope, started_at: { gte: new Date(now.getTime() - 60000) } },
            })) >= limits.requestsPerMinute
          )
            throw new AiError(ErrorCode.AI_QUOTA_EXCEEDED, 429, 'AI provider allocation exhausted');
        }
      }
      await tx.aiUsageBucket.update({
        where: { id: bucket.id },
        data: { requests: { increment: 1 }, charged_tokens: { increment: tokens } },
      });
      return tx.aiUsageRecord.create({
        data: {
          user_id: user.id,
          provider_id: model.provider_id,
          model_id: model.model_id,
          endpoint,
          reserved_tokens: tokens,
          charged_tokens: tokens,
          deadline_at: deadline,
          started_at: now,
          pricing_version: model.pricing_version,
          input_price: model.input_price,
          output_price: model.output_price,
          fallback_from: model.fallbackFrom,
          credential_id: lease?.credential.id,
          endpoint_id: lease?.endpoint.id,
          provider_type: lease?.provider.type,
          account_group: lease?.provider.accountGroup,
        },
      });
    });
  }
  async finish(
    id: string,
    status: string,
    usage: AiUsage | null,
    errorCategory?: string,
    providerId?: string,
    undispatched = false,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.aiQuotaPolicy.update({
        where: { id: 'default' },
        data: { lock_version: { increment: 1 } },
      });
      const record = await tx.aiUsageRecord.findUniqueOrThrow({ where: { id } });
      if (record.status !== 'reserved') return;
      const known =
        usage?.inputTokens !== null &&
        usage?.inputTokens !== undefined &&
        usage?.outputTokens !== null &&
        usage?.outputTokens !== undefined &&
        Number.isSafeInteger(usage.inputTokens) &&
        usage.inputTokens >= 0 &&
        Number.isSafeInteger(usage.outputTokens) &&
        usage.outputTokens >= 0;
      const charged = undispatched
        ? 0
        : known
          ? usage.inputTokens! + usage.outputTokens!
          : record.reserved_tokens;
      const day = new Date(
        Date.UTC(
          record.started_at.getUTCFullYear(),
          record.started_at.getUTCMonth(),
          record.started_at.getUTCDate(),
        ),
      );
      await tx.aiUsageBucket.update({
        where: { user_id_day: { user_id: record.user_id, day } },
        data: { charged_tokens: { increment: charged - record.charged_tokens } },
      });
      await tx.aiUsageRecord.update({
        where: { id },
        data: {
          status,
          input_tokens: usage?.inputTokens,
          output_tokens: usage?.outputTokens,
          total_tokens: usage?.totalTokens,
          estimated_cost:
            typeof usage?.costUsd === 'number' &&
            Number.isFinite(usage.costUsd) &&
            usage.costUsd >= 0
              ? new Prisma.Decimal(usage.costUsd.toFixed(8))
              : typeof usage?.costUsd === 'string' &&
                  /^(?:0|[1-9]\d{0,9})(?:\.\d{1,8})?$/.test(usage.costUsd)
                ? new Prisma.Decimal(usage.costUsd)
                : known &&
                    record.input_price !== null &&
                    record.output_price !== null &&
                    record.pricing_version
                  ? new Prisma.Decimal(usage.inputTokens!)
                      .mul(record.input_price)
                      .add(new Prisma.Decimal(usage.outputTokens!).mul(record.output_price))
                      .div(1000000)
                  : null,
          charged_tokens: charged,
          error_category: errorCategory,
          provider_request_id: providerId?.slice(0, 200),
          finished_at: new Date(),
        },
      });
    });
  }
}
