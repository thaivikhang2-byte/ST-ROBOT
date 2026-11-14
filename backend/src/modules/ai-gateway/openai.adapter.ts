import { Injectable } from '@nestjs/common';
import type {
  ResponseCreateParamsBase,
  ResponseInput,
  Response,
} from 'openai/resources/responses/responses';
import { ProviderClients } from './provider-clients';
import { AiChatDto } from './ai.dto';
import type { AiAdapter, AiResult, AiStreamEvent } from './ai.types';
import type { ProviderLease } from './provider-leases';

@Injectable()
export class OpenAiAdapter implements AiAdapter {
  constructor(private readonly clients: ProviderClients) {}
  private params(model: string, dto: AiChatDto): ResponseCreateParamsBase {
    const input: ResponseInput = [];
    for (const message of dto.messages) {
      if (message.role === 'tool') {
        input.push({
          type: 'function_call_output',
          call_id: message.toolCallId!,
          output: message.content,
        });
      } else {
        for (const context of message.providerContext ?? []) {
          input.push({
            type: 'reasoning',
            id: context.id!,
            summary: (context.summary ?? []).map((text) => ({ type: 'summary_text', text })),
            encrypted_content: context.encryptedContent!,
          });
        }
        if (message.content) input.push({ role: message.role, content: message.content });
        for (const call of message.toolCalls ?? [])
          input.push({
            type: 'function_call',
            call_id: call.id,
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          });
      }
    }
    return {
      model,
      input,
      store: false,
      max_output_tokens: dto.maxOutputTokens ?? 1024,
      ...(dto.structuredOutput
        ? {
            text: {
              format: {
                type: 'json_schema' as const,
                name: dto.structuredOutput.name,
                schema: dto.structuredOutput.schema,
                strict: true,
              },
            },
          }
        : {}),
      ...(dto.temperature !== undefined ? { temperature: dto.temperature } : {}),
      ...(dto.tools?.length
        ? {
            tools: dto.tools.map((tool) => ({
              type: 'function' as const,
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
              strict: false,
            })),
          }
        : {}),
    };
  }
  private result(response: Response): AiResult {
    if (!['completed', 'incomplete'].includes(response.status ?? ''))
      throw new Error('Provider response did not complete');
    return {
      id: response.id,
      text: response.output
        .filter((item) => item.type === 'message')
        .flatMap((item) =>
          item.content.filter((block) => block.type === 'output_text').map((block) => block.text),
        )
        .join(''),
      toolCalls: response.output
        .filter((item) => item.type === 'function_call')
        .map((item) => ({ id: item.call_id, name: item.name, arguments: item.arguments })),
      finishReason:
        response.status === 'incomplete'
          ? (response.incomplete_details?.reason ?? 'incomplete')
          : 'completed',
      usage: {
        totalTokens: response.usage?.total_tokens ?? null,
        inputTokens: response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null,
      },
      providerOutput: response.output,
    };
  }
  async chat(model: string, dto: AiChatDto, signal: AbortSignal, lease?: ProviderLease) {
    const client = await this.clients.openai(lease);
    return this.result(
      await client.responses.create({ ...this.params(model, dto), stream: false }, { signal }),
    );
  }
  async *stream(
    model: string,
    dto: AiChatDto,
    signal: AbortSignal,
    lease?: ProviderLease,
  ): AsyncGenerator<AiStreamEvent> {
    const client = await this.clients.openai(lease);
    const stream = await client.responses.create(
      { ...this.params(model, dto), stream: true },
      { signal },
    );
    let ended = false;
    try {
      for await (const event of stream) {
        if (event.type === 'response.created')
          yield { type: 'start', data: { id: event.response.id } };
        else if (event.type === 'response.output_text.delta')
          yield { type: 'text', data: { delta: event.delta, index: event.output_index } };
        else if (event.type === 'response.function_call_arguments.delta')
          yield {
            type: 'tool',
            data: { itemId: event.item_id, delta: event.delta, index: event.output_index },
          };
        else if (
          event.type === 'response.output_item.added' ||
          event.type === 'response.output_item.done'
        )
          yield {
            type: 'metadata',
            data: { event: event.type, index: event.output_index, item: event.item },
          };
        else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
          ended = true;
          yield {
            type: 'usage',
            data: {
              inputTokens: event.response.usage?.input_tokens ?? null,
              outputTokens: event.response.usage?.output_tokens ?? null,
              totalTokens: event.response.usage?.total_tokens ?? null,
            },
          };
          yield {
            type: 'end',
            data: {
              id: event.response.id,
              finishReason:
                event.type === 'response.incomplete'
                  ? (event.response.incomplete_details?.reason ?? 'incomplete')
                  : 'completed',
            },
          };
        } else if (event.type === 'error' || event.type === 'response.failed')
          throw new Error('Provider stream failed');
      }
      if (!ended) throw new Error('Provider stream closed before terminal event');
    } finally {
      stream.controller.abort();
    }
  }
  async embeddings(model: string, input: string[], signal: AbortSignal, lease?: ProviderLease) {
    const client = await this.clients.openai(lease);
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
