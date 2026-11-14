import { Injectable } from '@nestjs/common';
import type {
  ChatCompletionMessageParam,
  ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions';
import { ProviderClients } from './provider-clients';
import type { ProviderLease } from './provider-leases';
import type { AiAdapter, AiResult, AiStreamEvent, AiUsage } from './ai.types';
import { AiChatDto } from './ai.dto';
import { AiError } from './ai.error';
import { ErrorCode } from '../../shared/sdk/errors/error-codes.enum';

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number | string;
  total_cost?: number | string;
  completion_tokens_details?: { reasoning_tokens?: number };
}

@Injectable()
export class OpenRouterAdapter implements AiAdapter {
  constructor(private readonly clients: ProviderClients) {}

  private params(model: string, dto: AiChatDto): ChatCompletionCreateParamsNonStreaming {
    const messages: ChatCompletionMessageParam[] = dto.messages.map((m) => {
      if (m.role === 'tool')
        return { role: 'tool', content: m.content, tool_call_id: m.toolCallId! };
      if (m.role === 'developer') return { role: 'system', content: m.content };
      if (m.role === 'assistant')
        return {
          role: 'assistant',
          content: m.content || null,
          ...(m.toolCalls?.length
            ? {
                tool_calls: m.toolCalls.map((c) => ({
                  id: c.id,
                  type: 'function' as const,
                  function: {
                    name: c.name,
                    arguments:
                      typeof c.arguments === 'string'
                        ? c.arguments
                        : JSON.stringify(c.arguments),
                  },
                })),
              }
            : {}),
        };
      return { role: m.role, content: m.content };
    });
    return {
      model,
      messages,
      max_completion_tokens: dto.maxOutputTokens ?? 1024,
      ...(dto.temperature !== undefined ? { temperature: dto.temperature } : {}),
      ...(dto.tools?.length
        ? {
            tools: dto.tools.map((t) => ({
              type: 'function' as const,
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
      ...(dto.structuredOutput
        ? {
            response_format: {
              type: 'json_schema' as const,
              json_schema: {
                name: dto.structuredOutput.name,
                schema: dto.structuredOutput.schema,
                strict: true,
              },
            },
          }
        : {}),
    };
  }

  private parseUsage(raw?: OpenRouterUsage | null): AiUsage {
    const costRaw = raw?.cost ?? raw?.total_cost;
    const costUsd =
      typeof costRaw === 'number' && Number.isFinite(costRaw) && costRaw >= 0
        ? costRaw
        : typeof costRaw === 'string' && /^(?:0|[1-9]\d{0,9})(?:\.\d{1,8})?$/.test(costRaw)
          ? costRaw
          : null;
    return {
      inputTokens: raw?.prompt_tokens ?? null,
      outputTokens: raw?.completion_tokens ?? null,
      totalTokens: raw?.total_tokens ?? null,
      costUsd,
      reasoningTokens: raw?.completion_tokens_details?.reasoning_tokens ?? null,
    };
  }

  async chat(
    model: string,
    dto: AiChatDto,
    signal: AbortSignal,
    lease?: ProviderLease,
  ): Promise<AiResult> {
    const client = await this.clients.openrouter(lease);
    const result = await client.chat.completions.create(this.params(model, dto), { signal });
    const rawResult = result as unknown as {
      error?: { code?: number | string; message?: string };
      model?: string;
      usage?: OpenRouterUsage;
    };
    if (rawResult.error) {
      const code = Number(rawResult.error.code);
      if (code === 402) {
        throw new AiError(
          ErrorCode.AI_PAYMENT_REQUIRED,
          402,
          'OpenRouter account credit or quota exhausted',
          undefined,
          { retryable: false, upstreamStatus: 402 },
        );
      }
      throw new AiError(
        code === 503 ? ErrorCode.AI_PROVIDER_UNAVAILABLE : ErrorCode.AI_UPSTREAM_ERROR,
        code === 503 ? 503 : 502,
        'OpenRouter upstream error',
        undefined,
        { retryable: code === 503 || code === 429 || code >= 500, upstreamStatus: Number.isFinite(code) ? code : 502 },
      );
    }
    const choice = result.choices?.[0];
    if (!choice?.finish_reason)
      throw new Error('OpenRouter completion is missing terminal finish_reason');
    if (choice.finish_reason === ('error' as string))
      throw new AiError(
        ErrorCode.AI_UPSTREAM_ERROR,
        502,
        'OpenRouter model terminated with error finish_reason',
        undefined,
        { retryable: true, upstreamStatus: 502 },
      );
    if (choice.finish_reason === 'content_filter')
      throw new AiError(
        ErrorCode.AI_CONTENT_FILTERED,
        422,
        'OpenRouter response was blocked by content filter',
        undefined,
        { retryable: false },
      );
    return {
      id: result.id,
      text: choice.message.content ?? '',
      toolCalls: (choice.message.tool_calls ?? [])
        .filter((c) => c.type === 'function')
        .map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments })),
      finishReason: choice.finish_reason,
      usage: this.parseUsage(rawResult.usage),
      resolvedModel: rawResult.model ?? model,
      providerOutput: choice.message,
    };
  }

  async *stream(
    model: string,
    dto: AiChatDto,
    signal: AbortSignal,
    lease?: ProviderLease,
  ): AsyncGenerator<AiStreamEvent> {
    const client = await this.clients.openrouter(lease);
    const stream = await client.chat.completions.create(
      { ...this.params(model, dto), stream: true, stream_options: { include_usage: true } },
      { signal },
    );
    let id = '';
    let reason: string | null = null;
    try {
      for await (const event of stream) {
        const rawEvent = event as unknown as {
          error?: { code?: number | string; message?: string };
          usage?: OpenRouterUsage;
        };
        if (rawEvent.error) {
          throw new AiError(
            ErrorCode.AI_UPSTREAM_ERROR,
            502,
            'OpenRouter stream interrupted by upstream error',
            undefined,
            { retryable: !id, upstreamStatus: 502 },
          );
        }
        if (!id && event.id) {
          id = event.id;
          yield { type: 'start', data: { id } };
        }
        const choice = event.choices?.[0];
        if (choice?.delta?.content)
          yield { type: 'text', data: { delta: choice.delta.content, index: 0 } };
        for (const call of choice?.delta?.tool_calls ?? [])
          yield {
            type: 'tool',
            data: {
              index: call.index,
              id: call.id,
              name: call.function?.name,
              delta: call.function?.arguments ?? '',
            },
          };
        if (choice?.finish_reason) {
          if (choice.finish_reason === ('error' as string)) {
            throw new AiError(
              ErrorCode.AI_UPSTREAM_ERROR,
              502,
              'OpenRouter stream terminated with finish_reason error',
              undefined,
              { retryable: false, upstreamStatus: 502 },
            );
          }
          reason = choice.finish_reason;
        }
        if (rawEvent.usage) {
          const parsed = this.parseUsage(rawEvent.usage);
          yield {
            type: 'usage',
            data: {
              inputTokens: parsed.inputTokens,
              outputTokens: parsed.outputTokens,
              totalTokens: parsed.totalTokens,
              costUsd: parsed.costUsd,
            },
          };
        }
      }
      if (!id || !reason) throw new Error('OpenRouter stream closed before terminal finish_reason');
      yield { type: 'end', data: { id, finishReason: reason } };
    } finally {
      stream.controller.abort();
    }
  }

  async embeddings(model: string, input: string[], signal: AbortSignal, lease?: ProviderLease) {
    const client = await this.clients.openrouter(lease);
    const response = await client.embeddings.create(
      { model, input, encoding_format: 'float' },
      { signal },
    );
    return {
      vectors: response.data
        .sort((left, right) => left.index - right.index)
        .map((item) => item.embedding),
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? null,
        outputTokens: 0,
        totalTokens: response.usage?.total_tokens ?? null,
      },
    };
  }
}
