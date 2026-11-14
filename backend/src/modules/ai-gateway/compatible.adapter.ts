import { Injectable } from '@nestjs/common';
import type {
  ChatCompletionMessageParam,
  ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions';
import { ProviderClients } from './provider-clients';
import type { ProviderLease } from './provider-leases';
import type { AiAdapter, AiResult, AiStreamEvent } from './ai.types';
import { AiChatDto } from './ai.dto';
@Injectable()
export class CompatibleAdapter implements AiAdapter {
  constructor(private readonly clients: ProviderClients) {}
  private params(model: string, dto: AiChatDto): ChatCompletionCreateParamsNonStreaming {
    const messages: ChatCompletionMessageParam[] = dto.messages.map((m) => {
      if (m.role === 'tool')
        return { role: 'tool', content: m.content, tool_call_id: m.toolCallId! };
      if (m.role === 'assistant')
        return {
          role: 'assistant',
          content: m.content || null,
          ...(m.toolCalls?.length
            ? {
                tool_calls: m.toolCalls.map((c) => ({
                  id: c.id,
                  type: 'function' as const,
                  function: { name: c.name, arguments: JSON.stringify(c.arguments) },
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
  async chat(
    model: string,
    dto: AiChatDto,
    signal: AbortSignal,
    lease?: ProviderLease,
  ): Promise<AiResult> {
    const client = await this.clients.openai(lease),
      result = await client.chat.completions.create(this.params(model, dto), { signal });
    const choice = result.choices[0];
    if (!choice?.finish_reason)
      throw new Error('Compatible provider completion is missing terminal state');
    return {
      id: result.id,
      text: choice.message.content ?? '',
      toolCalls: (choice.message.tool_calls ?? [])
        .filter((c) => c.type === 'function')
        .map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments })),
      finishReason: choice.finish_reason,
      usage: {
        inputTokens: result.usage?.prompt_tokens ?? null,
        outputTokens: result.usage?.completion_tokens ?? null,
        totalTokens: result.usage?.total_tokens ?? null,
      },
      providerOutput: choice.message,
    };
  }
  async *stream(
    model: string,
    dto: AiChatDto,
    signal: AbortSignal,
    lease?: ProviderLease,
  ): AsyncGenerator<AiStreamEvent> {
    const client = await this.clients.openai(lease),
      stream = await client.chat.completions.create(
        { ...this.params(model, dto), stream: true, stream_options: { include_usage: true } },
        { signal },
      );
    let id = '',
      reason: string | null = null;
    try {
      for await (const event of stream) {
        if (!id) {
          id = event.id;
          yield { type: 'start', data: { id } };
        }
        const choice = event.choices[0];
        if (choice?.delta.content)
          yield { type: 'text', data: { delta: choice.delta.content, index: 0 } };
        for (const call of choice?.delta.tool_calls ?? [])
          yield {
            type: 'tool',
            data: {
              index: call.index,
              id: call.id,
              name: call.function?.name,
              delta: call.function?.arguments ?? '',
            },
          };
        if (choice?.finish_reason) reason = choice.finish_reason;
        if (event.usage)
          yield {
            type: 'usage',
            data: {
              inputTokens: event.usage.prompt_tokens,
              outputTokens: event.usage.completion_tokens,
              totalTokens: event.usage.total_tokens,
            },
          };
      }
      if (!id || !reason) throw new Error('Compatible provider stream is incomplete');
      yield { type: 'end', data: { id, finishReason: reason } };
    } finally {
      stream.controller.abort();
    }
  }
  async embeddings(model: string, input: string[], signal: AbortSignal, lease?: ProviderLease) {
    const client = await this.clients.openai(lease),
      response = await client.embeddings.create(
        { model, input, encoding_format: 'float' },
        { signal },
      );
    return {
      vectors: response.data.sort((a, b) => a.index - b.index).map((v) => v.embedding),
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? null,
        outputTokens: 0,
        totalTokens: response.usage?.total_tokens ?? null,
      },
    };
  }
}
