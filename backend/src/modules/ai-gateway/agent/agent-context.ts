import { createHash } from 'node:crypto';
import type { AiMessageDto } from '../ai.dto';

/** Include every personalized input; roles alone do not identify a cache owner. */
export function agentCachePartition(
  authorizationPartition: string,
  ownerId: string,
  memories: unknown[],
  lessonContext?: unknown,
): string {
  const context = createHash('sha256')
    .update(JSON.stringify({ ownerId, memories, lessonContext: lessonContext ?? null }))
    .digest('hex');
  return `${authorizationPartition}:${context}`;
}

export interface AgentHistoryRow {
  role: string;
  content: string;
  tool_calls: unknown;
  tool_call_id: string | null;
}

type StoredAgentToolCall = NonNullable<AiMessageDto['toolCalls']>[number] & {
  providerContext?: AiMessageDto['providerContext'];
};

/** Keep the existing JSON call array shape; context stays server-owned metadata. */
export function storedAgentToolCalls(
  calls: NonNullable<AiMessageDto['toolCalls']>,
  providerContext?: AiMessageDto['providerContext'],
): StoredAgentToolCall[] {
  return calls.map((call, index) => ({
    ...call,
    ...(index === 0 && providerContext?.length ? { providerContext } : {}),
  }));
}

/** Recover a bounded history after a truncated window or an interrupted tool turn. */
export function agentHistoryMessages(rows: AgentHistoryRow[]): AiMessageDto[] {
  const firstUser = rows.findIndex((row) => row.role === 'user');
  if (firstUser < 0) return [];
  const messages: AiMessageDto[] = [];
  for (let i = firstUser; i < rows.length; i++) {
    const row = rows[i];
    if (row.role === 'user') {
      if (row.content.trim()) messages.push({ role: 'user', content: row.content });
      continue;
    }
    if (row.role !== 'assistant') continue;
    const storedCalls = Array.isArray(row.tool_calls)
      ? (row.tool_calls as StoredAgentToolCall[])
      : [];
    const calls = storedCalls.map(({ providerContext: _, ...call }) => call);
    const providerContext = storedCalls.flatMap((call) => call.providerContext ?? []);
    if (!calls.length) {
      if (row.content.trim()) messages.push({ role: 'assistant', content: row.content });
      continue;
    }
    const pending = new Set(calls.map((call) => call.id));
    const results: AiMessageDto[] = [];
    let j = i + 1;
    while (j < rows.length && rows[j].role === 'tool') {
      const result = rows[j++];
      if (result.tool_call_id && pending.delete(result.tool_call_id)) {
        results.push({ role: 'tool', content: result.content, toolCallId: result.tool_call_id });
      }
    }
    // An aborted request may have persisted only some results. Drop that entire group.
    if (!pending.size && results.length === calls.length) {
      messages.push({
        role: 'assistant', content: row.content, toolCalls: calls,
        ...(providerContext.length ? { providerContext } : {}),
      }, ...results);
    }
    i = j - 1;
  }
  return messages;
}
