import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../database/prisma.service';
import { courseLessons } from '../../learner-state/learner-state.policy';

const COUNTS = ['totalLessons', 'completedLessons', 'savedLessons', 'quizAttempts', 'practiceAttempts'] as const;
type CourseReport = { courseId: string } & Record<(typeof COUNTS)[number], number>;

/** Return only validated counters, never journal/project/assessment snapshot values. */
export function learningReportCourses(value: unknown, slug?: string): CourseReport[] {
  if (!value || typeof value !== 'object' || !('courses' in value) || !Array.isArray(value.courses)) return [];
  const reports: CourseReport[] = [];
  for (const item of value.courses) {
    if (!item || typeof item !== 'object' || typeof item.courseId !== 'string' ||
        !Object.hasOwn(courseLessons, item.courseId) || (slug && slug !== item.courseId)) continue;
    if (COUNTS.some((key) => !Number.isSafeInteger(item[key]) || item[key] < 0)) continue;
    const row = { courseId: item.courseId } as CourseReport;
    for (const key of COUNTS) row[key] = item[key];
    reports.push(row);
  }
  return reports;
}

export async function ownLearningReport(db: PrismaService, ownerId: string, scope?: string) {
  const slug = scope ? (await db.course.findFirst({ where: { id: scope, deleted_at: null }, select: { slug: true } }))?.slug : undefined;
  const row = await db.learnerState.findUnique({ where: { user_id: ownerId }, select: { summary: true, updated_at: true } });
  return {
    source: 'learner-self-report',
    updatedAt: row?.updated_at ?? null,
    courses: scope && !slug ? [] : learningReportCourses(row?.summary, slug),
    notice: 'Browser-synchronized completion and practice reports; not independently verified grades or certificates. No private journal text is included.',
  };
}

/** Caller must reauthorize current system analytics or assigned-course analytics first. */
export async function aggregateLearningReports(db: PrismaService, course?: { id: string; slug: string }) {
  const now = new Date();
  const where: Prisma.LearnerStateWhereInput = {
    user: { deleted_at: null, is_active: true, ...(course ? {
      enrollments: { some: { course_id: course.id, status: 'active', deleted_at: null, OR: [{ expires_at: null }, { expires_at: { gt: now } }] } },
    } : {}) },
  };
  const limit = 200;
  const [rows, total] = await Promise.all([
    db.learnerState.findMany({ where, orderBy: [{ updated_at: 'desc' }, { user_id: 'asc' }], take: limit, select: { summary: true } }),
    db.learnerState.count({ where }),
  ]);
  const aggregate = new Map<string, { courseId: string; activeLearnerReports: number; completedLessons: number; quizAttempts: number; practiceAttempts: number }>();
  for (const row of rows) {
    for (const item of learningReportCourses(row.summary, course?.slug)) {
      const current = aggregate.get(item.courseId) ?? { courseId: item.courseId, activeLearnerReports: 0, completedLessons: 0, quizAttempts: 0, practiceAttempts: 0 };
      if (item.savedLessons || item.quizAttempts || item.practiceAttempts) current.activeLearnerReports++;
      current.completedLessons += item.completedLessons;
      current.quizAttempts += item.quizAttempts;
      current.practiceAttempts += item.practiceAttempts;
      aggregate.set(item.courseId, current);
    }
  }
  return {
    source: 'learner-self-report',
    totalSavedSnapshots: total,
    countedSnapshots: rows.length,
    sampleLimit: limit,
    isComplete: total <= rows.length,
    courses: [...aggregate.values()],
    notice: 'Counts from at most 200 most recently synchronized active learner snapshots. No learner identities, journals, project code, verified grades or certificates. These are self-reported learning activities.',
  };
}
