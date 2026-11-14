import { Injectable } from '@nestjs/common';
import type { Content, Part, GenerateContentResponse } from '@google/genai';
import { ProviderClients } from './provider-clients';
import type { ProviderLease } from './provider-leases';
import type { AiAdapter, AiResult, AiStreamEvent } from './ai.types';
import { AiChatDto } from './ai.dto';
import { randomUUID } from 'node:crypto';

// Synthetic IDs identify persisted gateway turns; they were not part of the
// signed provider Part and must not be added when replaying that Part.
function providerCallId(id?: string): string | undefined {
  return id && !/^gemini-call-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-\d+$/i.test(id)
    ? id : undefined;
}

@Injectable()
export class GeminiAdapter implements AiAdapter {
  constructor(private readonly clients: ProviderClients) {}
  private params(model: string, dto: AiChatDto, signal: AbortSignal) {
    const system: string[] = [],
      contents: Content[] = [],
      calls = new Map<string, string>();
    for (const message of dto.messages) {
      if (['system', 'developer'].includes(message.role)) {
        system.push(message.content);
        continue;
      }
      const parts: Part[] = [];
      if (message.role === 'tool') {
        let response: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(message.content);
          response =
            parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              ? (parsed as Record<string, unknown>)
              : { result: parsed };
        } catch {
          response = { result: message.content };
        }
        parts.push({
          functionResponse: {
            ...(providerCallId(message.toolCallId) ? { id: message.toolCallId } : {}),
            name: calls.get(message.toolCallId!)!,
            response,
          },
        });
      } else {
        if (message.content) parts.push({ text: message.content });
        for (const image of message.images ?? [])
          parts.push({ inlineData: { mimeType: image.mimeType, data: image.dataBase64 } });
        for (const call of message.toolCalls ?? []) {
          calls.set(call.id, call.name);
          const signature = message.providerContext?.find(
            (c) => c.type === 'gemini_thinking' && c.id === call.id,
          )?.signature;
          parts.push({
            functionCall: {
              ...(providerCallId(call.id) ? { id: call.id } : {}),
              name: call.name,
              args: call.arguments,
            },
            ...(signature ? { thoughtSignature: signature } : {}),
          });
        }
      }
      contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
    }
    return {
      model,
      contents,
      config: {
        abortSignal: signal,
        maxOutputTokens: dto.maxOutputTokens ?? 1024,
        ...(system.length ? { systemInstruction: system.join('\n\n') } : {}),
        ...(dto.temperature !== undefined ? { temperature: dto.temperature } : {}),
        ...(dto.tools?.length
          ? {
              tools: [
                {
                  functionDeclarations: dto.tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    parametersJsonSchema: t.parameters,
                  })),
                },
              ],
            }
          : {}),
        ...(dto.structuredOutput
          ? {
              responseMimeType: 'application/json',
              responseJsonSchema: dto.structuredOutput.schema,
            }
          : {}),
      },
    };
  }
  private usage(response: GenerateContentResponse) {
    const u = response.usageMetadata;
    return {
      inputTokens: u?.promptTokenCount ?? null,
      outputTokens:
        u?.candidatesTokenCount === undefined
          ? null
          : u.candidatesTokenCount + (u.thoughtsTokenCount ?? 0),
      totalTokens: u?.totalTokenCount ?? null,
    };
  }
  private result(response: GenerateContentResponse): AiResult {
    const c = response.candidates?.[0];
    if (!c?.finishReason) throw new Error('Gemini response missing terminal state');
    const parts = c.content?.parts ?? [];
    const functionParts = parts.filter((p) => p.functionCall);
    const turnId = randomUUID();
    const toolCalls = functionParts.map((p, i) => ({
      id: p.functionCall!.id ?? `gemini-call-${turnId}-${i}`,
      name: p.functionCall!.name!,
      arguments: p.functionCall!.args ?? {},
    }));
    const providerContext = functionParts.flatMap((part, i) => part.thoughtSignature
      ? [{ type: 'gemini_thinking' as const, id: toolCalls[i].id, signature: part.thoughtSignature }]
      : []);
    return {
      id: response.responseId ?? '',
      text: parts
        .filter((p) => !p.thought && p.text)
        .map((p) => p.text)
        .join(''),
      toolCalls,
      ...(providerContext.length ? { providerContext } : {}),
      finishReason: c.finishReason,
      usage: this.usage(response),
      providerOutput: response.candidates,
    };
  }
  async chat(model: string, dto: AiChatDto, signal: AbortSignal, lease?: ProviderLease) {
    const c = await this.clients.gemini(lease);
    return this.result(await c.models.generateContent(this.params(model, dto, signal)));
  }
  async *stream(
    model: string,
    dto: AiChatDto,
    signal: AbortSignal,
    lease?: ProviderLease,
  ): AsyncGenerator<AiStreamEvent> {
    const c = await this.clients.gemini(lease),
      stream = await c.models.generateContentStream(this.params(model, dto, signal));
    let reason = '',
      id = '';
    const streamTurnId = randomUUID();
    let toolIndex = 0;
    for await (const event of stream) {
      signal.throwIfAborted();
      if (!id && event.responseId) {
        id = event.responseId;
        yield { type: 'start', data: { id } };
      }
      const candidate = event.candidates?.[0];
      for (const part of candidate?.content?.parts ?? []) {
        if (part.text && !part.thought)
          yield { type: 'text', data: { delta: part.text, index: 0 } };
        if (part.functionCall)
          yield {
            type: 'tool',
            data: {
              id: part.functionCall.id ?? `gemini-call-${streamTurnId}-${toolIndex++}`,
              name: part.functionCall.name,
              arguments: part.functionCall.args,
              thoughtSignature: part.thoughtSignature,
            },
          };
      }
      if (candidate?.finishReason) reason = candidate.finishReason;
      if (event.usageMetadata) yield { type: 'usage', data: this.usage(event) };
    }
    if (!reason) throw new Error('Gemini stream is incomplete');
    yield { type: 'end', data: { id, finishReason: reason } };
  }
  async embeddings(model: string, input: string[], signal: AbortSignal, lease?: ProviderLease) {
    const c = await this.clients.gemini(lease),
      r = await c.models.embedContent({ model, contents: input, config: { abortSignal: signal } });
    return {
      vectors: (r.embeddings ?? []).map((e) => e.values ?? []),
      usage: { inputTokens: null, outputTokens: 0, totalTokens: null },
    };
  }
}
