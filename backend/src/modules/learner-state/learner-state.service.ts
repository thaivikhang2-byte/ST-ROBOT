import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ConflictException, ForbiddenException, NotFoundException, PaginatedResult, PaginationQueryDto, RequestUser } from '../../shared/sdk';
import { LearningAccessService } from '../progress/learning-access.service';
import { grantPermissions } from '../roles/authorization';
import { LearnerActivityDto, LearnerManagementQueryDto, SaveLearnerStateDto } from './learner-state.dto';
import { summarizeValues, validateActivityCourse, validateValues } from './learner-state.policy';

@Injectable()
export class LearnerStateService {
  constructor(private readonly prisma: PrismaService, private readonly access: LearningAccessService) {}

  async get(actor: RequestUser) {
    const row = await this.prisma.learnerState.findUnique({ where: { user_id: actor.id } });
    return row ? { revision: row.revision, values: row.values, updatedAt: row.updated_at } : { revision: 0, values: {}, updatedAt: null };
  }

  async save(actor: RequestUser, dto: SaveLearnerStateDto) {
    const values = validateValues(dto.values);
    const summary = summarizeValues(values);
    return this.prisma.$transaction(async tx => {
      // The identity row lock also serializes first-write races and revocation with this save.
      await this.access.actor(tx, actor, 'learning:update');
      const previous = await tx.learnerState.findUnique({ where: { user_id: actor.id } });
      if ((previous?.revision ?? 0) !== dto.revision) throw new ConflictException('LEARNER_STATE_REVISION_CONFLICT: fetch the latest revision before saving; your local work has not been changed');
      const data = { values, summary, revision: dto.revision + 1 };
      const row = previous
        ? await tx.learnerState.update({ where: { user_id: actor.id }, data })
        : await tx.learnerState.create({ data: { user_id: actor.id, ...data } });
      await tx.auditLog.create({ data: {
        user_id: actor.id,
        action: 'learner.state_synced',
        resource: 'learner_state',
        resource_id: actor.id,
        new_data: { revision: row.revision, keys: Object.keys(values), source: 'learner-self-report' },
      } });
      return { revision: row.revision, values: row.values, updatedAt: row.updated_at };
    });
  }

  async activity(actor: RequestUser, dto: LearnerActivityDto) {
    validateActivityCourse(dto.courseId, dto.lessonId);
    return this.prisma.$transaction(async tx => {
      await this.access.actor(tx, actor, 'learning:update');
      const row = await tx.auditLog.create({ data: {
        user_id: actor.id,
        action: `learner.${dto.action}`,
        resource: 'learner_activity',
        resource_id: dto.courseId ?? null,
        new_data: { source: 'learner-self-report', ...(dto.courseId ? { courseId: dto.courseId } : {}), ...(dto.lessonId ? { lessonId: dto.lessonId } : {}) },
      }, select: { id: true, action: true, created_at: true } });
      return { id: row.id, action: dto.action, recordedAt: row.created_at, source: 'learner-self-report' };
    });
  }

  async history(actor: RequestUser, query: PaginationQueryDto) {
    const where = { user_id: actor.id, resource: { in: ['learner_state', 'learner_activity'] } };
    const [rows, count] = await Promise.all([
      this.prisma.auditLog.findMany({ where, skip: query.skip, take: query.take, orderBy: [{ created_at: 'desc' }, { id: 'asc' }], select: { id: true, action: true, created_at: true, resource_id: true, new_data: true } }),
      this.prisma.auditLog.count({ where }),
    ]);
    return new PaginatedResult(rows.map(row => ({ id: row.id, action: row.action, recordedAt: row.created_at, details: row.new_data })), count, query.page, query.limit);
  }

  async management(actor: RequestUser, query: LearnerManagementQueryDto) {
    return this.prisma.$transaction(async tx => {
      const current = await this.access.actor(tx, actor);
      const grants = current.grants ?? [];
      if (!current.isEmailVerified || !grantPermissions(grants, query.courseId, actor.id).includes('analytics:read')) throw new ForbiddenException('Verified analytics authority required');
      const system = grants.some(grant => grant.group === 'MANAGER' && grant.scopeType === 'SYSTEM' && grant.permissions.includes('analytics:read'));
      let slug: string | undefined;
      if (query.courseId) {
        const course = await tx.course.findFirst({ where: { id: query.courseId, deleted_at: null }, select: { id: true, slug: true, creator_id: true } });
        if (!course) throw new NotFoundException('Course');
        const assigned = grants.some(grant => ['TEACHER', 'MANAGER'].includes(grant.group) && grant.scopeType === 'COURSE' && grant.scopeId === course.id && grant.permissions.includes('analytics:read'));
        const owner = course.creator_id === actor.id && grants.some(grant => grant.group === 'TEACHER' && grant.scopeType === 'SYSTEM' && grant.permissions.includes('analytics:read'));
        if (!system && !assigned && !owner) throw new ForbiddenException('Course analytics assignment required');
        slug = course.slug;
      } else if (!system) throw new ForbiddenException('Select an authorized course');
      const where: Prisma.LearnerStateWhereInput = { user: { deleted_at: null, is_active: true, ...(query.courseId ? { enrollments: { some: { course_id: query.courseId, status: 'active', deleted_at: null, OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }] } } } : {}) } };
      const [rows, count] = await Promise.all([
        tx.learnerState.findMany({ where, skip: query.skip, take: query.take, orderBy: [{ updated_at: 'desc' }, { user_id: 'asc' }], select: { user_id: true, revision: true, updated_at: true, summary: true, user: { select: { first_name: true, last_name: true } } } }),
        tx.learnerState.count({ where }),
      ]);
      const data = rows.map(row => {
        const summary = row.summary as ReturnType<typeof summarizeValues>;
        return { userId: row.user_id, displayName: `${row.user.first_name} ${row.user.last_name}`.trim(), revision: row.revision, updatedAt: row.updated_at, source: 'learner-self-report', courses: (summary.courses ?? []).filter(course => !slug || course.courseId === slug) };
      });
      return new PaginatedResult(data, count, query.page, query.limit);
    });
  }
}
