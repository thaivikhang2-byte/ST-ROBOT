import { AiCacheService, type CacheKeyContext } from '../cache/ai-cache.service';
import { agentCachePartition, agentHistoryMessages, type AgentHistoryRow } from './agent-context';

describe('Agent personalized response cache', () => {
  const base: CacheKeyContext = {
    question: 'Giải thích vòng lặp lập trình',
    mode: 'EDUCATIONAL',
    promptVersion: 'test',
    routeVersion: 'test',
    modelId: 'model-one',
    language: 'vi',
    knowledgeVersion: 'test',
    authPartition: '',
    contextScope: 'lesson-one',
  };

  it('never serves another learner’s personalized answer despite identical permissions and question', async () => {
    const cache = new AiCacheService();
    const authorization = cache.buildAuthPartition('EDUCATIONAL', ['learning:read']);
    const original = { ...base, authPartition: agentCachePartition(authorization, 'learner-a', ['Prefer examples about robots']) };
    await cache.store(original, {
      answer: 'Personalized robotics explanation', citations: [], lane: 'FAST_LANE',
      model: 'one', provider: 'test', hasToolsExecuted: false, isMutation: false,
    });
    expect((await cache.lookup(original)).hit).toBe(true);
    expect((await cache.lookup({
      ...original,
      authPartition: agentCachePartition(authorization, 'learner-b', ['Prefer examples about robots']),
    })).hit).toBe(false);
    expect((await cache.lookup({
      ...original,
      authPartition: agentCachePartition(authorization, 'learner-a', []),
    })).hit).toBe(false); // Revoking saved preferences invalidates personalized responses.
  });

  it('isolates changed lesson context and an explicitly selected model in semantic lookup', async () => {
    const cache = new AiCacheService();
    const original = { ...base, authPartition: agentCachePartition('same-role', 'learner', [], { content: 'Old lesson' }) };
    await cache.store(original, {
      answer: 'Original answer', citations: [], lane: 'FAST_LANE', model: 'one',
      provider: 'test', hasToolsExecuted: false, isMutation: false,
    });
    expect((await cache.lookup({ ...original, modelId: 'model-two' })).hit).toBe(false);
    expect((await cache.lookup({
      ...original,
      authPartition: agentCachePartition('same-role', 'learner', [], { content: 'Updated lesson' }),
    })).hit).toBe(false);
  });
});

describe('Recovering persisted agent history', () => {
  const row = (role: string, content: string, extra: Partial<AgentHistoryRow> = {}): AgentHistoryRow => ({
    role, content, tool_calls: null, tool_call_id: null, ...extra,
  });
  const calls = [
    { id: 'call-one', name: 'learning_search_courses', arguments: { query: 'robot' } },
    { id: 'call-two', name: 'learning_get_own_progress', arguments: {} },
  ];

  it('drops orphan results and unfinished tool turns while retaining the next user request', () => {
    const messages = agentHistoryMessages([
      row('tool', 'Old truncated result', { tool_call_id: 'old' }),
      row('assistant', 'Old truncated answer'),
      row('user', 'First request'),
      row('assistant', '', { tool_calls: calls }),
      row('tool', 'Partial result', { tool_call_id: 'call-one' }),
      row('user', 'Retry after disconnect'),
    ]);
    expect(messages).toEqual([
      { role: 'user', content: 'First request' },
      { role: 'user', content: 'Retry after disconnect' },
    ]);
  });

  it('preserves a completed tool exchange', () => {
    const messages = agentHistoryMessages([
      row('user', 'Request'),
      row('assistant', '', { tool_calls: calls }),
      row('tool', 'Courses', { tool_call_id: 'call-one' }),
      row('tool', 'Progress', { tool_call_id: 'call-two' }),
      row('assistant', 'Answer'),
      row('user', 'Follow-up'),
    ]);
    expect(messages).toHaveLength(6);
    expect(messages[1].toolCalls).toEqual(calls);
    expect(messages[2].toolCallId).toBe('call-one');
    expect(messages[3].toolCallId).toBe('call-two');
  });
});
