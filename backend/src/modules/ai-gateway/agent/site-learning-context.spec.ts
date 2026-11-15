import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PrismaService } from '../../../database/prisma.service';
import type { RequestUser } from '../../../shared/sdk';
import { AiAgentService } from './ai-agent.service';
import { AgentToolRegistry } from './agent-tool-registry';
import { ownLearningData, siteLabResources, siteLessonContext } from './site-learning-context';
import { siteCourseLabs, siteLabPlatforms } from './site-lab-catalog';

function database(values: Record<string, string> = {}) {
  const snapshot = { values, summary: { courses: [] }, revision: 7, updated_at: new Date(0) };
  return {
    learnerState: { findUnique: jest.fn().mockResolvedValue(snapshot) },
    auditLog: { findMany: jest.fn().mockResolvedValue([{ action: 'learner.lab_opened', created_at: new Date(0), new_data: { courseId: 'arduino', lessonId: 'led', password: 'must never leave' } }]) },
  };
}

describe('Authoritative site labs and owner learning context', () => {
  it('matches the actual frontend lab menu instead of the obsolete course tools tags', () => {
    const source = readFileSync(resolve(process.cwd(), '../frontend/src/data/lab-platforms.js'), 'utf8');
    const platforms = JSON.parse(source.match(/window\.STROBOT_LAB_PLATFORMS\s*=\s*({[\s\S]*?})\s*;/)![1]) as Record<string, Record<string, unknown>>;
    const courses = JSON.parse(source.match(/window\.STROBOT_COURSE_LABS\s*=\s*({[\s\S]*?})\s*;/)![1]) as Record<string, string[]>;
    expect(siteCourseLabs).toEqual(courses);
    for (const keys of Object.values(courses)) for (const key of keys) {
      for (const field of ['name', 'mode', 'languages', 'url', 'externalUrl']) expect(siteLabPlatforms[key][field as keyof typeof siteLabPlatforms[string]]).toEqual(platforms[key][field]);
    }
    const arduino = siteLabResources('arduino', 'wokwi');
    expect(arduino.courses[0].platforms.find(p => p.key === 'wokwi')?.selected).toBe(true);
    expect(arduino.courses[0].platforms.map(p => p.key)).toEqual(['circuit', 'avr', 'wokwi', 'phet', 'local']);
    expect(() => siteLabResources('arduino', 'python')).toThrow('not offered');
  });

  it('includes approved lesson/lab content but never the hidden answer or solution fields', () => {
    const context = siteLessonContext('arduino', 'led', 'avr');
    expect(context.lesson).toBe('Mạch kín và LED');
    expect(context.goal).toContain('điện trở');
    expect(context.labs.selectedPlatformKey).toBe('avr');
    expect(context).not.toHaveProperty('answer');
    expect(context).not.toHaveProperty('solution');
    expect(context).not.toHaveProperty('opts');
    expect(() => siteLessonContext('microbit', 'led')).toThrow();
  });

  it('loads only the authenticated owner and exposes relevant saved journals, scores and activity', async () => {
    const db = database({
      'strobot.original.course.v3': JSON.stringify({ last: 'arduino', arduino: { led: { note: 'Đổi điện trở 330 Ω rồi quan sát LED', prediction: 'Dòng giảm', done: true } }, microbit: { matrix: { note: 'Unrelated private note', done: false } } }),
      'strobot.quiz.history.v1': JSON.stringify([{ courseId: 'arduino', lessonId: 'led', correct: 3, total: 4, percentage: 75, createdAt: '2026-11-14T00:00:00Z' }]),
      'strobot.assessment.v1': JSON.stringify({ participants: [{ code: 'OTHER-PERSON', password: 'not account learning' }] }),
      'refreshToken': 'NEVER FETCH OR FORWARD',
    });
    const result = await ownLearningData(db as unknown as PrismaService, 'actual-request-owner', 'arduino', 'led');
    expect(db.learnerState.findUnique).toHaveBeenCalledWith({ where: { user_id: 'actual-request-owner' }, select: { values: true, summary: true, revision: true, updated_at: true } });
    expect(db.auditLog.findMany.mock.calls[0][0].where.user_id).toBe('actual-request-owner');
    expect(result).toMatchObject({ hasSnapshot: true, revision: 7 });
    expect(result.courses[0]).toMatchObject({ courseSlug: 'arduino', lessons: [expect.objectContaining({ lessonSlug: 'led', done: true, note: 'Đổi điện trở 330 Ω rồi quan sát LED' })] });
    expect(result.recentQuizResults[0]).toMatchObject({ correct: 3, total: 4 });
    expect(result.recentActivities[0]).toMatchObject({ action: 'learner.lab_opened', lessonSlug: 'led' });
    expect(JSON.stringify(result)).not.toMatch(/OTHER-PERSON|Unrelated private|NEVER FETCH|must never leave|refreshToken/);
  });

  it('reads saved Microbit main.py for its owner and redacts credential-like content', async () => {
    const db = database({
      'strobot.microbit.editor.v1.matrix': JSON.stringify({ savedAt: 123, project: { projectName: 'My matrix', files: { 'main.py': Buffer.from('from microbit import *\napi_key="very-secret-key"\ndisplay.show(Image.HEART)').toString('base64') } } }),
    });
    const result = await ownLearningData(db as unknown as PrismaService, 'owner', 'microbit', 'matrix');
    expect(result.project).toMatchObject({ source: 'saved-microbit-editor', projectName: 'My matrix' });
    expect(result.project?.mainPython).toContain('display.show');
    expect(JSON.stringify(result)).not.toContain('very-secret-key');
  });

  it('bounds escaped multilingual journals to the real tool-result byte budget', async () => {
    const state = Object.fromEntries(['led', 'timing', 'distance', 'alarm', 'calibration', 'project'].map(id => [id, { note: 'Tiến độ 👩‍💻\n\t"'.repeat(3000), observation: 'Quan sát'.repeat(1000), done: false }]));
    const db = database({ 'strobot.original.course.v3': JSON.stringify({ arduino: state }) });
    const result = await ownLearningData(db as unknown as PrismaService, 'owner', 'arduino');
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(9000);
    expect(result.courses).toHaveLength(1);
  });

  it('does not forward unexpected credential-shaped objects from damaged saved metadata', async () => {
    const secret = { password: 'metadata-must-not-be-forwarded' };
    const db = database({
      'strobot.original.course.v3': JSON.stringify({ microbit: { matrix: { done: false, completedAt: 'not a date' } } }),
      'strobot.quiz.history.v1': JSON.stringify([{ courseId: secret, correct: 1, total: 2 }, { courseId: 'microbit', lessonId: 'matrix', correct: 1, total: 2, percentage: secret, createdAt: secret }]),
      'strobot.review.evidence.v1': JSON.stringify({ attempts: [{ courseId: secret, mode: secret, completedAt: secret }, { courseId: 'microbit', mode: 'review', completedAt: secret, answers: [] }] }),
      'strobot.microbit.editor.v1.matrix': JSON.stringify({ savedAt: secret, project: { projectName: 'Matrix', files: {} } }),
    });
    const result = await ownLearningData(db as unknown as PrismaService, 'owner', 'microbit', 'matrix');
    expect(JSON.stringify(result)).not.toContain('metadata-must-not-be-forwarded');
    expect(result.project).not.toHaveProperty('savedAt');
    expect(result.recentQuizResults).toEqual([{ courseId: 'microbit', lessonId: 'matrix', correct: 1, total: 2 }]);
    expect(result.practiceHistory).toEqual([{ courseSlug: 'microbit', mode: 'review', answeredQuestions: 0 }]);
  });

  it('supplies owner learning and labs automatically without enrolling a free-learning user', async () => {
    const db = database({ 'strobot.original.course.v3': JSON.stringify({ arduino: { led: { note: 'Last saved note', done: true } } }) });
    const agent = Object.create(AiAgentService.prototype) as AiAgentService;
    const actor = jest.fn().mockResolvedValue({ id: 'owner' });
    Object.assign(agent, { db, actor });
    const call = (agent as unknown as { prepareLessonContext: (user: RequestUser, dto: object) => Promise<Record<string, unknown>> }).prepareLessonContext.bind(agent);
    const context = await call({ id: 'owner' } as RequestUser, { mode: 'EDUCATIONAL', courseSlug: 'arduino', lessonSlug: 'led', selectedPlatformKey: 'avr', learningSnapshotPending: true });
    expect(actor).toHaveBeenCalledWith(expect.objectContaining({ id: 'owner' }), 'learning:read');
    expect(context).toMatchObject({ courseSlug: 'arduino', deviceDraftPending: true, ownLearning: { revision: 7 } });
    expect(JSON.stringify(context)).toContain('Last saved note');
    await expect(call({ id: 'owner' } as RequestUser, { mode: 'MANAGEMENT', courseSlug: 'arduino', lessonSlug: 'led' })).rejects.toThrow('educational');
  });

  it('does not let tool arguments select another owner or an unrelated lesson', () => {
    const agent = Object.create(AiAgentService.prototype) as AiAgentService;
    Object.assign(agent, { educational: { handles: () => false }, management: { handles: () => false } });
    const validate = (agent as unknown as { validateArguments: (name: string, args: unknown) => unknown }).validateArguments.bind(agent);
    expect(validate('learning_get_own_learning_data', { courseSlug: 'arduino', lessonSlug: 'led' })).toEqual({ courseSlug: 'arduino', lessonSlug: 'led' });
    expect(() => validate('learning_get_own_learning_data', { courseSlug: 'arduino', lessonSlug: 'led', userId: 'another-user' })).toThrow();
    expect(() => validate('learning_get_own_learning_data', { courseSlug: 'arduino', lessonSlug: 'matrix' })).toThrow();
    const registry = new AgentToolRegistry();
    expect(registry.available('EDUCATIONAL', [])).not.toContainEqual(expect.objectContaining({ name: 'learning_get_own_learning_data' }));
    expect(registry.available('EDUCATIONAL', ['learning:read'])).toContainEqual(expect.objectContaining({ name: 'learning_get_lab_platforms' }));
  });
});
