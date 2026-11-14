import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { NotFoundException, ConflictException } from '../../shared/sdk/errors/domain.exception';
import { PaginationQueryDto, PaginatedResult } from '../../shared/sdk';
import type { RequestUser } from '../../shared/sdk';
import { auditContent, lockCourse } from '../courses/content-integrity';
import { LearningAccessService } from './learning-access.service';
import { ApprovalService } from '../roles/approval.service';
import { activateEnrollment } from './enrollment.repository';

type LearningLesson = Prisma.LessonGetPayload<{
  include: { progress: true; quizzes: { select: { id: true; revision: true } } };
}>;
type ProgressRow = {
  lessonId: string;
  title: string;
  sortOrder: number;
  isRequired: boolean;
  status: 'not_started' | 'in_progress' | 'completed';
  completedAt: Date | null;
  lastAccessedAt: Date | null;
  requiredQuizzesPassed: boolean;
};

function summarize(rows: ProgressRow[]) {
  const required = rows.filter((lesson) => lesson.isRequired);
  const completedLessons = required.filter((lesson) => lesson.status === 'completed').length;
  const last = [...rows].sort(
    (a, b) => (b.lastAccessedAt?.getTime() ?? 0) - (a.lastAccessedAt?.getTime() ?? 0),
  )[0];
  return {
    totalLessons: required.length,
    completedLessons,
    percent: required.length ? Math.round((completedLessons * 10000) / required.length) / 100 : 0,
    isComplete: required.length > 0 && completedLessons === required.length,
    resumeLessonId:
      last?.lastAccessedAt && last.status !== 'completed'
        ? last.lessonId
        : (rows.find((lesson) => lesson.status !== 'completed')?.lessonId ??
          rows[0]?.lessonId ??
          null),
    lessons: rows,
  };
}

@Injectable()
export class ProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: LearningAccessService,
    private readonly approvals: ApprovalService,
  ) {}

  async enroll(actor: RequestUser, courseId: string) {
    const current = await this.prisma.course.findFirst({
      where: { id: courseId, deleted_at: null, status: 'published' },
    });
    if (current?.enrollment_approval_required) {
      const row = await this.approvals.create(
        {
          type: 'COURSE_ENROLLMENT',
          scopeType: 'COURSE',
          scopeId: courseId,
          reason: 'Yêu cầu đăng ký khóa học',
        },
        actor.id,
      );
      return { courseId, status: 'pending', requestId: row.id };
    }
    return this.prisma.$transaction(async (tx) => {
      const course = await lockCourse(tx, courseId);
      await this.access.actor(tx, actor, 'learning:enroll');
      if (course.status !== 'published') throw new NotFoundException('Published course', courseId);
      if (course.enrollment_approval_required)
        throw new ConflictException('Enrollment policy changed; request approval');
      const enrollment = await activateEnrollment(tx, actor.id, courseId);
      await auditContent(tx, 'learning.enrolled', actor.id, 'course', courseId);
      return {
        id: enrollment.id,
        courseId,
        enrolledAt: enrollment.enrolled_at,
        status: enrollment.status,
      };
    });
  }

  async unenroll(actor: RequestUser, courseId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.course.updateMany({
        where: { id: courseId },
        data: { sort_order: { increment: 0 } },
      });
      await this.access.actor(tx, actor, 'learning:enroll');
      const enrollment = await tx.enrollment.findUnique({
        where: { user_id_course_id: { user_id: actor.id, course_id: courseId } },
      });
      if (!enrollment) throw new NotFoundException('Enrollment', courseId);
      await tx.enrollment.update({
        where: { id: enrollment.id },
        data: { status: 'cancelled', deleted_at: new Date() },
      });
      await auditContent(tx, 'learning.unenrolled', actor.id, 'course', courseId);
      return { courseId, status: 'cancelled' };
    });
  }

  async getMyEnrollments(userId: string, query = new PaginationQueryDto()) {
    const where: Prisma.EnrollmentWhereInput = {
      user_id: userId,
      deleted_at: null,
      status: 'active',
      course: { deleted_at: null, status: 'published' },
    };
    const [enrollments, total] = await Promise.all([
      this.prisma.enrollment.findMany({
        where,
        skip: query.skip,
        take: query.take,
        include: { course: { select: { id: true, title: true, slug: true, thumbnail_url: true } } },
        orderBy: [{ enrolled_at: 'desc' }, { id: 'asc' }],
      }),
      this.prisma.enrollment.count({ where }),
    ]);
    const summaries = await this.summaryMany(
      this.prisma,
      userId,
      enrollments.map((e) => e.course_id),
    );
    const data = enrollments.map((e) => ({
      enrollmentId: e.id,
      enrolledAt: e.enrolled_at,
      completedAt: e.completed_at,
      course: {
        id: e.course.id,
        title: e.course.title,
        slug: e.course.slug,
        thumbnailUrl: e.course.thumbnail_url,
      },
      progress: summaries.get(e.course_id)!,
    }));
    return new PaginatedResult(data, total, query.page, query.limit);
  }

  async summary(tx: Prisma.TransactionClient, userId: string, courseId: string) {
    return (await this.summaryMany(tx, userId, [courseId])).get(courseId)!;
  }

  async summaryMany(tx: Prisma.TransactionClient, userId: string, courseIds: string[]) {
    const lessons = await tx.lesson.findMany({
      where: { course_id: { in: courseIds }, status: 'published', deleted_at: null },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      include: {
        progress: { where: { user_id: userId } },
        quizzes: {
          where: { status: 'published', deleted_at: null, requires_pass: true },
          select: { id: true, revision: true },
        },
      },
    });
    const passed = await this.passedQuizzes(tx, lessons, [userId]);
    return new Map(
      courseIds.map((courseId) => [
        courseId,
        summarize(
          this.rows(
            lessons.filter((lesson) => lesson.course_id === courseId),
            userId,
            passed,
          ),
        ),
      ]),
    );
  }

  async summariesForUsers(tx: Prisma.TransactionClient, userIds: string[], courseId: string) {
    const lessons = await tx.lesson.findMany({
      where: { course_id: courseId, status: 'published', deleted_at: null },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      include: {
        progress: { where: { user_id: { in: userIds } } },
        quizzes: {
          where: { status: 'published', deleted_at: null, requires_pass: true },
          select: { id: true, revision: true },
        },
      },
    });
    const passed = await this.passedQuizzes(tx, lessons, userIds);
    return new Map(
      userIds.map((userId) => [userId, summarize(this.rows(lessons, userId, passed))]),
    );
  }

  private async passedQuizzes(
    tx: Prisma.TransactionClient,
    lessons: LearningLesson[],
    userIds: string[],
  ) {
    const quizzes = lessons.flatMap((lesson) => lesson.quizzes);
    if (!quizzes.length || !userIds.length) return new Set<string>();
    const rows = await tx.quizAttempt.groupBy({
      by: ['user_id', 'quiz_id'],
      where: {
        user_id: { in: userIds },
        status: 'graded',
        is_passed: true,
        OR: quizzes.map((q) => ({ quiz_id: q.id, quiz_revision: q.revision })),
      },
    });
    return new Set(rows.map((row) => `${row.user_id}:${row.quiz_id}`));
  }

  private rows(
    lessons: LearningLesson[],
    userId: string,
    passed: ReadonlySet<string>,
  ): ProgressRow[] {
    return lessons.map((lesson) => {
      const record = lesson.progress.find((row) => row.user_id === userId);
      const gatesPassed = lesson.quizzes.every((quiz) => passed.has(`${userId}:${quiz.id}`));
      return {
        lessonId: lesson.id,
        title: lesson.title,
        sortOrder: lesson.sort_order,
        isRequired: lesson.is_required,
        status:
          record?.status === 'completed' && gatesPassed
            ? 'completed'
            : record && record.status !== 'not_started'
              ? 'in_progress'
              : 'not_started',
        completedAt: record?.completed_at ?? null,
        lastAccessedAt: record?.last_accessed_at ?? null,
        requiredQuizzesPassed: gatesPassed,
      };
    });
  }

  async getCourseProgress(userId: string, courseId: string) {
    await this.access.course(userId, courseId);
    return this.summary(this.prisma, userId, courseId);
  }

  async enrollmentState(userId: string, courseId: string) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { user_id_course_id: { user_id: userId, course_id: courseId } },
    });
    if (!enrollment) throw new NotFoundException('Enrollment', courseId);
    return {
      id: enrollment.id,
      courseId,
      status: enrollment.status,
      enrolledAt: enrollment.enrolled_at,
      historicalCompletedAt: enrollment.completed_at,
      completedVersion: enrollment.completed_version,
    };
  }

  async lessonProgress(userId: string, lessonId: string) {
    const { course } = await this.access.lesson(userId, lessonId);
    return (await this.summary(this.prisma, userId, course.id)).lessons.find(
      (lesson) => lesson.lessonId === lessonId,
    )!;
  }

  async reconcile(tx: Prisma.TransactionClient, userId: string, courseId: string) {
    const progress = await this.summary(tx, userId, courseId);
    if (progress.isComplete) {
      const course = await tx.course.findUniqueOrThrow({ where: { id: courseId } });
      const enrollment = await tx.enrollment.findUnique({
        where: { user_id_course_id: { user_id: userId, course_id: courseId } },
      });
      if (enrollment && enrollment.status === 'active' && !enrollment.deleted_at)
        await tx.enrollment.update({
          where: { id: enrollment.id },
          data: {
            completed_at: enrollment.completed_at ?? new Date(),
            completed_version: course.content_version,
          },
        });
    }
    return progress;
  }

  async record(actor: RequestUser, lessonId: string, complete: boolean) {
    const lesson = await this.prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) throw new NotFoundException('Lesson', lessonId);
    return this.prisma.$transaction(async (tx) => {
      await lockCourse(tx, lesson.course_id);
      await this.access.actor(tx, actor, 'learning:update');
      await this.access.lesson(actor.id, lessonId, tx);
      const summary = await this.summary(tx, actor.id, lesson.course_id);
      if (
        complete &&
        !summary.lessons.find((item) => item.lessonId === lessonId)?.requiredQuizzesPassed
      )
        throw new ConflictException(
          'Pass all current required quizzes before completing this lesson',
        );
      const now = new Date();
      const existing = await tx.progress.findUnique({
        where: { user_id_lesson_id: { user_id: actor.id, lesson_id: lessonId } },
      });
      const record = await tx.progress.upsert({
        where: { user_id_lesson_id: { user_id: actor.id, lesson_id: lessonId } },
        create: {
          user_id: actor.id,
          lesson_id: lessonId,
          status: complete ? 'completed' : 'in_progress',
          started_at: now,
          last_accessed_at: now,
          completed_at: complete ? now : null,
        },
        update: {
          status: complete
            ? 'completed'
            : existing?.status === 'completed'
              ? 'completed'
              : 'in_progress',
          started_at: existing?.started_at ?? now,
          last_accessed_at: now,
          ...(complete ? { completed_at: existing?.completed_at ?? now } : {}),
        },
      });
      if (complete)
        await auditContent(tx, 'learning.lesson_completed', actor.id, 'lesson', lessonId);
      return {
        lessonId,
        status: record.status,
        completedAt: record.completed_at,
        progress: await this.reconcile(tx, actor.id, lesson.course_id),
      };
    });
  }
}
