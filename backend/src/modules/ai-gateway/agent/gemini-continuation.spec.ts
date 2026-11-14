import { ConfigService } from '@nestjs/config';
import type { RequestUser } from '../../../shared/sdk';
import { GeminiAdapter } from '../gemini.adapter';
import { AiGatewayService } from '../ai-gateway.service';
import type { ProviderClients } from '../provider-clients';
import type { AiMessageDto } from '../ai.dto';
import { AgentToolRegistry } from './agent-tool-registry';
import { AiAgentService } from './ai-agent.service';
import { type AgentHistoryRow } from './agent-context';

function harness() {
  const generateContent = jest.fn();
  const clients = {
    gemini: jest.fn().mockResolvedValue({ models: { generateContent } }),
    acquire: jest.fn().mockResolvedValue(undefined),
    finish: jest.fn().mockResolvedValue(undefined),
  };
  const adapter = new GeminiAdapter(clients as unknown as ProviderClients);
  const user = { id: 'learner', permissions: ['ai:chat'], isActive: true, isEmailVerified: true } as RequestUser;
  const model = {
    id: 'model', provider_id: 'gemini', providerType: 'gemini', model_id: 'gemini-test',
    capabilities: ['chat', 'tools', 'reasoning_context'],
    allowed_tools: ['learning_search_courses'], max_input_tokens: 100000,
    max_output_tokens: 2000, context_tokens: 120000,
  };
  const gateway = Object.create(AiGatewayService.prototype) as AiGatewayService;
  Object.assign(gateway, {
    prisma: { featureFlag: { findUnique: jest.fn().mockResolvedValue({ is_enabled: true }) } },
    config: new ConfigService({ AI_GATEWAY_ENABLED: true, AI_MAX_APPLICATION_ATTEMPTS: 1 }),
    registry: { select: jest.fn().mockResolvedValue(model) },
    quota: { reserve: jest.fn().mockResolvedValue({ id: 'request' }), finish: jest.fn().mockResolvedValue(undefined) },
    gemini: adapter, clients,
  });
  const firstRows: AgentHistoryRow[] = [{ role: 'user', content: 'Find a robotics course', tool_calls: null, tool_call_id: null }];
  const beginTurn = jest.fn().mockResolvedValue({ conversation: { id: 'conversation' }, runId: 'run', rows: firstRows });
  const persistAssistant = jest.fn().mockResolvedValue(undefined);
  const agent = Object.create(AiAgentService.prototype) as AiAgentService;
  Object.assign(agent, {
    db: {
      aiModel: { findFirst: jest.fn().mockResolvedValue(model) },
      authorizationState: { findUnique: jest.fn().mockResolvedValue({ version: 0 }) },
      aiConversation: {
        findFirst: jest.fn().mockResolvedValue({ mode: 'PERSONAL', resource_scope: null }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    },
    gateway, tools: new AgentToolRegistry(),
    actor: jest.fn().mockResolvedValue({ ...user, currentPermissions: user.permissions }),
    authorizeMode: jest.fn().mockResolvedValue(undefined),
    prepareLessonContext: jest.fn().mockResolvedValue(undefined),
    beginTurn, approvedMemories: jest.fn().mockResolvedValue([]),
    actionsEnabled: jest.fn().mockResolvedValue(false), persistAssistant,
    persistToolResult: jest.fn().mockImplementation(async (_conversation, _run, _call, result) => JSON.stringify(result)),
    educational: { handles: jest.fn().mockReturnValue(false) },
    courses: { findPublished: jest.fn().mockResolvedValue({ courses: ['Arduino'] }) },
    audit: jest.fn().mockResolvedValue(undefined),
    logger: { event: jest.fn() },
    metrics: { agentTools: { inc: jest.fn() }, agentRuns: { inc: jest.fn() }, agentDuration: { observe: jest.fn() } },
  });
  return { agent, gateway, user, beginTurn, persistAssistant, generateContent, firstRows };
}

describe('Gemini agent tool continuations', () => {
  it('replays provider call IDs on both sides of parallel same-name tool exchanges', async () => {
    const { agent, user, generateContent } = harness();
    generateContent.mockResolvedValueOnce({
      candidates: [{ finishReason: 'STOP', content: { parts: [
        {
          functionCall: { id: 'provider-first', name: 'learning_search_courses', args: { query: 'arduino' } },
          thoughtSignature: 'signature-first',
        },
        {
          functionCall: { id: 'provider-second', name: 'learning_search_courses', args: { query: 'microbit' } },
          thoughtSignature: 'signature-second',
        },
      ] } }],
    }).mockResolvedValueOnce({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Both courses are available' }] } }],
    });

    await expect(agent.chat(user, { mode: 'PERSONAL', message: 'Compare two robotics courses' }))
      .resolves.toMatchObject({ message: 'Both courses are available' });
    const replay = generateContent.mock.calls[1][0].contents
      .flatMap((content: { parts: unknown[] }) => content.parts);
    expect(replay).toEqual(expect.arrayContaining([
      expect.objectContaining({
        functionCall: expect.objectContaining({ id: 'provider-first', name: 'learning_search_courses' }),
        thoughtSignature: 'signature-first',
      }),
      expect.objectContaining({
        functionCall: expect.objectContaining({ id: 'provider-second', name: 'learning_search_courses' }),
        thoughtSignature: 'signature-second',
      }),
      expect.objectContaining({ functionResponse: expect.objectContaining({ id: 'provider-first', name: 'learning_search_courses' }) }),
      expect.objectContaining({ functionResponse: expect.objectContaining({ id: 'provider-second', name: 'learning_search_courses' }) }),
    ]));
  });

  it('keeps unique missing IDs and exact signatures through multiple tool rounds and a restored conversation', async () => {
    const { agent, user, beginTurn, persistAssistant, generateContent, firstRows } = harness();
    const toolReply = (signature: string) => ({
      // Even a repeated/missing response ID must not cause duplicate internal tool IDs.
      responseId: 'same-provider-response-id',
      candidates: [{ finishReason: 'STOP', content: { parts: [{
        functionCall: { name: 'learning_search_courses', args: { query: 'robot' } },
        thoughtSignature: signature,
      }] } }],
    });
    const answer = (text: string) => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] });
    generateContent.mockResolvedValueOnce(toolReply('opaque-signature-one'))
      .mockResolvedValueOnce(toolReply('opaque-signature-two'))
      .mockResolvedValueOnce(answer('Arduino is available'))
      .mockResolvedValueOnce(answer('Here is your follow-up'));

    const response = await agent.chat(user, { mode: 'PERSONAL', message: 'Find a robotics course' });
    expect(response.message).toBe('Arduino is available');
    const firstCall = persistAssistant.mock.calls[0][3][0];
    const secondCall = persistAssistant.mock.calls[1][3][0];
    expect(firstCall.id).not.toBe(secondCall.id);
    expect(firstCall.providerContext).toEqual([{ type: 'gemini_thinking', id: firstCall.id, signature: 'opaque-signature-one' }]);
    expect(secondCall.providerContext).toEqual([{ type: 'gemini_thinking', id: secondCall.id, signature: 'opaque-signature-two' }]);
    const sentThird = generateContent.mock.calls[2][0].contents.flatMap((content: { parts: unknown[] }) => content.parts);
    expect(sentThird).toEqual(expect.arrayContaining([
      expect.objectContaining({ thoughtSignature: 'opaque-signature-one' }),
      expect.objectContaining({ thoughtSignature: 'opaque-signature-two' }),
    ]));
    // Do not alter the provider's signed Parts by inserting our internal IDs.
    for (const part of sentThird) {
      if (part.functionCall) expect(part.functionCall).not.toHaveProperty('id');
      if (part.functionResponse) expect(part.functionResponse).not.toHaveProperty('id');
    }

    // Reload the server-stored JSON call arrays, as beginTurn does on the next request.
    const rows: AgentHistoryRow[] = [...firstRows];
    for (const call of [firstCall, secondCall]) {
      rows.push({ role: 'assistant', content: '', tool_calls: [call], tool_call_id: null });
      rows.push({ role: 'tool', content: '{"courses":["Arduino"]}', tool_calls: null, tool_call_id: call.id });
    }
    rows.push({ role: 'assistant', content: 'Arduino is available', tool_calls: null, tool_call_id: null });
    rows.push({ role: 'user', content: 'Tell me more', tool_calls: null, tool_call_id: null });
    beginTurn.mockResolvedValueOnce({ conversation: { id: 'conversation' }, runId: 'next-run', rows });
    const next = await agent.chat(user, { mode: 'PERSONAL', message: 'Tell me more', conversationId: 'conversation' });
    expect(next.message).toBe('Here is your follow-up');
    const sentRestored = generateContent.mock.calls[3][0].contents.flatMap((content: { parts: unknown[] }) => content.parts);
    expect(sentRestored).toEqual(expect.arrayContaining([
      expect.objectContaining({ thoughtSignature: 'opaque-signature-one' }),
      expect.objectContaining({ thoughtSignature: 'opaque-signature-two' }),
    ]));
  });

  it('still rejects a signed context whose ID does not match an offered assistant call', async () => {
    const { gateway, user, generateContent } = harness();
    const messages: AiMessageDto[] = [
      { role: 'user', content: 'Find a course' },
      { role: 'assistant', content: '',
        toolCalls: [{ id: 'real-call', name: 'learning_search_courses', arguments: { query: 'robot' } }],
        providerContext: [{ type: 'gemini_thinking', id: 'unmatched-call', signature: 'opaque' }] },
      { role: 'tool', content: '{}', toolCallId: 'real-call' },
    ];
    await expect(gateway.chat(user, { messages }, undefined, false, true)).rejects.toThrow('Invalid Gemini thought signature');
    expect(generateContent).not.toHaveBeenCalled();
  });
});
