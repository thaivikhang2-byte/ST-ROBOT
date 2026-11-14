import type { AiChatDto, AiMessageDto } from './ai.dto';
import type { ProviderLease } from './provider-leases';
export interface AiUsage {
  totalTokens?: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd?: number | string | null;
  reasoningTokens?: number | null;
}
export interface AiResult {
  id: string;
  text: string;
  toolCalls: { id: string; name: string; arguments: string | Record<string, unknown> }[];
  finishReason: string;
  usage: AiUsage;
  resolvedModel?: string;
  // Provider output blocks preserve tool IDs and provider-specific metadata for clients.
  providerOutput: unknown;
  // Opaque provider-issued context required to replay signed tool continuations.
  providerContext?: AiMessageDto['providerContext'];
}
export interface AiStreamEvent {
  type: 'start' | 'text' | 'tool' | 'metadata' | 'usage' | 'end';
  data: Record<string, unknown>;
}
export interface AiAdapter {
  chat(
    model: string,
    dto: AiChatDto,
    signal: AbortSignal,
    lease?: ProviderLease,
  ): Promise<AiResult>;
  stream(
    model: string,
    dto: AiChatDto,
    signal: AbortSignal,
    lease?: ProviderLease,
  ): AsyncGenerator<AiStreamEvent>;
  embeddings?(
    model: string,
    input: string[],
    signal: AbortSignal,
    lease?: ProviderLease,
  ): Promise<{ vectors: number[][]; usage: AiUsage }>;
}
