import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '../../shared/sdk/errors/domain.exception';
import type { RequestUser } from '../../shared/sdk';
import { assertActive, lockIdentity } from '../auth/identity.repository';
import {
  assignedCourse,
  grantPermissions,
  resolveGrants,
  systemManager,
} from '../roles/authorization';

@Injectable()
export class LearningAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async actor(tx: Prisma.TransactionClient, actor: RequestUser, permission?: string) {
    const identity = await lockIdentity(tx, actor.id);
    assertActive(identity);
    if (
      !actor.sessionId ||
      !(await tx.refreshToken.count({
        where: {
          user_id: actor.id,
          family_id: actor.sessionId,
          is_revoked: false,
          expires_at: { gt: new Date() },
        },
      }))
    )
      throw new UnauthorizedException('Current session is no longer active');
    const grants = resolveGrants(identity);
    const permissions = grantPermissions(grants, actor.scopeCourseId, actor.id);
    if (permission && (!permissions.includes(permission) || !identity.is_email_verified))
      throw new ForbiddenException('Verified account and current permission required');
    return {
      ...actor,
      roleId: identity.role.id,
      roleName: identity.role.name,
      permissions,
      grants,
      isEmailVerified: identity.is_email_verified,
      isActive: identity.is_active,
    };
  }

  async course(userId: string, courseId: string, tx: Prisma.TransactionClient = this.prisma) {
    const course = await tx.course.findFirst({
      where: { id: courseId, deleted_at: null, status: 'published' },
    });
    if (!course) throw new NotFoundException('Published course', courseId);
    const enrollment = await tx.enrollment.findUnique({
      where: { user_id_course_id: { user_id: userId, course_id: courseId } },
    });
    if (
      !enrollment ||
      enrollment.deleted_at ||
      enrollment.status !== 'active' ||
      (enrollment.expires_at && enrollment.expires_at <= new Date())
    )
      throw new ForbiddenException('Active course enrollment required');
    return { course, enrollment };
  }

  async lesson(userId: string, lessonId: string, tx: Prisma.TransactionClient = this.prisma) {
    const lesson = await tx.lesson.findFirst({
      where: { id: lessonId, deleted_at: null, status: 'published' },
    });
    if (!lesson) throw new NotFoundException('Published lesson', lessonId);
    return { lesson, ...(await this.course(userId, lesson.course_id, tx)) };
  }

  async owner(actor: RequestUser, courseId: string, tx: Prisma.TransactionClient = this.prisma) {
    const course = await tx.course.findFirst({ where: { id: courseId, deleted_at: null } });
    if (!course) throw new NotFoundException('Course', courseId);
    if (!systemManager(actor) && course.creator_id !== actor.id && !assignedCourse(actor, courseId))
      throw new ForbiddenException('Course ownership required');
    return course;
  }
}
