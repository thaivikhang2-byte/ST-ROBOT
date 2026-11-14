import { LearnerStateService } from './learner-state.service';
import { ConflictException, ForbiddenException, RequestUser } from '../../shared/sdk';
import { PrismaService } from '../../database/prisma.service';
import { LearningAccessService } from '../progress/learning-access.service';
import { LearnerManagementQueryDto } from './learner-state.dto';

describe('Account-owned learner persistence', () => {
  const actor = { id: 'session-owner', isEmailVerified: true } as RequestUser;
  const make = (revision?: number) => {
    const table = {
      findUnique: jest.fn().mockResolvedValue(revision === undefined ? null : { revision }),
      create: jest.fn().mockImplementation(async ({ data }) => ({ ...data, updated_at: new Date() })),
      update: jest.fn().mockImplementation(async ({ data }) => ({ ...data, updated_at: new Date() })),
      findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0),
    };
    const tx = { learnerState: table, auditLog: { create: jest.fn().mockResolvedValue({}) }, course: { findFirst: jest.fn() } };
    const db = { ...tx, $transaction: jest.fn().mockImplementation(async fn => fn(tx)) };
    const access = { actor: jest.fn().mockResolvedValue({ ...actor, grants: [] }) };
    const service = new LearnerStateService(db as unknown as PrismaService, access as unknown as LearningAccessService);
    return { service, access, tx, table };
  };
  it('derives ownership from the authenticated session for the initial write', async () => {
    const { service, access, table, tx } = make();
    const result = await service.save(actor, { revision: 0, values: { 'strobot.learning.level.v1': 'beginner' } });
    expect(access.actor).toHaveBeenCalledWith(tx, actor, 'learning:update');
    expect(table.create).toHaveBeenCalledWith({ data: expect.objectContaining({ user_id: actor.id, revision: 1 }) });
    expect(result.revision).toBe(1);
    expect(tx.auditLog.create.mock.calls[0][0].data.new_data).not.toHaveProperty('values');
  });
  it('returns 409 on a stale revision and leaves state and audit untouched', async () => {
    const { service, table, tx } = make(4);
    await expect(service.save(actor, { revision: 3, values: {} })).rejects.toBeInstanceOf(ConflictException);
    expect(table.update).not.toHaveBeenCalled();
    expect(table.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('replaces rather than merges a matching revision, so explicit deletion can synchronize', async () => {
    const { service, table } = make(4);
    expect((await service.save(actor, { revision: 4, values: {} })).revision).toBe(5);
    expect(table.update).toHaveBeenCalledWith({ where: { user_id: actor.id }, data: expect.objectContaining({ revision: 5, values: {} }) });
  });
  it('rechecks verified RBAC/session authority before every mutation', async () => {
    const { service, access, table } = make();
    access.actor.mockRejectedValue(new ForbiddenException());
    await expect(service.save(actor, { revision: 0, values: {} })).rejects.toBeInstanceOf(ForbiddenException);
    expect(table.findUnique).not.toHaveBeenCalled();
    expect(table.create).not.toHaveBeenCalled();
  });
  it('forbids learner and cross-course teacher access to manager summaries', async () => {
    const { service, access, tx, table } = make();
    const query = Object.assign(new LearnerManagementQueryDto(), { courseId: 'course-b' });
    await expect(service.management(actor, query)).rejects.toBeInstanceOf(ForbiddenException);
    access.actor.mockResolvedValue({ ...actor, grants: [{ group: 'TEACHER', scopeType: 'COURSE', scopeId: 'course-a', permissions: ['analytics:read'] }] });
    await expect(service.management(actor, query)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.course.findFirst).not.toHaveBeenCalled();
    expect(table.findMany).not.toHaveBeenCalled();
  });
  it('reads only the authenticated account snapshot', async () => {
    const { service, table } = make();
    expect(await service.get(actor)).toEqual({ revision: 0, values: {}, updatedAt: null });
    expect(table.findUnique).toHaveBeenCalledWith({ where: { user_id: actor.id } });
  });
  it('returns assigned-course summaries without reading or exposing journals or other courses', async () => {
    const { service, access, tx, table } = make();
    access.actor.mockResolvedValue({ ...actor, grants: [{ group: 'TEACHER', scopeType: 'COURSE', scopeId: 'course-a', permissions: ['analytics:read'] }] });
    tx.course.findFirst.mockResolvedValue({ id: 'course-a', slug: 'arduino', creator_id: 'another-teacher' });
    const courses = [{ courseId: 'arduino', completedLessons: 1 }, { courseId: 'microbit', completedLessons: 6 }];
    table.findMany.mockResolvedValue([{ user_id: 'learner-a', revision: 1, updated_at: new Date(), summary: { courses }, values: { secretJournal: 'not selected in a real query' }, user: { first_name: 'Test', last_name: 'Learner' } }]);
    const result = await service.management(actor, Object.assign(new LearnerManagementQueryDto(), { courseId: 'course-a' }));
    expect(result.data[0].courses).toEqual([courses[0]]);
    expect(result.data[0]).not.toHaveProperty('values');
    const selection = table.findMany.mock.calls[0][0];
    expect(selection.select).not.toHaveProperty('values');
    expect(selection.where.user.enrollments.some.course_id).toBe('course-a');
  });
});
