import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthorizationService } from './authorization.service';
import { ApprovalService } from './approval.service';
import { ApprovalQueryDto } from './management.dto';
import { PaginationQueryDto, PaginatedResult, RequestUser } from '../../shared/sdk';
import { ForbiddenException, NotFoundException } from '../../shared/sdk/errors/domain.exception';
import { auditContent, lockCourse } from '../courses/content-integrity';
import { identityInclude } from '../auth/identity.repository';
@Injectable()
export class ManagementDashboardService {
  constructor(
    private readonly auth: AuthorizationService,
    private readonly approvals: ApprovalService,
  ) {}
  async overview(actorId: string) {
    const db = this.auth.prisma;
    const actor = await db.$transaction((tx) => this.auth.actor(tx, actorId, 'dashboard:read'));
    if (!actor.grants.some((g) => g.group === 'MANAGER' && g.scopeType === 'SYSTEM'))
      throw new ForbiddenException('System manager dashboard authority required');
    const now = new Date();
    const group = (name: 'STUDENT' | 'TEACHER' | 'MANAGER'): Prisma.UserWhereInput => ({
      is_active: true,
      deleted_at: null,
      OR: [
        { rbac_migrated: false, role: { group: name, is_active: true, status: 'ACTIVE' } },
        {
          rbac_migrated: true,
          role_assignments: {
            some: {
              revoked_at: null,
              OR: [{ expires_at: null }, { expires_at: { gt: now } }],
              role: { group: name, is_active: true, status: 'ACTIVE' },
            },
          },
        },
      ],
    });
    const userRead = actor.permissions.includes('users:read'),
      courseRead = actor.permissions.includes('courses:read'),
      analytics = actor.permissions.includes('analytics:read'),
      ai = actor.permissions.includes('ai:manage');
    const [
      users,
      students,
      teachers,
      managers,
      courses,
      enrollments,
      activity,
      quizzes,
      usage,
      pending,
      totalCourses,
      enrollmentStatistics,
    ] = await Promise.all([
      userRead ? db.user.count({ where: { deleted_at: null } }) : null,
      userRead ? db.user.count({ where: group('STUDENT') }) : null,
      userRead ? db.user.count({ where: group('TEACHER') }) : null,
      userRead ? db.user.count({ where: group('MANAGER') }) : null,
      courseRead ? db.course.count({ where: { deleted_at: null, status: 'published' } }) : null,
      analytics
        ? db.enrollment.findMany({
            where: { deleted_at: null },
            select: {
              id: true,
              enrolled_at: true,
              status: true,
              course: { select: { id: true, title: true } },
            },
            orderBy: { enrolled_at: 'desc' },
            take: 5,
          })
        : null,
      analytics
        ? db.progress.count({
            where: { last_accessed_at: { gte: new Date(Date.now() - 7 * 86400000) } },
          })
        : null,
      analytics ? db.quizAttempt.groupBy({ by: ['status'], _count: true }) : null,
      ai
        ? db.aiUsageRecord.aggregate({
            _count: true,
            _sum: { charged_tokens: true, estimated_cost: true },
          })
        : null,
      actor.permissions.includes('approvals:manage')
        ? Promise.all(
            ['PENDING', 'PARTIALLY_APPROVED'].map((status) =>
              this.approvals.list(
                actorId,
                Object.assign(new ApprovalQueryDto(), { status, limit: 1 }),
              ),
            ),
          ).then((rows) => rows.reduce((total, row) => total + row.meta.pagination.total, 0))
        : null,
      courseRead ? db.course.count({ where: { deleted_at: null } }) : null,
      analytics
        ? db.enrollment.groupBy({ by: ['status'], where: { deleted_at: null }, _count: true })
        : null,
    ]);
    return {
      generatedAt: now,
      users,
      activeStudents: students,
      teachers,
      managers,
      publishedCourses: courses,
      totalCourses,
      enrollmentStatistics,
      recentEnrollments: enrollments,
      learningActivityLast7Days: activity,
      quizStatistics: quizzes,
      aiUsage: usage,
      pendingApprovals: pending,
      system: {
        database: 'reachable',
        providers: ai
          ? await db.aiProvider.findMany({ select: { id: true, type: true, enabled: true } })
          : null,
      },
      unavailable: 'Null metrics mean the current role has no permission for that dataset',
    };
  }
  private async teacher(actorId: string, courseId?: string, permission = 'courses:read') {
    const actor = await this.auth.prisma.$transaction((tx) =>
      this.auth.actor(tx, actorId, permission, courseId),
    );
    if (!actor.grants.some((g) => ['TEACHER', 'MANAGER'].includes(g.group)))
      throw new ForbiddenException('Teaching assignment required');
    const ids = actor.grants
      .filter((g) => g.scopeType === 'COURSE' && g.permissions.includes(permission))
      .map((g) => g.scopeId);
    const system = actor.grants.some(
      (g) =>
        g.group === 'MANAGER' && g.scopeType === 'SYSTEM' && g.permissions.includes(permission),
    );
    const where: Prisma.CourseWhereInput = {
      deleted_at: null,
      ...(system ? {} : { OR: [{ creator_id: actorId }, { id: { in: ids } }] }),
    };
    if (
      courseId &&
      !(await this.auth.prisma.course.findFirst({ where: { AND: [where, { id: courseId }] } }))
    )
      throw new ForbiddenException('Course assignment required');
    return { actor, where };
  }
  async courses(actorId: string, query: PaginationQueryDto) {
    // Scoped-only teachers can open the index; individual records still require a current explicit grant.
    const identity = await this.auth.prisma.$transaction((tx) => this.auth.actor(tx, actorId));
    const eligible = identity.grants.filter(
      (g) => ['TEACHER', 'MANAGER'].includes(g.group) && g.permissions.includes('courses:read'),
    );
    if (!identity.is_email_verified || !eligible.length)
      throw new ForbiddenException('Teaching course permission required');
    const system = eligible.some((g) => g.group === 'MANAGER' && g.scopeType === 'SYSTEM');
    const where: Prisma.CourseWhereInput = {
      deleted_at: null,
      ...(system
        ? {}
        : {
            OR: [
              { creator_id: actorId },
              {
                id: { in: eligible.filter((g) => g.scopeType === 'COURSE').map((g) => g.scopeId) },
              },
            ],
          }),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await Promise.all([
      this.auth.prisma.course.findMany({
        where,
        select: {
          id: true,
          title: true,
          status: true,
          creator_id: true,
          enrollment_approval_required: true,
          _count: { select: { lessons: true, enrollments: true } },
        },
        orderBy: { updated_at: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.auth.prisma.course.count({ where }),
    ]);
    return new PaginatedResult(items, total, query.page, query.limit);
  }
  async teaching(actorId: string, query: PaginationQueryDto) {
    const courses = await this.courses(actorId, query);
    return {
      courses,
      notice:
        'Analytics and learner records require selecting an authorized course. Classes are represented by existing course rosters; no separate class model exists.',
    };
  }
  async roster(actorId: string, courseId: string, query: PaginationQueryDto) {
    await this.teacher(actorId, courseId, 'analytics:read');
    const where = {
      course_id: courseId,
      deleted_at: null,
      status: 'active',
      ...(query.search
        ? {
            user: {
              OR: [
                { first_name: { contains: query.search, mode: 'insensitive' as const } },
                { last_name: { contains: query.search, mode: 'insensitive' as const } },
              ],
            },
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.auth.prisma.enrollment.findMany({
        where,
        select: {
          id: true,
          user_id: true,
          enrolled_at: true,
          user: { select: { first_name: true, last_name: true } },
          completed_at: true,
        },
        skip: query.skip,
        take: query.take,
        orderBy: { enrolled_at: 'desc' },
      }),
      this.auth.prisma.enrollment.count({ where }),
    ]);
    return new PaginatedResult(data, total, query.page, query.limit);
  }
  async submissions(actorId: string, courseId: string, query: PaginationQueryDto) {
    await this.teacher(actorId, courseId, 'quizzes:grade');
    const where = {
      quiz: { lesson: { course_id: courseId } },
      status: { in: ['pending_grading', 'graded'] },
    };
    const [data, total] = await Promise.all([
      this.auth.prisma.quizAttempt.findMany({
        where,
        select: {
          id: true,
          user_id: true,
          status: true,
          submitted_at: true,
          percentage: true,
          quiz: { select: { title: true } },
          user: { select: { first_name: true, last_name: true } },
        },
        skip: query.skip,
        take: query.take,
        orderBy: { submitted_at: 'desc' },
      }),
      this.auth.prisma.quizAttempt.count({ where }),
    ]);
    return new PaginatedResult(data, total, query.page, query.limit);
  }
  async userAuthorization(id: string) {
    const row = await this.auth.prisma.user.findFirst({
      where: { id, deleted_at: null },
      include: {
        ...identityInclude,
        role_assignments: {
          include: { role: { select: { id: true, name: true, group: true, status: true } } },
        },
      },
    });
    if (!row) throw new NotFoundException('User');
    return { assignments: row.role_assignments, legacyRoleId: row.role_id };
  }
  async history(query: PaginationQueryDto, userId?: string, resourceId?: string) {
    const where = {
      ...(userId ? { user_id: userId } : {}),
      ...(resourceId ? { resource_id: resourceId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.auth.prisma.auditLog.findMany({
        where,
        select: {
          id: true,
          user_id: true,
          action: true,
          resource: true,
          resource_id: true,
          created_at: true,
        },
        skip: query.skip,
        take: query.take,
        orderBy: { created_at: 'desc' },
      }),
      this.auth.prisma.auditLog.count({ where }),
    ]);
    return new PaginatedResult(rows, total, query.page, query.limit);
  }
  async enrollmentPolicy(actor: RequestUser, courseId: string, required: boolean) {
    return this.auth.prisma.$transaction(async (tx) => {
      await this.auth.serialize(tx);
      await lockCourse(tx, courseId);
      await this.auth.actor(tx, actor.id, 'courses:update', courseId);
      await this.teacher(actor.id, courseId, 'courses:update');
      const result = await tx.course.update({
        where: { id: courseId },
        data: { enrollment_approval_required: required },
      });
      await auditContent(tx, 'course.enrollment_policy_changed', actor.id, 'course', courseId);
      return { courseId: result.id, requireApproval: result.enrollment_approval_required };
    });
  }
}
