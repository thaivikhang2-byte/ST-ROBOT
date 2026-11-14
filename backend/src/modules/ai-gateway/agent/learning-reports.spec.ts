import type { PrismaService } from '../../../database/prisma.service';
import { aggregateLearningReports, learningReportCourses, ownLearningReport } from './learning-reports';

const report = (courseId: string, completedLessons = 2) => ({
  courseId, totalLessons: 6, completedLessons, savedLessons: 3, quizAttempts: 4, practiceAttempts: 1,
});

describe('Agent access to synchronized learning reports', () => {
  it('exposes only canonical, validated counters and removes private learner fields', () => {
    const result = learningReportCourses({ courses: [
      { ...report('arduino'), note: 'private journal', project: 'private source', email: 'private@example.test' },
      { ...report('microbit'), completedLessons: 'six' },
      report('__proto__'),
    ] });
    expect(result).toEqual([report('arduino')]);
    expect(JSON.stringify(result)).not.toMatch(/private|email|note|project/);
  });

  it('queries only the actor snapshot and does not broaden an invalid course scope', async () => {
    const findUnique = jest.fn().mockResolvedValue({ summary: { courses: [report('arduino')] }, updated_at: new Date(0) });
    const db = {
      course: { findFirst: jest.fn().mockResolvedValue(null) },
      learnerState: { findUnique },
    } as unknown as PrismaService;
    const result = await ownLearningReport(db, 'actual-owner', 'unknown-course');
    expect(findUnique).toHaveBeenCalledWith({
      where: { user_id: 'actual-owner' }, select: { summary: true, updated_at: true },
    });
    expect(result.courses).toEqual([]);
    expect(result.source).toBe('learner-self-report');
  });

  it('restricts teacher aggregates to active nonexpired enrollments and the requested course', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { summary: { courses: [report('arduino'), report('microbit', 6)], privateJournal: 'secret' } },
      { summary: { courses: [report('arduino', 1)] } },
    ]);
    const db = {
      learnerState: { findMany, count: jest.fn().mockResolvedValue(230) },
    } as unknown as PrismaService;
    const result = await aggregateLearningReports(db, { id: 'course-uuid', slug: 'arduino' });
    const query = findMany.mock.calls[0][0];
    expect(query.select).toEqual({ summary: true });
    expect(query.where.user).toMatchObject({
      deleted_at: null, is_active: true,
      enrollments: { some: {
        course_id: 'course-uuid', status: 'active', deleted_at: null,
        OR: [{ expires_at: null }, { expires_at: { gt: expect.any(Date) } }],
      } },
    });
    expect(result.courses).toEqual([{
      courseId: 'arduino', activeLearnerReports: 2, completedLessons: 3, quizAttempts: 8, practiceAttempts: 2,
    }]);
    expect(result).toMatchObject({ source: 'learner-self-report', totalSavedSnapshots: 230, countedSnapshots: 2, sampleLimit: 200, isComplete: false });
    expect(JSON.stringify(result)).not.toMatch(/secret|privateJournal|microbit|userId/);
  });
});
