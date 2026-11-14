import { Controller, Get, Injectable, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../database/prisma.service';
import { CurrentUser, PaginatedResult, PaginationQueryDto, Permissions } from '../../shared/sdk';
import type { RequestUser } from '../../shared/sdk';
import { LearningAccessService } from './learning-access.service';
import { ProgressService } from './progress.service';

@Injectable()
export class LearningAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: LearningAccessService,
    private readonly progress: ProgressService,
  ) {}
  async dashboard(actor: RequestUser) {
    // Process bounded enrollment batches; never load the student's complete attempt history.
    const totals = {
      enrolledCourses: 0,
      completedCourses: 0,
      inProgressCourses: 0,
      notStartedCourses: 0,
      requiredLessons: 0,
      completedLessons: 0,
    };
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.enrollment.findMany({
        where: {
          user_id: actor.id,
          deleted_at: null,
          status: 'active',
          course: { status: 'published', deleted_at: null },
        },
        select: { id: true, course_id: true },
        take: 100,
        orderBy: { id: 'asc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!rows.length) break;
      const summaries = await this.progress.summaryMany(
        this.prisma,
        actor.id,
        rows.map((row) => row.course_id),
      );
      for (const row of rows) {
        const summary = summaries.get(row.course_id)!;
        totals.enrolledCourses++;
        totals.requiredLessons += summary.totalLessons;
        totals.completedLessons += summary.completedLessons;
        if (summary.isComplete) totals.completedCourses++;
        else if (summary.lessons.some((lesson) => lesson.status !== 'not_started'))
          totals.inProgressCourses++;
        else totals.notStartedCourses++;
      }
      cursor = rows[rows.length - 1].id;
      if (rows.length < 100) break;
    }
    const [graded, statuses, passed, lastActivity] = await Promise.all([
      this.prisma.quizAttempt.aggregate({
        where: { user_id: actor.id, status: 'graded' },
        _count: true,
        _avg: { percentage: true },
        _max: { graded_at: true },
      }),
      this.prisma.quizAttempt.groupBy({
        by: ['status'],
        where: { user_id: actor.id },
        _count: true,
      }),
      this.prisma.quizAttempt.count({
        where: { user_id: actor.id, status: 'graded', is_passed: true },
      }),
      this.prisma.progress.aggregate({
        where: { user_id: actor.id },
        _max: { last_accessed_at: true },
      }),
    ]);
    return {
      ...totals,
      overallProgress: totals.requiredLessons
        ? Math.round((totals.completedLessons * 10000) / totals.requiredLessons) / 100
        : 0,
      quizzes: {
        gradedAttempts: graded._count,
        passedAttempts: passed,
        averageScore: graded._avg.percentage,
        statuses: Object.fromEntries(statuses.map((row) => [row.status, row._count])),
      },
      lastActivityAt:
        [lastActivity._max.last_accessed_at, graded._max.graded_at]
          .filter((d): d is Date => !!d)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
    };
  }
  async continueLearning(actor: RequestUser) {
    const record = await this.prisma.progress.findFirst({
      where: {
        user_id: actor.id,
        lesson: {
          status: 'published',
          deleted_at: null,
          course: {
            status: 'published',
            deleted_at: null,
            enrollments: { some: { user_id: actor.id, deleted_at: null, status: 'active' } },
          },
        },
      },
      include: { lesson: { select: { course_id: true } } },
      orderBy: [{ last_accessed_at: 'desc' }, { id: 'asc' }],
    });
    const latest =
      record?.lesson.course_id ??
      (
        await this.prisma.enrollment.findFirst({
          where: {
            user_id: actor.id,
            deleted_at: null,
            status: 'active',
            course: { deleted_at: null, status: 'published' },
          },
          orderBy: [{ enrolled_at: 'desc' }, { id: 'asc' }],
        })
      )?.course_id;
    if (!latest) return { courseId: null, lessonId: null };
    const summary = await this.progress.getCourseProgress(actor.id, latest);
    return { courseId: latest, lessonId: summary.resumeLessonId, progress: summary };
  }
  async course(actor: RequestUser, courseId: string, query: PaginationQueryDto) {
    await this.access.owner(actor, courseId);
    const where = { course_id: courseId, deleted_at: null, status: 'active' };
    const attemptWhere = { quiz: { lesson: { course_id: courseId } }, status: 'graded' };
    const [enrollments, total, scores, wrong] = await Promise.all([
      this.prisma.enrollment.findMany({
        where,
        select: {
          id: true,
          user_id: true,
          enrolled_at: true,
          completed_at: true,
          user: { select: { first_name: true, last_name: true } },
        },
        skip: query.skip,
        take: query.take,
        orderBy: [{ enrolled_at: 'desc' }, { id: 'asc' }],
      }),
      this.prisma.enrollment.count({ where }),
      this.prisma.quizAttempt.aggregate({
        where: attemptWhere,
        _count: true,
        _avg: { percentage: true },
      }),
      this.prisma.quizAttemptAnswer.groupBy({
        by: ['question_id'],
        where: { is_correct: false, attempt: { ...attemptWhere } },
        _count: true,
        orderBy: { _count: { question_id: 'desc' } },
        take: 10,
      }),
    ]);
    const userIds = enrollments.map((enrollment) => enrollment.user_id);
    const [summaries, studentScores] = await Promise.all([
      this.progress.summariesForUsers(this.prisma, userIds, courseId),
      this.prisma.quizAttempt.groupBy({
        by: ['user_id'],
        where: { ...attemptWhere, user_id: { in: userIds } },
        _count: true,
        _avg: { percentage: true },
      }),
    ]);
    const scoresByUser = new Map(studentScores.map((row) => [row.user_id, row]));
    const students = enrollments.map((enrollment) => {
      const attempts = scoresByUser.get(enrollment.user_id);
      const average = attempts?._avg.percentage ?? null;
      return {
        userId: enrollment.user_id,
        displayName: `${enrollment.user.first_name} ${enrollment.user.last_name}`,
        enrolledAt: enrollment.enrolled_at,
        historicalCompletedAt: enrollment.completed_at,
        progress: summaries.get(enrollment.user_id)!,
        gradedAttempts: attempts?._count ?? 0,
        averageScore: average,
        needsSupport: average !== null && average < 70,
      };
    });
    return {
      courseId,
      enrolledStudents: total,
      gradedAttempts: scores._count,
      averageScore: scores._avg.percentage,
      frequentlyWrong: wrong.map((row) => ({
        questionId: row.question_id,
        wrongAnswers: row._count,
      })),
      students: new PaginatedResult(students, total, query.page, query.limit),
    };
  }
}
@ApiTags('Learning analytics')
@ApiBearerAuth('access-token')
@Controller('v1/learning')
export class LearningAnalyticsController {
  constructor(private readonly analytics: LearningAnalyticsService) {}
  @Get('dashboard')
  @Permissions('learning:read')
  @ApiOperation({
    summary: 'Own actual progress and finalized scores; no attempts means null average',
  })
  dashboard(@CurrentUser() actor: RequestUser) {
    return this.analytics.dashboard(actor);
  }
  @Get('continue')
  @Permissions('learning:read')
  @ApiOperation({ summary: 'Own most recently accessed eligible course and resume lesson' })
  continue(@CurrentUser() actor: RequestUser) {
    return this.analytics.continueLearning(actor);
  }
  @Get('courses/:id/analytics')
  @Permissions('analytics:read')
  @ApiOperation({
    summary:
      'Course owner/administrator only; actual score aggregates and paginated student progress',
  })
  course(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.analytics.course(actor, id, query);
  }
}
