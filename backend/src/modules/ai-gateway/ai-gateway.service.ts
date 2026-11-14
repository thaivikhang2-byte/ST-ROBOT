import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiModel } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { RequestUser } from '../../shared/sdk';
import { ErrorCode } from '../../shared/sdk/errors/error-codes.enum';
import { AiChatDto, AiEmbeddingDto, AiUsageQueryDto } from './ai.dto';
import { AiError, providerError } from './ai.error';
import { AiRegistryService } from './ai-registry.service';
import { AiQuotaService } from './ai-quota.service';
import { OpenAiAdapter } from './openai.adapter';
import { AnthropicAdapter } from './anthropic.adapter';
import { GeminiAdapter } from './gemini.adapter';
import { CompatibleAdapter } from './compatible.adapter';
import { OpenRouterAdapter } from './openrouter.adapter';
import { WorkersAiAdapter } from './workers-ai.adapter';
import { AiCircuitBreakerService } from './ai-circuit-breaker.service';
import { ProviderClients } from './provider-clients';
import type { ProviderLease } from './provider-leases';
import type { AiAdapter, AiStreamEvent, AiUsage } from './ai.types';
import { PaginatedResult } from '../../shared/sdk';
import { MetricsService } from '../../metrics/metrics.service';

@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly registry: AiRegistryService,
    private readonly quota: AiQuotaService,
    private readonly openai: OpenAiAdapter,
    private readonly anthropic: AnthropicAdapter,
    private readonly gemini: GeminiAdapter,
    private readonly compatible: CompatibleAdapter,
    private readonly clients: ProviderClients,
    @Optional() private readonly openrouter?: OpenRouterAdapter,
    @Optional() private readonly workersAi?: WorkersAiAdapter,
    @Optional() private readonly circuitBreaker?: AiCircuitBreakerService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  private async enabled() {
    if (
      !this.config.get<boolean>('AI_GATEWAY_ENABLED', false) ||
      !(await this.prisma.featureFlag.findUnique({ where: { key: 'ai_chat' } }))?.is_enabled
    )
      throw new AiError(ErrorCode.FEATURE_DISABLED, 503, 'AI Gateway is disabled');
  }

  /** Reads local configuration only; never dispatches a provider request. */
  async configurationStatus(user: RequestUser) {
    const enabled = Boolean(
      this.config.get<boolean>('AI_GATEWAY_ENABLED', false) &&
      (await this.prisma.featureFlag.findUnique({ where: { key: 'ai_chat' } }))?.is_enabled,
    );
    if (!enabled) {
      return {
        available: false,
        code: 'gateway_disabled',
        message: 'Trợ lý tài khoản chưa được bật trên máy chủ. AI trong bài học vẫn dùng cấu hình riêng hiện tại.',
      };
    }
    const models = await this.registry.models(user);
    const providers = await this.registry.providers();
    const available = models.some(
      (model) => model.capabilities.includes('chat') &&
        providers.some((provider) => provider.id === model.provider_id && provider.enabled && provider.configured),
    );
    return {
      available,
      code: available ? 'configured' : 'provider_not_configured',
      message: available
        ? 'Trợ lý tài khoản đã có cấu hình. Khả năng trả lời còn phụ thuộc kết nối và hạn mức nhà cung cấp.'
        : 'Trợ lý tài khoản chưa có mô hình và nhà cung cấp được cấu hình đầy đủ. Liên hệ người quản lí để thiết lập.',
    };
  }
  private adapter(model: AiModel & { providerType: string }): AiAdapter {
    if (model.providerType === 'openai') return this.openai;
    if (model.providerType === 'anthropic') return this.anthropic;
    if (model.providerType === 'gemini') return this.gemini;
    if (model.providerType === 'openai-compatible') return this.compatible;
    if (model.providerType === 'openrouter') return this.openrouter ?? this.compatible;
    if (model.providerType === 'workers-ai' && this.workersAi) return this.workersAi;
    throw new AiError(ErrorCode.AI_PROVIDER_UNAVAILABLE, 503, 'Provider is unsupported');
  }
  private validateJson(value: unknown, depth = 0): void {
    if (depth > 12) throw new BadRequestException('Tool schema nesting exceeds limit');
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor', '$id'].includes(key))
        throw new BadRequestException('Unsafe tool schema property');
      if (key === '$ref' && (typeof child !== 'string' || !child.startsWith('#/')))
        throw new BadRequestException('Remote schema references are unsupported');
      this.validateJson(child, depth + 1);
    }
  }
  private validateChat(
    model: AiModel & { providerType: string },
    dto: AiChatDto,
    user: RequestUser,
    streaming: boolean,
    registeredAgentTools = false,
  ): number {
    const serialized = JSON.stringify(dto);
    if (Buffer.byteLength(serialized) > 64000)
      throw new BadRequestException('AI request exceeds 64 KB');
    if (streaming && !model.capabilities.includes('streaming'))
      throw new AiError(
        ErrorCode.AI_CAPABILITY_UNSUPPORTED,
        400,
        'Model does not support streaming',
      );
    if (dto.temperature !== undefined && !model.capabilities.includes('temperature'))
      throw new AiError(
        ErrorCode.AI_CAPABILITY_UNSUPPORTED,
        400,
        'Model does not support temperature',
      );
    if (dto.structuredOutput) {
      if (!model.capabilities.includes('structured_output'))
        throw new AiError(
          ErrorCode.AI_CAPABILITY_UNSUPPORTED,
          400,
          'Model does not support structured output',
        );
      if (dto.structuredOutput.schema.type !== 'object')
        throw new BadRequestException('Output schema must have type object');
      this.validateJson(dto.structuredOutput.schema);
    }
    const calls = new Set<string>();
    if (model.providerType === 'anthropic') {
      const conversation = dto.messages.filter(
        (message) => !['system', 'developer'].includes(message.role),
      );
      if (
        !conversation.length ||
        conversation[0].role !== 'user' ||
        !['user', 'tool'].includes(conversation[conversation.length - 1].role)
      )
        throw new BadRequestException(
          'Anthropic conversations must begin with a user message and end with user input or tool results',
        );
    }
    const pending = new Set<string>();
    for (const message of dto.messages) {
      if (message.images?.length) {
        if (message.role !== 'user' || model.providerType !== 'gemini' || !model.capabilities.includes('vision'))
          throw new BadRequestException('Inline images require a Gemini vision model and user role');
        for (const image of message.images) {
          const bytes = Buffer.from(image.dataBase64, 'base64');
          const valid = image.mimeType === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))
            : image.mimeType === 'image/jpeg' ? bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))
            : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP';
          if (!valid || bytes.toString('base64') !== image.dataBase64) throw new BadRequestException('Image encoding or MIME signature is invalid');
        }
      }
      if (message.providerContext?.length) {
        if (message.role !== 'assistant' || !model.capabilities.includes('reasoning_context'))
          throw new AiError(
            ErrorCode.AI_CAPABILITY_UNSUPPORTED,
            400,
            'Assistant provider context is not supported for this model',
          );
        for (const context of message.providerContext) {
          if (model.providerType === 'openai') {
            if (
              context.type !== 'openai_reasoning' ||
              !context.id ||
              !context.encryptedContent ||
              context.thinking !== undefined ||
              context.signature !== undefined ||
              context.data !== undefined
            )
              throw new BadRequestException('Invalid OpenAI reasoning context');
          } else if (model.providerType === 'gemini' && context.type === 'gemini_thinking') {
            if (!context.id || !context.signature || !message.toolCalls?.some((c) => c.id === context.id) ||
              context.thinking !== undefined || context.encryptedContent !== undefined || context.data !== undefined || context.summary !== undefined)
              throw new BadRequestException('Invalid Gemini thought signature');
          } else if (model.providerType === 'anthropic' && context.type === 'anthropic_thinking') {
            if (
              context.thinking === undefined ||
              !context.signature ||
              context.id !== undefined ||
              context.encryptedContent !== undefined ||
              context.summary !== undefined ||
              context.data !== undefined
            )
              throw new BadRequestException('Invalid Anthropic thinking context');
          } else if (model.providerType === 'anthropic' && context.type === 'anthropic_redacted') {
            if (
              !context.data ||
              context.id !== undefined ||
              context.encryptedContent !== undefined ||
              context.summary !== undefined ||
              context.thinking !== undefined ||
              context.signature !== undefined
            )
              throw new BadRequestException('Invalid redacted thinking context');
          } else throw new BadRequestException('Provider context does not match selected provider');
        }
      }
      if (message.role === 'tool') {
        if (!message.toolCallId || !pending.delete(message.toolCallId) || message.toolCalls?.length)
          throw new BadRequestException('Tool result has no matching pending call');
      } else {
        if (message.toolCallId)
          throw new BadRequestException('Only tool results may contain toolCallId');
        if (pending.size)
          throw new BadRequestException(
            'Complete tool results before the next conversational message',
          );
        if (message.toolCalls?.length && message.role !== 'assistant')
          throw new BadRequestException('Tool calls require assistant role');
        if (
          !message.content.trim() &&
          !message.toolCalls?.length &&
          !message.providerContext?.length
        )
          throw new BadRequestException('Message content cannot be empty');
        for (const call of message.toolCalls ?? []) {
          if (calls.has(call.id)) throw new BadRequestException('Duplicate tool call ID');
          calls.add(call.id);
          pending.add(call.id);
        }
      }
    }
    if (pending.size)
      throw new BadRequestException('All tool calls require results before generation');
    if (dto.tools?.length || calls.size) {
      // Internal Agent calls use a server-owned allowlist and reauthorize every
      // execution. Direct Gateway endpoints still require ai:tools.
      if (!registeredAgentTools && !user.permissions.includes('ai:tools'))
        throw new AiError(ErrorCode.FORBIDDEN, 403, 'Tool permission required');
      if (!model.capabilities.includes('tools'))
        throw new AiError(ErrorCode.AI_CAPABILITY_UNSUPPORTED, 400, 'Model does not support tools');
      const names = (dto.tools ?? []).map((tool) => tool.name);
      if (new Set(names).size !== names.length)
        throw new BadRequestException('Duplicate tool definition');
      for (const message of dto.messages)
        for (const call of message.toolCalls ?? [])
          if (!model.allowed_tools.includes(call.name))
            throw new BadRequestException('Tool is not allowed for this model');
      for (const tool of dto.tools ?? []) {
        if (!model.allowed_tools.includes(tool.name))
          throw new BadRequestException('Tool is not allowed for this model');
        if (tool.parameters.type !== 'object')
          throw new BadRequestException('Tool schema must have type object');
        this.validateJson(tool.parameters);
      }
    }
    // UTF-8 bytes plus per-message framing provide a conservative reservation, not a reported tokenizer count.
    const inputBound = Buffer.byteLength(serialized) + dto.messages.length * 256 + 1024;
    const output = dto.maxOutputTokens ?? 1024;
    if (
      output > model.max_output_tokens ||
      inputBound > model.max_input_tokens ||
      inputBound + output > model.context_tokens
    )
      throw new BadRequestException('Request exceeds configured model token limits');
    return inputBound + output;
  }
  private context(signal?: AbortSignal) {
    const timeout = new AbortController();
    const duration = Number(this.config.get('AI_REQUEST_TIMEOUT_MS', 60000));
    const timer = setTimeout(() => timeout.abort('timeout'), duration);
    timer.unref();
    return {
      signal: signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal,
      deadline: new Date(Date.now() + duration),
      close: () => clearTimeout(timer),
    };
  }
  private async release(lease: ProviderLease | undefined, usage: AiUsage | null, dispatched: boolean, error?: unknown) {
    if (!lease) return;
    try { await this.clients.finish(lease, dispatched ? usage : { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, error); }
    catch { this.logger.warn('AI routing lease cleanup failed; durable quota remains authoritative'); }
  }
  private stripIncompatibleContext(
    dto: AiChatDto,
    providerType: string,
    supportsReasoningContext: boolean,
  ): AiChatDto {
    return {
      ...dto,
      messages: dto.messages.map((m) => {
        if (!m.providerContext?.length) return m;
        if (!supportsReasoningContext) {
          const { providerContext: _, ...rest } = m;
          return rest;
        }
        const compatible = m.providerContext.filter((ctx) => {
          if (providerType === 'openai') return ctx.type === 'openai_reasoning';
          if (providerType === 'anthropic')
            return ctx.type === 'anthropic_thinking' || ctx.type === 'anthropic_redacted';
          if (providerType === 'gemini') return ctx.type === 'gemini_thinking';
          return false;
        });
        if (!compatible.length) {
          const { providerContext: _, ...rest } = m;
          return rest;
        }
        return { ...m, providerContext: compatible };
      }),
    };
  }

  async chat(
    user: RequestUser,
    dto: AiChatDto,
    external?: AbortSignal,
    responses = false,
    registeredAgentTools = false,
  ) {
    await this.enabled();
    const capability = responses ? 'responses' : 'chat';
    let currentModel = await this.registry.select(
      user,
      capability,
      dto.modelId,
      dto.provider,
      dto.allowFallback,
    );
    const primaryModel = currentModel;
    const context = this.context(external);
    const maxAttempts = Math.max(
      1,
      Number(this.config.get('AI_MAX_APPLICATION_ATTEMPTS', 3)),
    );
    const maxSwitches = Math.max(
      0,
      Number(this.config.get('AI_MAX_PROVIDER_SWITCHES', 1)),
    );
    let switchesUsed = currentModel.fallbackFrom ? 1 : 0;
    const triedModelIds = [currentModel.id];
    let lastError: AiError | undefined;
    let totalAttempts = 0;

    try {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        context.signal.throwIfAborted();
        if (this.circuitBreaker) {
          const admission = await this.circuitBreaker.checkAdmission(currentModel.provider_id);
          if (!admission.allowed) {
            if (dto.allowFallback && switchesUsed < maxSwitches) {
              const nextModel = await this.registry.selectFallback(
                user,
                primaryModel,
                capability,
                triedModelIds,
              );
              if (nextModel) {
                currentModel = nextModel;
                triedModelIds.push(currentModel.id);
                switchesUsed++;
                this.metrics?.aiRetries.inc({
                  provider: currentModel.provider_id,
                  reason: 'circuit_open',
                  outcome: 'switched',
                });
              } else {
                throw new AiError(
                  ErrorCode.AI_CIRCUIT_OPEN,
                  503,
                  'AI provider circuit breaker is open',
                );
              }
            } else {
              throw new AiError(
                ErrorCode.AI_CIRCUIT_OPEN,
                503,
                'AI provider circuit breaker is open',
              );
            }
          }
        }

        const effectiveDto =
          currentModel.id !== primaryModel.id
            ? this.stripIncompatibleContext(
                dto,
                currentModel.providerType,
                currentModel.capabilities.includes('reasoning_context'),
              )
            : dto;

        const tokens = this.validateChat(
          currentModel,
          effectiveDto,
          user,
          false,
          registeredAgentTools,
        );

        let record: { id: string } | undefined;
        let lease: ProviderLease | undefined;
        let failure: unknown;
        let dispatched = false;
        let usage: AiUsage | null = null;
        totalAttempts++;

        try {
          lease = await this.clients.acquire(
            currentModel.provider_id,
            currentModel.model_id,
            capability,
            tokens,
          );
          record = await this.quota.reserve(
            user,
            currentModel,
            capability,
            tokens,
            context.deadline,
            !!effectiveDto.tools?.length ||
              effectiveDto.messages.some((message) => !!message.toolCalls?.length),
            lease,
            registeredAgentTools,
          );
          context.signal.throwIfAborted();
          dispatched = true;
          const result = await this.adapter(currentModel).chat(
            currentModel.model_id,
            effectiveDto,
            context.signal,
            lease,
          );
          usage = result.usage;
          context.signal.throwIfAborted();
          await this.quota.finish(record.id, 'completed', result.usage, undefined, result.id);
          await this.circuitBreaker?.recordSuccess(currentModel.provider_id);
          return {
            requestId: record.id,
            provider: currentModel.provider_id,
            model: currentModel.model_id,
            fallbackFrom: currentModel.fallbackFrom,
            attempts: totalAttempts,
            ...result,
          };
        } catch (error) {
          failure = error;
          const safe = providerError(error, context.signal, record?.id ?? 'not-dispatched');
          lastError = safe;
          if (record) {
            await this.quota.finish(
              record.id,
              context.signal.aborted ? 'interrupted' : 'failed',
              usage,
              safe.code,
              undefined,
              !dispatched,
            );
          }
          if (dispatched) {
            await this.circuitBreaker?.recordFailure(currentModel.provider_id, safe);
          }

          const canRetry =
            dispatched &&
            safe.retryable &&
            !context.signal.aborted &&
            attempt + 1 < maxAttempts;

          if (!canRetry) {
            throw safe;
          }

          const remainingMs = context.deadline.getTime() - Date.now();
          let switched = false;
          if (
            dto.allowFallback &&
            switchesUsed < maxSwitches &&
            (attempt >= 1 || safe.upstreamStatus === 503 || safe.upstreamStatus === 429)
          ) {
            const fallbackCandidate = await this.registry.selectFallback(
              user,
              primaryModel,
              capability,
              triedModelIds,
            );
            if (fallbackCandidate) {
              currentModel = fallbackCandidate;
              triedModelIds.push(currentModel.id);
              switchesUsed++;
              switched = true;
              this.metrics?.aiRetries.inc({
                provider: currentModel.provider_id,
                reason: String(safe.upstreamStatus ?? safe.code),
                outcome: 'failover',
              });
            }
          }

          if (!switched) {
            const delayMs = this.circuitBreaker
              ? this.circuitBreaker.computeBackoffMs(attempt, safe.retryAfterMs, remainingMs)
              : Math.min(500 * Math.pow(2, attempt), 2000);
            if (delayMs === null || delayMs + 100 > remainingMs) {
              throw safe;
            }
            this.metrics?.aiRetries.inc({
              provider: currentModel.provider_id,
              reason: String(safe.upstreamStatus ?? safe.code),
              outcome: 'retry',
            });
            if (this.circuitBreaker) {
              await this.circuitBreaker.waitWithSignal(delayMs, context.signal);
            }
          }
        } finally {
          await this.release(lease, usage, dispatched, failure);
        }
      }
      throw (
        lastError ??
        new AiError(ErrorCode.AI_PROVIDER_UNAVAILABLE, 503, 'AI request exhausted retry budget')
      );
    } finally {
      context.close();
    }
  }
  async *stream(
    user: RequestUser,
    dto: AiChatDto,
    external?: AbortSignal,
  ): AsyncGenerator<AiStreamEvent> {
    await this.enabled();
    let currentModel = await this.registry.select(
      user,
      'chat',
      dto.modelId,
      dto.provider,
      dto.allowFallback,
    );
    const primaryModel = currentModel;
    const context = this.context(external);
    const maxAttempts = Math.max(
      1,
      Number(this.config.get('AI_MAX_APPLICATION_ATTEMPTS', 3)),
    );
    const maxSwitches = Math.max(
      0,
      Number(this.config.get('AI_MAX_PROVIDER_SWITCHES', 1)),
    );
    let switchesUsed = currentModel.fallbackFrom ? 1 : 0;
    const triedModelIds = [currentModel.id];

    try {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        context.signal.throwIfAborted();
        if (this.circuitBreaker) {
          const admission = await this.circuitBreaker.checkAdmission(currentModel.provider_id);
          if (!admission.allowed) {
            if (dto.allowFallback && switchesUsed < maxSwitches) {
              const nextModel = await this.registry.selectFallback(
                user,
                primaryModel,
                'streaming',
                triedModelIds,
              );
              if (nextModel) {
                currentModel = nextModel;
                triedModelIds.push(currentModel.id);
                switchesUsed++;
              } else {
                throw new AiError(
                  ErrorCode.AI_CIRCUIT_OPEN,
                  503,
                  'AI provider circuit breaker is open',
                );
              }
            } else {
              throw new AiError(
                ErrorCode.AI_CIRCUIT_OPEN,
                503,
                'AI provider circuit breaker is open',
              );
            }
          }
        }

        const effectiveDto =
          currentModel.id !== primaryModel.id
            ? this.stripIncompatibleContext(
                dto,
                currentModel.providerType,
                currentModel.capabilities.includes('reasoning_context'),
              )
            : dto;
        const tokens = this.validateChat(currentModel, effectiveDto, user, true);

        let record: { id: string } | undefined;
        let finished = false;
        let usage: AiUsage | null = null;
        let lease: ProviderLease | undefined;
        let failure: unknown;
        let dispatched = false;
        let emittedContent = false;

        try {
          lease = await this.clients.acquire(
            currentModel.provider_id,
            currentModel.model_id,
            'streaming',
            tokens,
          );
          record = await this.quota.reserve(
            user,
            currentModel,
            'stream',
            tokens,
            context.deadline,
            !!effectiveDto.tools?.length ||
              effectiveDto.messages.some((message) => !!message.toolCalls?.length),
            lease,
          );
          context.signal.throwIfAborted();
          let terminal: AiStreamEvent | undefined;
          let metadataEmitted = false;
          dispatched = true;

          for await (const event of this.adapter(currentModel).stream(
            currentModel.model_id,
            effectiveDto,
            context.signal,
            lease,
          )) {
            context.signal.throwIfAborted();
            if (!metadataEmitted) {
              metadataEmitted = true;
              yield {
                type: 'metadata',
                data: {
                  requestId: record.id,
                  provider: currentModel.provider_id,
                  model: currentModel.model_id,
                  fallbackFrom: currentModel.fallbackFrom,
                },
              };
            }
            if (event.type === 'text' || event.type === 'tool') {
              emittedContent = true;
            }
            if (event.type === 'usage')
              usage = {
                totalTokens:
                  typeof event.data.totalTokens === 'number' ? event.data.totalTokens : null,
                inputTokens:
                  typeof event.data.inputTokens === 'number' ? event.data.inputTokens : null,
                outputTokens:
                  typeof event.data.outputTokens === 'number' ? event.data.outputTokens : null,
                costUsd:
                  typeof event.data.costUsd === 'number' || typeof event.data.costUsd === 'string'
                    ? event.data.costUsd
                    : null,
              };
            if (event.type === 'end') terminal = event;
            else yield event;
          }
          if (!terminal) throw new Error('No terminal provider event');
          await this.quota.finish(
            record.id,
            'completed',
            usage,
            undefined,
            typeof terminal.data.id === 'string' ? terminal.data.id : undefined,
          );
          await this.circuitBreaker?.recordSuccess(currentModel.provider_id);
          finished = true;
          yield terminal;
          return;
        } catch (error) {
          failure = error;
          const safe = providerError(error, context.signal, record?.id ?? 'not-dispatched');
          if (record)
            await this.quota.finish(
              record.id,
              context.signal.aborted ? 'interrupted' : 'failed',
              usage,
              safe.code,
              undefined,
              !dispatched,
            );
          finished = true;
          if (dispatched) {
            await this.circuitBreaker?.recordFailure(currentModel.provider_id, safe);
          }

          // Never silently splice another model's answer after partial output has been emitted!
          if (
            !dispatched ||
            emittedContent ||
            !safe.retryable ||
            context.signal.aborted ||
            attempt + 1 >= maxAttempts
          ) {
            throw safe;
          }

          const remainingMs = context.deadline.getTime() - Date.now();
          let switched = false;
          if (dto.allowFallback && switchesUsed < maxSwitches) {
            const fallbackCandidate = await this.registry.selectFallback(
              user,
              primaryModel,
              'streaming',
              triedModelIds,
            );
            if (fallbackCandidate) {
              currentModel = fallbackCandidate;
              triedModelIds.push(currentModel.id);
              switchesUsed++;
              switched = true;
            }
          }
          if (!switched) {
            const delayMs = this.circuitBreaker
              ? this.circuitBreaker.computeBackoffMs(attempt, safe.retryAfterMs, remainingMs)
              : 300;
            if (delayMs === null || delayMs + 100 > remainingMs) throw safe;
            if (this.circuitBreaker) {
              await this.circuitBreaker.waitWithSignal(delayMs, context.signal);
            }
          }
        } finally {
          if (record && !finished)
            await this.quota.finish(record.id, 'interrupted', usage, ErrorCode.AI_CANCELLED);
          await this.release(lease, usage, dispatched, failure);
        }
      }
    } finally {
      context.close();
    }
  }
  async embeddings(user: RequestUser, dto: AiEmbeddingDto, external?: AbortSignal, learning = false) {
    await this.enabled();
    const model = await this.registry.select(user, 'embeddings', dto.modelId);
    const tokens = Buffer.byteLength(JSON.stringify(dto.input)) + 1024 + dto.input.length * 256;
    if (Buffer.byteLength(JSON.stringify(dto)) > 64000)
      throw new BadRequestException('AI request exceeds 64 KB');
    if (tokens > model.max_input_tokens || tokens > model.context_tokens)
      throw new BadRequestException('Input exceeds model token limit');
    const adapter = this.adapter(model);
    if (!adapter.embeddings)
      throw new AiError(
        ErrorCode.AI_CAPABILITY_UNSUPPORTED,
        400,
        'Provider does not support embeddings',
      );
    const context = this.context(external);
    let record: { id: string } | undefined;
    let lease: ProviderLease | undefined, failure: unknown, dispatched = false;
    let usage: AiUsage | null = null;
    try {
      lease = await this.clients.acquire(model.provider_id, model.model_id, 'embeddings', tokens);
      record = await this.quota.reserve(user, model, learning ? 'rag_embeddings' : 'embeddings', tokens, context.deadline, false, lease);
      context.signal.throwIfAborted();
      dispatched = true;
      const result = await adapter.embeddings(model.model_id, dto.input, context.signal, lease);
      usage = result.usage;
      if (result.vectors.length !== dto.input.length || result.vectors.some((v) => !v.length || v.length > 4096 || v.length !== result.vectors[0].length || v.some((n) => !Number.isFinite(n))))
        throw new Error('Provider returned invalid embedding dimensions');
      context.signal.throwIfAborted();
      await this.quota.finish(record.id, 'completed', result.usage);
      return {
        requestId: record.id,
        provider: model.provider_id,
        model: model.model_id,
        ...result,
      };
    } catch (error) {
      failure = error;
      const safe = providerError(error, context.signal, record?.id ?? 'not-dispatched');
      if (record)
        await this.quota.finish(
          record.id,
          context.signal.aborted ? 'interrupted' : 'failed',
          usage,
          safe.code,
          undefined,
          !dispatched,
        );
      throw safe;
    } finally {
      context.close();
      await this.release(lease, usage, dispatched, failure);
    }
  }
  async usage(userId: string | undefined, query: AiUsageQueryDto) {
    const where = userId ? { user_id: userId } : {};
    const [records, total] = await Promise.all([
      this.prisma.aiUsageRecord.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: [{ started_at: 'desc' }, { id: 'asc' }],
      }),
      this.prisma.aiUsageRecord.count({ where }),
    ]);
    return new PaginatedResult(records, total, query.page, query.limit);
  }
}
