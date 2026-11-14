import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AiModel } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { ErrorCode } from '../../shared/sdk/errors/error-codes.enum';
import { ConflictException, NotFoundException } from '../../shared/sdk/errors/domain.exception';
import type { RequestUser } from '../../shared/sdk';
import { AiError } from './ai.error';
import { providerError } from './ai.error';
import { AiQuotaDto, CreateAiModelDto, UpdateAiModelDto } from './ai.dto';
import { ProviderClients } from './provider-clients';
import { auditContent } from '../courses/content-integrity';
import { AiVaultService } from './vault/ai-vault.service';
import { PROVIDER_CAPABILITIES, ProviderType } from './vault/vault-schema';
import { AiCircuitBreakerService } from './ai-circuit-breaker.service';
import { Optional } from '@nestjs/common';

@Injectable()
export class AiRegistryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ProviderClients,
    private readonly config: ConfigService,
    private readonly vault: AiVaultService,
    @Optional() private readonly circuitBreaker?: AiCircuitBreakerService,
  ) {}
  async providers() {
    const providers = await this.prisma.aiProvider.findMany({ orderBy: { id: 'asc' } });
    return Promise.all(
      providers.map(async (provider) => {
        const circuit = await this.circuitBreaker?.snapshot(provider.id);
        return {
          id: provider.id,
          type: provider.type,
          enabled: provider.enabled,
          configured: await this.clients.available(provider.id),
          circuitState: circuit?.state ?? 'CLOSED',
          consecutiveFailures: circuit?.consecutiveFailures ?? 0,
        };
      }),
    );
  }
  models(user: RequestUser, all = false) {
    return this.prisma.aiModel.findMany({
      where: all
        ? {}
        : {
            enabled: true,
            provider: { enabled: true },
            ...(!user.permissions.includes('ai:premium') ? { premium: false } : {}),
          },
      orderBy: [{ provider_id: 'asc' }, { model_id: 'asc' }],
      take: 100,
    });
  }
  async select(
    user: RequestUser,
    capability: string,
    modelId?: string,
    provider?: string,
    allowFallback = false,
  ): Promise<AiModel & { providerType: string; fallbackFrom?: string }> {
    const model = await this.prisma.aiModel.findFirst({
      include: { provider: true },
      where: {
        ...(modelId ? { id: modelId } : { is_default: true }),
        enabled: true,
        provider: { enabled: true },
        ...(provider ? { provider_id: provider } : {}),
      },
    });
    if (!model)
      throw new AiError(
        ErrorCode.AI_MODEL_UNAVAILABLE,
        503,
        'No enabled model matches this request',
      );
    if (model.premium && !user.permissions.includes('ai:premium'))
      throw new AiError(ErrorCode.FORBIDDEN, 403, 'Premium model permission required');
    if (!model.capabilities.includes(capability))
      throw new AiError(
        ErrorCode.AI_CAPABILITY_UNSUPPORTED,
        400,
        `Model does not support ${capability}`,
      );
    if (!(await this.clients.available(model.provider_id))) {
      if (allowFallback && this.config.get<boolean>('AI_FALLBACK_ENABLED', false)) {
        const candidate = await this.selectFallback(user, model, capability, [model.id]);
        if (candidate) return candidate;
      }
      throw new AiError(
        ErrorCode.AI_PROVIDER_UNAVAILABLE,
        503,
        'Provider credentials are unavailable',
      );
    }
    return { ...model, providerType: model.provider.type };
  }

  async selectFallback(
    user: RequestUser,
    primaryModel: AiModel & { providerType?: string },
    capability: string,
    excludedModelIds: string[] = [],
  ): Promise<(AiModel & { providerType: string; fallbackFrom: string }) | null> {
    if (!this.config.get<boolean>('AI_FALLBACK_ENABLED', false)) return null;
    for (const fallbackId of primaryModel.fallback_model_ids ?? []) {
      if (excludedModelIds.includes(fallbackId)) continue;
      const fallback = await this.prisma.aiModel.findFirst({
        include: { provider: true },
        where: { id: fallbackId, enabled: true, provider: { enabled: true } },
      });
      if (
        !fallback ||
        (fallback.premium && !user.permissions.includes('ai:premium')) ||
        !primaryModel.capabilities.every((entry) => fallback.capabilities.includes(entry)) ||
        !fallback.capabilities.includes(capability) ||
        !primaryModel.allowed_tools.every((tool) => fallback.allowed_tools.includes(tool))
      )
        continue;
      // Avoid unexpected fallback from a free model (input_price=0 && output_price=0) onto a paid model
      const primaryFree =
        primaryModel.input_price !== null &&
        Number(primaryModel.input_price) === 0 &&
        primaryModel.output_price !== null &&
        Number(primaryModel.output_price) === 0;
      const fallbackPaid =
        fallback.input_price === null ||
        Number(fallback.input_price) > 0 ||
        fallback.output_price === null ||
        Number(fallback.output_price) > 0;
      if (primaryFree && fallbackPaid) continue;

      if (this.circuitBreaker) {
        const admission = await this.circuitBreaker.checkAdmission(fallback.provider_id);
        if (!admission.allowed) continue;
      }
      if (await this.clients.available(fallback.provider_id)) {
        const original = await this.vault.provider(primaryModel.provider_id);
        const target = await this.vault.provider(fallback.provider_id);
        if (!original || !target || original.privacyGroup !== target.privacyGroup) continue;
        return { ...fallback, providerType: fallback.provider.type, fallbackFrom: primaryModel.id };
      }
    }
    return null;
  }
  async providerStatus(id: string, enabled: boolean, actor: string) {
    if (!(await this.prisma.aiProvider.findUnique({ where: { id } }))) throw new NotFoundException('AI provider', id);
    return this.prisma.$transaction(async (tx) => {
      await tx.aiQuotaPolicy.update({
        where: { id: 'default' },
        data: { lock_version: { increment: 1 } },
      });
      const result = await tx.aiProvider.update({ where: { id }, data: { enabled } });
      await auditContent(tx, 'ai.provider_changed', actor, 'ai_provider', id);
      return result;
    });
  }
  async saveModel(dto: CreateAiModelDto | UpdateAiModelDto, actor: string, id?: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Shared lock also protects changing the default model concurrently.
        await tx.aiQuotaPolicy.update({
          where: { id: 'default' },
          data: { lock_version: { increment: 1 } },
        });
        const existing = id ? await tx.aiModel.findUnique({ where: { id } }) : null;
        if (id && !existing) throw new NotFoundException('AI model', id);
        const data = {
          provider_id: dto.providerId,
          model_id: dto.modelId,
          enabled: dto.enabled,
          is_default: dto.isDefault,
          premium: dto.premium,
          capabilities: dto.capabilities,
          allowed_tools: dto.allowedTools,
          fallback_model_ids: dto.fallbackModelIds,
          input_price: dto.inputPrice,
          output_price: dto.outputPrice,
          pricing_version: dto.pricingVersion,
          max_input_tokens: dto.maxInputTokens,
          max_output_tokens: dto.maxOutputTokens,
          context_tokens: dto.contextTokens,
        };
        const candidate = {
          ...existing,
          ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
        };
        const provider = String(candidate.provider_id);
        const capabilities = candidate.capabilities as string[];
        const providerRecord = await tx.aiProvider.findUnique({ where: { id: provider } });
        if (!providerRecord) throw new NotFoundException('AI provider', provider);
        const supported = PROVIDER_CAPABILITIES[providerRecord.type as ProviderType];
        if (!supported || capabilities.some((c) => !supported.includes(c)))
          throw new BadRequestException('Capabilities exceed the implemented provider adapter');
        const prices = [candidate.input_price, candidate.output_price, candidate.pricing_version];
        if (
          prices.some((entry) => entry !== null && entry !== undefined) &&
          !prices.every((entry) => entry !== null && entry !== undefined)
        )
          throw new BadRequestException(
            'Set inputPrice, outputPrice and pricingVersion together, or clear all three',
          );
        for (const fallbackId of candidate.fallback_model_ids ?? []) {
          if (fallbackId === id || !(await tx.aiModel.findUnique({ where: { id: fallbackId } })))
            throw new BadRequestException('Fallback must reference a different existing model');
        }
        if (
          Number(candidate.max_input_tokens) + Number(candidate.max_output_tokens) >
          Number(candidate.context_tokens)
        )
          throw new BadRequestException('Input and output limits exceed context window');
        if (
          providerRecord.type === 'anthropic' &&
          capabilities.some((capability) => ['embeddings', 'responses'].includes(capability))
        )
          throw new BadRequestException(
            'Anthropic adapter does not support embeddings or Responses',
          );
        if (candidate.is_default && (!candidate.enabled || !capabilities.includes('chat')))
          throw new BadRequestException('Default model must be enabled and support chat');
        if (dto.isDefault)
          await tx.aiModel.updateMany({ where: { is_default: true }, data: { is_default: false } });
        const model = id
          ? await tx.aiModel.update({ where: { id }, data })
          : await tx.aiModel.create({ data: data as Prisma.AiModelUncheckedCreateInput });
        await auditContent(
          tx,
          id ? 'ai.model_updated' : 'ai.model_created',
          actor,
          'ai_model',
          model.id,
        );
        return model;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Provider/model combination already exists');
      throw error;
    }
  }
  quota(userId?: string) {
    return this.prisma.aiQuotaPolicy.findUnique({ where: { id: userId ?? 'default' } });
  }
  async discover(provider: string) {
    const metadata = await this.prisma.aiProvider.findUnique({ where: { id: provider } });
    if (!metadata?.enabled) throw new NotFoundException('AI provider', provider);
    const timeout = AbortSignal.timeout(this.clients.timeout());
    const lease = await this.clients.acquire(provider, '', 'model-list', 0);
    let failure: unknown;
    try {
      let ids: string[];
      if (metadata.type === 'gemini') {
        const list = await (await this.clients.gemini(lease)).models.list({ config: { pageSize: 100 } });
        ids = [];
        for await (const entry of list) { if (entry.name) ids.push(entry.name.replace(/^models\//, '')); if (ids.length >= 100) break; }
      } else if (metadata.type === 'workers-ai') {
        const client = await this.clients.workersAi(lease);
        const searchPath = client.baseUrl.replace(/\/ai\/run\/?$/, '/ai/models/search');
        const relativePath = searchPath.startsWith(client.baseUrl)
          ? searchPath.slice(client.baseUrl.length)
          : 'models';
        const response = await client.get(relativePath, timeout);
        if (!response.ok) throw { status: response.status, headers: response.headers };
        const payload = (await response.json()) as {
          result?: Array<{ name?: string; id?: string }>;
          data?: Array<{ name?: string; id?: string }>;
        };
        const entries: Array<{ name?: string; id?: string }> =
          payload.result ?? payload.data ?? [];
        ids = entries.map((entry) => entry.name ?? entry.id ?? '').filter(Boolean);
      } else if (metadata.type === 'openrouter') {
        ids = (await (await this.clients.openrouter(lease)).models.list({ signal: timeout })).data.map(
          (model) => model.id,
        );
      } else ids =
        metadata.type !== 'anthropic'
          ? (await (await this.clients.openai(lease)).models.list({ signal: timeout })).data.map(
              (model) => model.id,
            )
          : (
              await (
                await this.clients.anthropic(lease)
              ).models.list({ limit: 100 }, { signal: timeout })
            ).data.map((model) => model.id);
      return {
        provider,
        modelIds: ids.slice(0, 100),
        note: 'Metadata only; capabilities and prices require explicit registry configuration',
      };
    } catch (error) {
      failure = error;
      throw providerError(error, timeout, 'model-discovery');
    } finally {
      await this.clients.finish(lease, null, failure).catch(() => undefined);
    }
  }
  async saveQuota(dto: AiQuotaDto, actor: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.aiQuotaPolicy.update({
        where: { id: 'default' },
        data: { lock_version: { increment: 1 } },
      });
      if (userId && !(await tx.user.findFirst({ where: { id: userId, deleted_at: null } })))
        throw new NotFoundException('User', userId);
      const data = {
        daily_requests: dto.dailyRequests,
        daily_tokens: dto.dailyTokens,
        requests_per_minute: dto.requestsPerMinute,
        max_concurrent: dto.maxConcurrent,
      };
      const result = await tx.aiQuotaPolicy.upsert({
        where: { id: userId ?? 'default' },
        create: { id: userId ?? 'default', user_id: userId, ...data },
        update: data,
      });
      await auditContent(tx, 'ai.quota_updated', actor, 'ai_quota', result.id);
      return result;
    });
  }
}
