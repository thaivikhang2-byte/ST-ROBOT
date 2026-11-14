import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../../database/prisma.service';
import { BasePolicy } from '../../../shared/sdk/policy/base.policy';
import { RequestUser } from '../../../shared/sdk/auth/interfaces/request-user.interface';
import { assignedCourse } from '../../roles/authorization';

export interface ContentContext {
  params: Record<string, string>;
  body?: { courseId?: string; status?: string };
}

@Injectable()
export class CourseOwnerPolicy extends BasePolicy<ContentContext> {
  constructor(private readonly prisma: PrismaService) {
    super();
  }
  async validate(user: RequestUser, context: ContentContext): Promise<boolean> {
    const id = context.params.id;
    if (!isUUID(id)) return false;
    const course = await this.prisma.course.findUnique({ where: { id } });
    if (!course || course.deleted_at) return false;
    if (context.body?.status === 'published' && !user.permissions.includes('courses:publish'))
      return false;
    return (
      this.isAdmin(user) || this.isOwner(user, course.creator_id) || assignedCourse(user, course.id)
    );
  }
}

@Injectable()
export class CourseReadPolicy extends BasePolicy<ContentContext> {
  constructor(private readonly prisma: PrismaService) {
    super();
  }
  async validate(user: RequestUser, context: ContentContext): Promise<boolean> {
    if (!isUUID(context.params.id)) return false;
    const course = await this.prisma.course.findUnique({ where: { id: context.params.id } });
    return (
      !!course &&
      !course.deleted_at &&
      (course.status === 'published' ||
        this.isAdmin(user) ||
        this.isOwner(user, course.creator_id) ||
        assignedCourse(user, course.id))
    );
  }
}

@Injectable()
export class CourseEnrolledPolicy extends BasePolicy<ContentContext> {
  constructor(private readonly prisma: PrismaService) {
    super();
  }
  async validate(user: RequestUser, context: ContentContext): Promise<boolean> {
    const id = context.params.courseId ?? context.params.id;
    if (!isUUID(id)) return false;
    const course = await this.prisma.course.findUnique({ where: { id } });
    if (!course || course.deleted_at) return false;
    if (
      this.isAdmin(user) ||
      this.isOwner(user, course.creator_id) ||
      assignedCourse(user, course.id)
    )
      return true;
    if (course.status !== 'published') return false;
    return !!(await this.prisma.enrollment.findFirst({
      where: { course_id: id, user_id: user.id, deleted_at: null, status: 'active' },
    }));
  }
}

@Injectable()
export class LessonOwnerPolicy extends BasePolicy<ContentContext> {
  constructor(private readonly prisma: PrismaService) {
    super();
  }
  async validate(user: RequestUser, context: ContentContext): Promise<boolean> {
    let courseId = context.body?.courseId;
    if (context.params.id) {
      if (!isUUID(context.params.id)) return false;
      const lesson = await this.prisma.lesson.findUnique({ where: { id: context.params.id } });
      if (!lesson || lesson.deleted_at) return false;
      courseId = lesson.course_id;
    }
    if (!courseId || !isUUID(courseId)) return false;
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    return (
      !!course &&
      !course.deleted_at &&
      (this.isAdmin(user) ||
        this.isOwner(user, course.creator_id) ||
        assignedCourse(user, course.id))
    );
  }
}

@Injectable()
export class LessonAccessPolicy extends BasePolicy<ContentContext> {
  constructor(private readonly prisma: PrismaService) {
    super();
  }
  async validate(user: RequestUser, context: ContentContext): Promise<boolean> {
    if (!isUUID(context.params.id)) return false;
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: context.params.id },
      include: { course: true },
    });
    if (!lesson || lesson.deleted_at || lesson.course.deleted_at) return false;
    if (
      this.isAdmin(user) ||
      this.isOwner(user, lesson.course.creator_id) ||
      assignedCourse(user, lesson.course.id)
    )
      return true;
    if (lesson.status !== 'published' || lesson.course.status !== 'published') return false;
    return (
      lesson.is_free ||
      !!(await this.prisma.enrollment.findFirst({
        where: {
          course_id: lesson.course_id,
          user_id: user.id,
          deleted_at: null,
          status: 'active',
        },
      }))
    );
  }
}
