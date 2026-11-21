import { AiAgentService } from './ai-agent.service';
import type { RequestUser } from '../../../shared/sdk';

describe('Agent selected lab workspace integration', () => {
  const actor = { id: 'owned-student', permissions: ['learning:read'] } as RequestUser;
  const prototype = AiAgentService.prototype as unknown as {
    prepareLessonContext(user: RequestUser, dto: Record<string, unknown>): Promise<unknown>;
    validateArguments(name: string, value: unknown): Record<string, string>;
  };

  it('passes the selected lab into the authenticated owner context and omits other lab copies', async () => {
    const db = {
      learnerState: { findUnique: jest.fn().mockResolvedValue({
        values: { 'strobot.original.course.v3': JSON.stringify({ arduino: { led: { labWork: {
          wokwi: { version: 1, code: 'owned-selected-source', notes: 'My saved lab' },
          avr: { version: 1, code: 'other-platform-source' },
        } } } }) }, summary: {}, revision: 2, updated_at: new Date(0),
      }) },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const result = await prototype.prepareLessonContext.call({ db, actor: async () => actor }, actor, {
      mode: 'EDUCATIONAL', courseSlug: 'arduino', lessonSlug: 'led', selectedPlatformKey: 'wokwi',
    });
    expect(db.learnerState.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { user_id: actor.id } }));
    expect(JSON.stringify(result)).toContain('owned-selected-source');
    expect(JSON.stringify(result)).not.toContain('other-platform-source');
  });

  const validate = (value: unknown) => prototype.validateArguments.call({
    educational: { handles: () => false }, management: { handles: () => false },
  }, 'learning_get_own_learning_data', value);

  it('allows the current lesson platform while retaining the older two-field tool request', () => {
    expect(validate({ courseSlug: 'arduino', lessonSlug: 'led', platformKey: 'wokwi' })).toEqual({ courseSlug: 'arduino', lessonSlug: 'led', platformKey: 'wokwi' });
    expect(validate({ courseSlug: '', lessonSlug: '' })).toEqual({ courseSlug: '', lessonSlug: '' });
  });

  it.each([
    { courseSlug: 'arduino', lessonSlug: 'led', platformKey: 'python' },
    { courseSlug: '', lessonSlug: '', platformKey: 'wokwi' },
    { courseSlug: 'arduino', lessonSlug: '', platformKey: 'wokwi' },
    { courseSlug: 'arduino', lessonSlug: 'led', platformKey: 'wokwi', userId: 'another-student' },
  ])('rejects an unoffered platform, incomplete lesson scope or injected owner: %j', value => {
    expect(() => validate(value)).toThrow();
  });
});
