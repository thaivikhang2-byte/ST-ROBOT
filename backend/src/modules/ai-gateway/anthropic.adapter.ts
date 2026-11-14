import { Injectable } from '@nestjs/common';
import type {
  MessageCreateParamsBase,
  MessageParam,
  Message,
  ContentBlockParam,
} from '@anthropic-ai/sdk/resources/messages/messages';
import { ProviderClients } from './provider-clients';
import type { ProviderLease } from './provider-leases';
import { AiChatDto } from './ai.dto';
import type { AiAdapter, AiResult, AiStreamEvent, AiUsage } from './ai.types';

@Injectable()
export class AnthropicAdapter implements AiAdapter {
  constructor(private readonly clients: ProviderClients) {}
  private params(model: string, dto: AiChatDto): MessageCreateParamsBase {
    const messages: MessageParam[] = [];
    const system: string[] = [];
    for (const message of dto.messages) {
      if (message.role === 'system' || message.role === 'developer') {
        system.push(message.content);
        continue;
      }
      if (message.role === 'tool') {
        messages.push({
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: message.toolCallId!, content: message.content },
          ],
        });
        continue;
      }
      const content: ContentBlockParam[] = [];
      for (const context of message.providerContext ?? []) {
        if (context.type === 'anthropic_thinking')
          content.push({
            type: 'thinking',
            thinking: context.thinking!,
            signature: context.signature!,
          });
        else if (context.type === 'anthropic_redacted')
          content.push({ type: 'redacted_thinking', data: context.data! });
      }
      if (message.content) content.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls ?? [])
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
      messages.push({ role: message.role, content });
    }
    return {
      model,
      messages,
      max_tokens: dto.maxOutputTokens ?? 1024,
      ...(dto.structuredOutput
        ? {
            output_config: {
              format: { type: 'json_schema' as const, schema: dto.structuredOutput.schema },
            },
          }
        : {}),
      ...(system.length ? { system: system.join('\n\n') } : {}),
      ...(dto.temperature !== undefined ? { temperature: dto.temperature } : {}),
      ...(dto.tools?.length
        ? {
            tools: dto.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: { ...tool.parameters, type: 'object' as const },
            })),
          }
        : {}),
    };
  }
  private usage(message: Message): AiUsage {
    return {
      inputTokens: message.usage
        ? message.usage.input_tokens +
          (message.usage.cache_creation_input_tokens ?? 0) +
          (message.usage.cache_read_input_tokens ?? 0)
        : null,
      outputTokens: message.usage?.output_tokens ?? null,
    };
  }
  async chat(
    model: string,
    dto: AiChatDto,
    signal: AbortSignal,
    lease?: ProviderLease,
  ): Promise<AiResult> {
    const client = await this.clients.anthropic(lease);
    const response = await client.messages.create(
      { ...this.params(model, dto), stream: false },
      { signal },
    );
    if (!response.stop_reason)
      throw new Error('Provider message is missing its terminal stop reason');
    return {
      id: response.id,
      text: response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join(''),
      toolCalls: response.content
        .filter((block) => block.type === 'tool_use')
        .map((block) => ({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        })),
      finishReason: response.stop_reason ?? 'unknown',
      usage: this.usage(response),
      providerOutput: response.content,
    };
  }
  async *stream(
    model: string,
    dto: AiChatDto,
    signal: AbortSignal,
    lease?: ProviderLease,
  ): AsyncGenerator<AiStreamEvent> {
    const client = await this.clients.anthropic(lease);
    const stream = await client.messages.create(
      { ...this.params(model, dto), stream: true },
      { signal },
    );
    let id: string | undefined;
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let reason: string | null = null;
    let uncachedInput: number | null = null;
    let cacheWrite = 0;
    let cacheRead = 0;
    let ended = false;
    try {
      for await (const event of stream) {
        if (event.type === 'message_start') {
          id = event.message.id;
          inputTokens = this.usage(event.message).inputTokens;
          uncachedInput = event.message.usage?.input_tokens ?? null;
          cacheWrite = event.message.usage?.cache_creation_input_tokens ?? 0;
          cacheRead = event.message.usage?.cache_read_input_tokens ?? 0;
          yield { type: 'start', data: { id } };
        } else if (event.type === 'content_block_start')
          yield { type: 'metadata', data: { index: event.index, block: event.content_block } };
        else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta')
            yield { type: 'text', data: { delta: event.delta.text, index: event.index } };
          else if (event.delta.type === 'input_json_delta')
            yield { type: 'tool', data: { delta: event.delta.partial_json, index: event.index } };
          else yield { type: 'metadata', data: { index: event.index, delta: event.delta } };
        } else if (event.type === 'message_delta') {
          outputTokens = event.usage.output_tokens;
          uncachedInput = event.usage.input_tokens ?? uncachedInput;
          cacheWrite = event.usage.cache_creation_input_tokens ?? cacheWrite;
          cacheRead = event.usage.cache_read_input_tokens ?? cacheRead;
          inputTokens = uncachedInput === null ? null : uncachedInput + cacheWrite + cacheRead;
          reason = event.delta.stop_reason;
        } else if (event.type === 'message_stop') {
          if (!id || !reason) throw new Error('Provider stream missing completion state');
          ended = true;
          yield { type: 'usage', data: { inputTokens, outputTokens } };
          yield { type: 'end', data: { id, finishReason: reason } };
        }
      }
      if (!ended) throw new Error('Provider stream closed before terminal event');
    } finally {
      stream.controller.abort();
    }
  }
}
