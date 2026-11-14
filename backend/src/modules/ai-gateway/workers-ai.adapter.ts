import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ProviderClients } from './provider-clients';
import type { ProviderLease } from './provider-leases';
import type { AiAdapter, AiResult, AiStreamEvent, AiUsage } from './ai.types';
import { AiChatDto } from './ai.dto';
import { AiError, parseRetryAfterMs } from './ai.error';
import { ErrorCode } from '../../shared/sdk/errors/error-codes.enum';

interface WorkersAiEnvelope {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: {
    id?: string;
    response?: string;
    tool_calls?: Array<{
      id?: string;
      name?: string;
      arguments?: unknown;
      function?: { name?: string; arguments?: unknown };
    }>;
    choices?: Array<{
      finish_reason?: string;
      message?: {
        content?: string;
        tool_calls?: Array<{
          id?: string;
          function?: { name?: string; arguments?: unknown };
        }>;
      };
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
    data?: number[][];
  };
}

@Injectable()
export class WorkersAiAdapter implements AiAdapter {
  constructor(private readonly clients: ProviderClients) {}

  private isOpenAiCompatUrl(baseUrl: string): boolean {
    return /\/ai\/v1\/?$/.test(baseUrl) || baseUrl.includes('gateway.ai.cloudflare.com');
  }

  private serializeMessages(dto: AiChatDto) {
    return dto.messages.map((m) => {
      if (m.role === 'tool')
        return { role: 'tool', content: m.content, tool_call_id: m.toolCallId };
      if (m.role === 'developer') return { role: 'system', content: m.content };
      if (m.role === 'assistant')
        return {
          role: 'assistant',
          content: m.content || '',
          ...(m.toolCalls?.length
            ? {
                tool_calls: m.toolCalls.map((c) => ({
                  id: c.id,
                  type: 'function',
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
  }

  private payload(model: string, dto: AiChatDto, openAiCompat: boolean, stream = false) {
    return {
      ...(openAiCompat ? { model } : {}),
      messages: this.serializeMessages(dto),
      max_tokens: dto.maxOutputTokens ?? 1024,
      ...(stream ? { stream: true } : {}),
      ...(dto.temperature !== undefined ? { temperature: dto.temperature } : {}),
      ...(dto.tools?.length
        ? {
            tools: dto.tools.map((t) =>
              openAiCompat
                ? {
                    type: 'function',
                    function: {
                      name: t.name,
                      description: t.description,
                      parameters: t.parameters,
                    },
                  }
                : {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters,
                  },
            ),
          }
        : {}),
      ...(dto.structuredOutput
        ? {
            response_format: {
              type: 'json_schema',
              json_schema: openAiCompat
                ? {
                    name: dto.structuredOutput.name,
                    schema: dto.structuredOutput.schema,
                    strict: true,
                  }
                : dto.structuredOutput.schema,
            },
          }
        : {}),
    };
  }

  private throwHttpFailure(response: Response): never {
    const status = response.status;
    const retryAfterMs = parseRetryAfterMs(response.headers);
    if (status === 429)
      throw new AiError(
        ErrorCode.AI_UPSTREAM_RATE_LIMIT,
        429,
        'Cloudflare Workers AI rate limit reached',
        undefined,
        { retryable: true, retryAfterMs, upstreamStatus: 429 },
      );
    if (status === 401 || status === 403)
      throw new AiError(
        ErrorCode.AI_PROVIDER_UNAVAILABLE,
        503,
        'Cloudflare Workers AI credentials rejected',
        undefined,
        { retryable: false, upstreamStatus: status },
      );
    if (status === 402)
      throw new AiError(
        ErrorCode.AI_PAYMENT_REQUIRED,
        402,
        'Cloudflare Workers AI quota or billing limit reached',
        undefined,
        { retryable: false, upstreamStatus: 402 },
      );
    if (status === 400 || status === 422)
      throw new AiError(
        ErrorCode.AI_CAPABILITY_UNSUPPORTED,
        400,
        'Cloudflare Workers AI rejected model options',
        undefined,
        { retryable: false, upstreamStatus: status },
      );
    if (status === 408)
      throw new AiError(
        ErrorCode.AI_TIMEOUT,
        504,
        'Cloudflare Workers AI request timed out',
        undefined,
        { retryable: true, retryAfterMs, upstreamStatus: 408 },
      );
    if (status === 503)
      throw new AiError(
        ErrorCode.AI_PROVIDER_UNAVAILABLE,
        503,
        'Cloudflare Workers AI temporarily unavailable (HTTP 503)',
        undefined,
        { retryable: true, retryAfterMs, upstreamStatus: 503 },
      );
    throw new AiError(
      ErrorCode.AI_UPSTREAM_ERROR,
      502,
      'Cloudflare Workers AI upstream failure',
      undefined,
      { retryable: status >= 500, retryAfterMs, upstreamStatus: status },
    );
  }

  private parseUsage(usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  }): AiUsage {
    return {
      inputTokens: typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : null,
      outputTokens: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : null,
      totalTokens: typeof usage?.total_tokens === 'number' ? usage.total_tokens : null,
    };
  }

  async chat(
    model: string,
    dto: AiChatDto,
    signal: AbortSignal,
    lease?: ProviderLease,
  ): Promise<AiResult> {
    const client = await this.clients.workersAi(lease);
    const openAiCompat = this.isOpenAiCompatUrl(client.baseUrl);
    const path = openAiCompat ? 'chat/completions' : model;
    const response = await client.request(path, this.payload(model, dto, openAiCompat, false), signal);
    if (!response.ok) {
      await response.body?.cancel();
      this.throwHttpFailure(response);
    }
    const body = (await response.json()) as WorkersAiEnvelope & {
      id?: string;
      choices?: NonNullable<WorkersAiEnvelope['result']>['choices'];
      usage?: NonNullable<WorkersAiEnvelope['result']>['usage'];
    };
    if (body.success === false) {
      throw new AiError(
        ErrorCode.AI_UPSTREAM_ERROR,
        502,
        'Cloudflare Workers AI returned success=false',
        undefined,
        { retryable: false },
      );
    }
    const data: NonNullable<WorkersAiEnvelope['result']> = body.result ?? body;
    const choice = data.choices?.[0];
    const text =
      typeof data.response === 'string'
        ? data.response
        : typeof choice?.message?.content === 'string'
          ? choice.message.content
          : '';
    const rawCalls = data.tool_calls ?? choice?.message?.tool_calls ?? [];
    const toolCalls = rawCalls
      .filter((c: { name?: string; function?: { name?: string } }) =>
        Boolean(c.name || c.function?.name),
      )
      .map(
        (
          c: {
            id?: string;
            name?: string;
            arguments?: unknown;
            function?: { name?: string; arguments?: unknown };
          },
          idx: number,
        ) => ({
          id: c.id ?? `workers-call-${idx}`,
          name: (c.name ?? c.function?.name)!,
          arguments: (c.arguments ?? c.function?.arguments ?? {}) as
            | string
            | Record<string, unknown>,
        }),
      );
    const finishReason =
      choice?.finish_reason ?? (toolCalls.length ? 'tool_calls' : 'stop');
    if (finishReason === 'error') {
      throw new AiError(
        ErrorCode.AI_UPSTREAM_ERROR,
        502,
        'Cloudflare Workers AI completion terminated with error',
        undefined,
        { retryable: true, upstreamStatus: 502 },
      );
    }
    return {
      id: data.id ?? body.id ?? `cf-${randomUUID()}`,
      text,
      toolCalls,
      finishReason,
      usage: this.parseUsage(data.usage ?? body.usage),
      providerOutput: data,
    };
  }

  async *stream(
    model: string,
    dto: AiChatDto,
    signal: AbortSignal,
    lease?: ProviderLease,
  ): AsyncGenerator<AiStreamEvent> {
    const client = await this.clients.workersAi(lease);
    const openAiCompat = this.isOpenAiCompatUrl(client.baseUrl);
    const path = openAiCompat ? 'chat/completions' : model;
    const response = await client.request(path, this.payload(model, dto, openAiCompat, true), signal);
    if (!response.ok) {
      await response.body?.cancel();
      this.throwHttpFailure(response);
    }
    if (!response.body) {
      throw new Error('Cloudflare Workers AI stream body is missing');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const id = `cf-stream-${randomUUID()}`;
    let started = false;
    let doneReceived = false;
    let finishReason = 'stop';

    try {
      while (true) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          if (!frame) continue;
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const rawData = line.slice(5).trim();
            if (!rawData) continue;
            if (rawData === '[DONE]') {
              doneReceived = true;
              continue;
            }
            const parsed = JSON.parse(rawData) as {
              id?: string;
              response?: string;
              error?: unknown;
              tool_calls?: Array<{ id?: string; name?: string; arguments?: unknown }>;
              choices?: Array<{
                finish_reason?: string;
                delta?: {
                  content?: string;
                  tool_calls?: Array<{
                    index?: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
              }>;
              usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
                total_tokens?: number;
              };
            };
            if (parsed.error) {
              throw new AiError(
                ErrorCode.AI_UPSTREAM_ERROR,
                502,
                'Cloudflare Workers AI stream error event',
                undefined,
                { retryable: !started, upstreamStatus: 502 },
              );
            }
            if (!started) {
              started = true;
              yield { type: 'start', data: { id: parsed.id ?? id } };
            }
            if (typeof parsed.response === 'string' && parsed.response.length > 0) {
              yield { type: 'text', data: { delta: parsed.response, index: 0 } };
            }
            const choice = parsed.choices?.[0];
            if (choice?.delta?.content) {
              yield { type: 'text', data: { delta: choice.delta.content, index: 0 } };
            }
            for (const tc of parsed.tool_calls ?? []) {
              if (tc.name) {
                yield {
                  type: 'tool',
                  data: {
                    id: tc.id ?? `workers-call-0`,
                    name: tc.name,
                    delta:
                      typeof tc.arguments === 'string'
                        ? tc.arguments
                        : JSON.stringify(tc.arguments ?? {}),
                  },
                };
              }
            }
            for (const tc of choice?.delta?.tool_calls ?? []) {
              yield {
                type: 'tool',
                data: {
                  index: tc.index ?? 0,
                  id: tc.id,
                  name: tc.function?.name,
                  delta: tc.function?.arguments ?? '',
                },
              };
            }
            if (choice?.finish_reason) {
              finishReason = choice.finish_reason;
              doneReceived = true;
            }
            if (parsed.usage) {
              const usage = this.parseUsage(parsed.usage);
              yield {
                type: 'usage',
                data: {
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                  totalTokens: usage.totalTokens,
                },
              };
            }
          }
        }
      }
      if (!started || !doneReceived) {
        throw new Error('Cloudflare Workers AI stream closed before [DONE] terminal marker');
      }
      yield { type: 'end', data: { id, finishReason } };
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  async embeddings(model: string, input: string[], signal: AbortSignal, lease?: ProviderLease) {
    const client = await this.clients.workersAi(lease);
    const openAiCompat = this.isOpenAiCompatUrl(client.baseUrl);
    const path = openAiCompat ? 'embeddings' : model;
    const body = openAiCompat ? { model, input } : { text: input };
    const response = await client.request(path, body, signal);
    if (!response.ok) {
      await response.body?.cancel();
      this.throwHttpFailure(response);
    }
    const payload = (await response.json()) as WorkersAiEnvelope & {
      data?: Array<{ index?: number; embedding?: number[] }>;
      usage?: { prompt_tokens?: number; total_tokens?: number };
    };
    const vectors = Array.isArray(payload.result?.data)
      ? payload.result!.data
      : Array.isArray(payload.data)
        ? payload.data.map((item) => item.embedding ?? [])
        : [];
    return {
      vectors,
      usage: {
        inputTokens: payload.result?.usage?.prompt_tokens ?? payload.usage?.prompt_tokens ?? null,
        outputTokens: 0,
        totalTokens: payload.result?.usage?.total_tokens ?? payload.usage?.total_tokens ?? null,
      },
    };
  }
}
