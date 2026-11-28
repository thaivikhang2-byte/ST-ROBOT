import { Prisma } from '@prisma/client';
import { economyHistory, economyLessonContext } from './agent-economy';
import { AiModelRouterService } from '../routing/ai-model-router.service';
import type { AiMessageDto } from '../ai.dto';

describe('Economical agent context without paid model calls', () => {
  it('keeps the current request and two complete prior turns, preserving exact tool signatures', () => {
    const exchange: AiMessageDto[] = [{ role: 'user', content: 'Prior question' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'signed', name: 'learning_search_courses', arguments: {} }],
        providerContext: [{ type: 'gemini_thinking', id: 'signed', signature: 'opaque-original-signature' }] },
      { role: 'tool', content: '{"courses":[]}', toolCallId: 'signed' }, { role: 'assistant', content: 'Answer' }];
    const history: AiMessageDto[] = [{ role: 'user', content: 'Oldest' }, { role: 'assistant', content: 'Old answer' },
      ...exchange, { role: 'user', content: 'Recent question' }, { role: 'assistant', content: 'Recent answer' },
      { role: 'user', content: 'Current question' }];
    const limited = economyHistory(history);
    expect(limited.omittedTurns).toBe(1);
    expect(limited.messages.slice(0, 4)).toEqual(exchange);
    expect(limited.messages.at(-1)?.content).toBe('Current question');
    expect(history[0].content).toBe('Oldest');
  });

  it('omits oversized old tool exchanges atomically rather than clipping JSON or signed blocks', () => {
    const history: AiMessageDto[] = [{ role: 'user', content: 'Old question' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'large', name: 'tool', arguments: {} }] },
      { role: 'tool', content: JSON.stringify({ note: 'ệ'.repeat(5000) }), toolCallId: 'large' },
      { role: 'user', content: 'Keep this request exactly' }];
    expect(economyHistory(history)).toEqual({ messages: [history[3]], omittedTurns: 1 });
  });

  it('retains selected saved work while compacting all-course status and histories', () => {
    const value = { lessonSlug: 'led', source: 'curriculum', code: 'lesson code', ownLearning: {
      source: 'owned-account', hasSnapshot: true, revision: 3, overview: 'duplicate overview',
      courses: [{ courseSlug: 'arduino', summary: { completed: 1, total: 6 }, lessons: [
        { lessonSlug: 'led', labWork: { code: 'my selected code', notes: 'my notes' } },
        { lessonSlug: 'timing', note: 'other lesson details' }] }],
      recentActivities: ['large old activity'], practiceHistory: ['old practice'], project: { code: 'my project' },
    } };
    const compact = economyLessonContext(value);
    expect(JSON.stringify(compact)).toMatch(/my selected code|my notes/);
    expect(JSON.stringify(compact)).not.toMatch(/large old activity|other lesson details|duplicate overview/);
    expect(value.ownLearning.courses[0].lessons).toHaveLength(2);
  });

  it('uses both confirmed input/output prices and preserves the configured provider in economy mode', async () => {
    const model = (id: string, input: number, output: number, provider = 'woku') => ({
      id, provider_id: provider, capabilities: ['chat', 'tools'], allowed_tools: ['learning_search_courses'],
      input_price: new Prisma.Decimal(input), output_price: new Prisma.Decimal(output),
      pricing_version: 'operator-confirmed:fixture', is_default: id === 'default', context_tokens: 65536,
    });
    const router = new AiModelRouterService({ aiModel: { findMany: jest.fn().mockResolvedValue([
      model('default', 0.1, 100), model('economical', 0.2, 0.3), model('other-provider', 0, 0, 'other'),
    ]) } } as never);
    const result = await router.route({ message: 'So sánh hai cách điều khiển', mode: 'EDUCATIONAL',
      hasActiveTools: true, hasPremiumPermission: false, preferEconomy: true });
    expect(result.selectedModelId).toBe('economical');
    expect(result.selectedProviderId).toBe('woku');
    expect((await router.route({ message: 'Question', mode: 'EDUCATIONAL', explicitModelId: 'default',
      hasActiveTools: true, hasPremiumPermission: false, preferEconomy: true })).selectedModelId).toBe('default');
  });
});
