import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import type { RequestUser } from '../../../shared/sdk';
import { ErrorCode } from '../../../shared/sdk/errors/error-codes.enum';
import { AiGatewayService } from '../ai-gateway.service';
import type { AiChatDto } from '../ai.dto';
import { SystemPromptRegistryService } from '../prompts/system-prompt-registry.service';
import { AiAgentService } from './ai-agent.service';
import { AgentToolRegistry } from './agent-tool-registry';

interface Course {
  id: string;
  lessons: Array<{ id: string }>;
}

// Exercise the same public tool allowlist that the setup form registers, rather
// than silently constructing a smaller synthetic request for these tests.
const setupSource = readFileSync(
  resolve(process.cwd(), '../frontend/src/modules/account/AiAdminSetup.js'), 'utf8',
);
const toolSection = setupSource.match(/AI_SETUP_TOOLS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/);
if (!toolSection) throw new Error('The setup tool allowlist could not be read');
const allowedTools = [...toolSection[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
const courses = JSON.parse(readFileSync(
  resolve(process.cwd(), 'prisma/content/strobot-catalog.json'), 'utf8',
)) as Course[];
const registry = new AgentToolRegistry();
const permissions = [...new Set(registry.all().flatMap(tool => tool.requiredPermissions))];
const user = { id: 'tutor-budget-fixture', permissions } as RequestUser;
const tools = registry.asProviderTools(registry.available('EDUCATIONAL', permissions)
  .filter(tool => allowedTools.includes(tool.name)));
const prompts = new SystemPromptRegistryService();

function savedValues(withNotes: boolean) {
  if (!withNotes) return {};
  const state = Object.fromEntries(courses.map(course => [course.id,
    Object.fromEntries(course.lessons.map(lesson => [lesson.id, {
      done: true,
      note: 'Tôi thay đổi thông số, ghi lại quan sát rồi so sánh kết quả mô phỏng. '.repeat(10),
      prediction: 'Tôi dự đoán đầu ra thay đổi theo giá trị đầu vào.',
      observation: 'Đã quan sát mô hình thực hành và ghi lại kết quả.',
      explanation: 'Tôi đối chiếu với lý thuyết và thử điều chỉnh một thông số khác.',
    }]))]));
  return { 'strobot.original.course.v3': JSON.stringify(state) };
}

async function request(courseSlug?: string, lessonSlug?: string, withNotes = false): Promise<AiChatDto> {
  const values = savedValues(withNotes);
  const db = {
    learnerState: { findUnique: jest.fn().mockResolvedValue(withNotes ? {
      values, summary: { courses: [] }, revision: 1, updated_at: new Date(0),
    } : null) },
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const prepare = AiAgentService.prototype as unknown as {
    prepareLessonContext: (actor: RequestUser, dto: Record<string, unknown>) => Promise<unknown>;
  };
  const lessonContext = await prepare.prepareLessonContext.call({ db, actor: async () => user }, user, {
    mode: 'EDUCATIONAL',
    ...(courseSlug ? { courseSlug, lessonSlug, selectedPlatformKey: 'local' } : {}),
    learningLevel: 'beginner',
  });
  return {
    messages: [
      { role: 'system', content: prompts.compileSystemInstruction('EDUCATIONAL', { lessonContext }).content },
      { role: 'user', content: 'Giải thích bài này và gợi ý cách thực hành trong phòng lab.' },
    ],
    tools, maxOutputTokens: 1200,
  };
}

function gateway(limits = { input: 32768, output: 2048, context: 65536 }) {
  const model = {
    id: 'registered-budget-model', provider_id: 'fixture-provider', model_id: 'fixture-upstream',
    providerType: 'gemini', capabilities: ['chat', 'tools'], allowed_tools: allowedTools,
    max_input_tokens: limits.input, max_output_tokens: limits.output, context_tokens: limits.context,
  };
  const provider = { chat: jest.fn().mockResolvedValue({
    id: 'fixture-response', text: 'Fixture response after admission.', toolCalls: [],
    finishReason: 'stop', providerOutput: null,
    usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
  }) };
  const clients = { acquire: jest.fn().mockResolvedValue({ id: 'fixture-lease' }),
    finish: jest.fn().mockResolvedValue(undefined) };
  const quota = { reserve: jest.fn().mockResolvedValue({ id: 'fixture-usage' }),
    finish: jest.fn().mockResolvedValue(undefined) };
  const service = new AiGatewayService(
    { featureFlag: { findUnique: jest.fn().mockResolvedValue({ is_enabled: true }) } } as never,
    new ConfigService({ AI_GATEWAY_ENABLED: true }),
    { select: jest.fn().mockResolvedValue(model) } as never,
    quota as never, {} as never, {} as never, provider as never, {} as never, clients as never,
  );
  return { service, provider, clients, quota };
}

describe('Real authored tutor requests and explicitly registered model budgets', () => {
  it('reproduces the former setup budget rejecting a normal lesson before contacting a provider', async () => {
    const fixture = gateway({ input: 6000, output: 2048, context: 8192 });
    await expect(fixture.service.chat(user, await request('arduino', 'led'), undefined, false, true))
      .rejects.toMatchObject({
        code: ErrorCode.AI_REQUEST_LIMIT_EXCEEDED,
        message: 'Request exceeds configured model token limits',
      });
    expect(fixture.clients.acquire).not.toHaveBeenCalled();
    expect(fixture.quota.reserve).not.toHaveBeenCalled();
    expect(fixture.provider.chat).not.toHaveBeenCalled();
  });

  it.each([false, true])('admits all 30 lessons with explicitly saved larger limits, saved notes=%s', async withNotes => {
    const fixture = gateway();
    let covered = 0;
    for (const course of courses) for (const lesson of course.lessons) {
      const dto = await request(course.id, lesson.id, withNotes);
      const result = await fixture.service.chat(user, dto, undefined, false, true);
      expect(result.text).toBe('Fixture response after admission.');
      expect(fixture.provider.chat).toHaveBeenLastCalledWith(
        'fixture-upstream', dto, expect.any(AbortSignal), { id: 'fixture-lease' },
      );
      covered++;
    }
    expect(courses).toHaveLength(5);
    expect(covered).toBe(30);
    expect(fixture.provider.chat).toHaveBeenCalledTimes(30);
    expect(fixture.quota.finish).toHaveBeenCalledTimes(30);
  });

  it.each([false, true])('admits homepage educational context under the same registered limits, saved notes=%s', async withNotes => {
    const fixture = gateway();
    await expect(fixture.service.chat(user, await request(undefined, undefined, withNotes), undefined, false, true))
      .resolves.toMatchObject({ text: 'Fixture response after admission.' });
    expect(fixture.provider.chat).toHaveBeenCalledTimes(1);
  });

  it.each([
    { input: 2000, output: 2048, context: 65536 },
    { input: 32768, output: 1199, context: 65536 },
    { input: 3952, output: 2048, context: 6000 },
  ])('retains input, output and total-context admission checks for an explicit smaller budget: %j', async limits => {
    const fixture = gateway(limits);
    await expect(fixture.service.chat(user, await request('arduino', 'led'), undefined, false, true))
      .rejects.toMatchObject({ code: ErrorCode.AI_REQUEST_LIMIT_EXCEEDED });
    expect(fixture.clients.acquire).not.toHaveBeenCalled();
    expect(fixture.provider.chat).not.toHaveBeenCalled();
  });
});
