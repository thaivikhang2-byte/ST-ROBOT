// ═══════════════════════════════════════════
// Lessons — Service (Full Implementation)
// ═══════════════════════════════════════════

import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Course, Lesson, Quiz, Video } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { EventBusService } from '../../shared/sdk/events/event-bus.service';
import { PaginationQueryDto, PaginatedResult, buildPrismaQuery } from '../../shared/sdk';
import { NotFoundException } from '../../shared/sdk/errors/domain.exception';
import { CreateLessonDto, UpdateLessonDto, ReorderLessonsDto } from './dto/lesson.dto';
import {
  auditContent,
  checkPublishedCourse,
  cleanContent,
  hasContent,
  lockCourse,
} from '../courses/content-integrity';
import { LessonCompletedEvent } from './events/lesson.events';
import { RequestUser } from '../../shared/sdk/auth/interfaces/request-user.interface';
import { ProgressService } from '../progress/progress.service';
import { systemManager } from '../roles/authorization';

type LessonView = Lesson & {
  _count?: { videos: number; quizzes: number };
  course?: Pick<Course, 'id' | 'title' | 'slug'>;
  videos?: Pick<Video, 'id' | 'title' | 'duration_seconds' | 'status' | 'sort_order'>[];
  quizzes?: Pick<Quiz, 'id' | 'title' | 'pass_score' | 'time_limit'>[];
};

@Injectable()
export class LessonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly progressService: ProgressService,
  ) {}

  async findByCourse(courseId: string, query: PaginationQueryDto, user: RequestUser) {
    const { skip, take } = buildPrismaQuery(query);
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    const privileged =
      systemManager(user) ||
      course?.creator_id === user.id ||
      user.grants?.some(
        (g) =>
          g.scopeType === 'COURSE' &&
          g.scopeId === courseId &&
          ['TEACHER', 'MANAGER'].includes(g.group) &&
          g.permissions.includes('lessons:read'),
      );
    const where = {
      course_id: courseId,
      deleted_at: null,
      ...(!privileged ? { status: 'published' } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.lesson.findMany({
        where,
        skip,
        take,
        orderBy: { sort_order: 'asc' },
        include: {
          _count: { select: { videos: true, quizzes: true } },
        },
      }),
      this.prisma.lesson.count({ where }),
    ]);

    return new PaginatedResult(
      data.map((l) => this.mapLesson(l)),
      total,
      query.page,
      query.limit,
    );
  }

  async findById(id: string) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id },
      include: {
        course: { select: { id: true, title: true, slug: true, creator_id: true } },
        videos: {
          where: { deleted_at: null },
          orderBy: { sort_order: 'asc' },
          select: { id: true, title: true, duration_seconds: true, status: true, sort_order: true },
        },
        quizzes: {
          where: { deleted_at: null, status: 'published' },
          orderBy: { sort_order: 'asc' },
          select: { id: true, title: true, pass_score: true, time_limit: true },
        },
      },
    });

    if (!lesson || lesson.deleted_at) {
      throw new NotFoundException('Lesson', id);
    }

    return this.mapLessonDetail(lesson);
  }

  async create(dto: CreateLessonDto, actor: RequestUser) {
    return this.prisma.$transaction(async (tx) => {
      await lockCourse(tx, dto.courseId, actor);
      if (!dto.title.trim()) throw new BadRequestException('Lesson title is required');

      // Auto-assign sort order if not provided
      let sortOrder = dto.sortOrder ?? 0;
      if (sortOrder === 0) {
        const lastLesson = await tx.lesson.findFirst({
          where: { course_id: dto.courseId, deleted_at: null },
          orderBy: { sort_order: 'desc' },
        });
        sortOrder = (lastLesson?.sort_order ?? 0) + 1;
      }

      await this.checkOrder(tx, dto.courseId, sortOrder);
      const lesson = await tx.lesson.create({
        data: {
          title: dto.title.trim(),
          content: dto.content === undefined ? undefined : cleanContent(dto.content),
          course_id: dto.courseId,
          sort_order: sortOrder,
          is_free: dto.isFree ?? false,
          is_required: dto.isRequired ?? true,
          status: 'draft',
        },
        include: { _count: { select: { videos: true, quizzes: true } } },
      });

      await auditContent(tx, 'lesson.created', actor.id, 'lesson', lesson.id);
      await tx.course.update({
        where: { id: dto.courseId },
        data: { content_version: { increment: 1 } },
      });
      return this.mapLesson(lesson);
    });
  }

  async update(id: string, dto: UpdateLessonDto, actor: RequestUser) {
    const lesson = await this.prisma.lesson.findUnique({ where: { id } });
    if (!lesson || lesson.deleted_at) {
      throw new NotFoundException('Lesson', id);
    }

    return this.prisma.$transaction(async (tx) => {
      await lockCourse(tx, lesson.course_id, actor);
      const current = await tx.lesson.findUniqueOrThrow({ where: { id } });
      if (current.deleted_at) throw new NotFoundException('Lesson', id);
      const data: Prisma.LessonUncheckedUpdateInput = {};
      if (dto.title !== undefined) {
        if (!dto.title.trim()) throw new BadRequestException('Lesson title is required');
        data.title = dto.title.trim();
      }
      if (dto.content !== undefined) {
        data.content = cleanContent(dto.content);
        data.learning_material = Prisma.DbNull;
      }
      if (dto.status !== undefined) data.status = dto.status;
      if (dto.sortOrder !== undefined) data.sort_order = dto.sortOrder;
      if (dto.isFree !== undefined) data.is_free = dto.isFree;
      if (dto.isRequired !== undefined) data.is_required = dto.isRequired;
      if (dto.sortOrder !== undefined)
        await this.checkOrder(tx, lesson.course_id, dto.sortOrder, id);
      if (
        (dto.status ?? current.status) === 'published' &&
        !hasContent(dto.content === undefined ? current.content : cleanContent(dto.content))
      )
        throw new BadRequestException('Published lessons require content');

      const updated = await tx.lesson.update({
        where: { id },
        data,
        include: { _count: { select: { videos: true, quizzes: true } } },
      });

      await checkPublishedCourse(tx, lesson.course_id);
      await auditContent(tx, 'lesson.updated', actor.id, 'lesson', id);
      await tx.course.update({
        where: { id: lesson.course_id },
        data: { content_version: { increment: 1 } },
      });
      return this.mapLesson(updated);
    });
  }

  async delete(id: string, actor: RequestUser): Promise<void> {
    const lesson = await this.prisma.lesson.findUnique({ where: { id } });
    if (!lesson || lesson.deleted_at) {
      throw new NotFoundException('Lesson', id);
    }

    await this.prisma.$transaction(async (tx) => {
      await lockCourse(tx, lesson.course_id, actor);
      const current = await tx.lesson.findUniqueOrThrow({ where: { id } });
      if (current.deleted_at) throw new NotFoundException('Lesson', id);
      await tx.lesson.update({
        where: { id },
        data: { deleted_at: new Date() },
      });
      await checkPublishedCourse(tx, lesson.course_id);
      await auditContent(tx, 'lesson.deleted', actor.id, 'lesson', id);
      await tx.course.update({
        where: { id: lesson.course_id },
        data: { content_version: { increment: 1 } },
      });
    });
  }

  async reorder(courseId: string, dto: ReorderLessonsDto, actor: RequestUser) {
    return this.prisma.$transaction(async (tx) => {
      await lockCourse(tx, courseId, actor);
      const lessons = await tx.lesson.findMany({
        where: { course_id: courseId, deleted_at: null },
        select: { id: true },
      });
      const ids = new Set(lessons.map((lesson) => lesson.id));
      if (ids.size !== dto.lessonIds.length || dto.lessonIds.some((id) => !ids.has(id)))
        throw new BadRequestException('Supply every active lesson in this course exactly once');
      for (const [index, id] of dto.lessonIds.entries()) {
        await tx.lesson.update({ where: { id }, data: { sort_order: index + 1 } });
      }
      await auditContent(tx, 'lesson.reordered', actor.id, 'course', courseId);
      await tx.course.update({
        where: { id: courseId },
        data: { content_version: { increment: 1 } },
      });
      return { courseId, lessonIds: dto.lessonIds };
    });
  }

  private async checkOrder(
    tx: Prisma.TransactionClient,
    courseId: string,
    order: number,
    excludeId?: string,
  ) {
    if (
      await tx.lesson.count({
        where: {
          course_id: courseId,
          deleted_at: null,
          sort_order: order,
          ...(excludeId ? { NOT: { id: excludeId } } : {}),
        },
      })
    )
      throw new BadRequestException('Lesson position is occupied; use the course reorder endpoint');
  }

  async markComplete(lessonId: string, actor: RequestUser) {
    const lesson = await this.prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson || lesson.deleted_at) {
      throw new NotFoundException('Lesson', lessonId);
    }

    const result = await this.progressService.record(actor, lessonId, true);
    this.eventBus.emit(new LessonCompletedEvent(lessonId, actor.id, lesson.course_id));
    return result;
  }

  private mapLesson(l: LessonView) {
    return {
      id: l.id,
      title: l.title,
      sortOrder: l.sort_order,
      isFree: l.is_free,
      isRequired: l.is_required,
      status: l.status,
      videoCount: l._count?.videos ?? 0,
      quizCount: l._count?.quizzes ?? 0,
      createdAt: l.created_at,
      updatedAt: l.updated_at,
    };
  }

  private mapLessonDetail(l: LessonView) {
    return {
      ...this.mapLesson(l),
      content: l.content,
      material: l.learning_material,
      course: l.course
        ? { id: l.course.id, title: l.course.title, slug: l.course.slug }
        : undefined,
      videos: l.videos?.map((v) => ({
        id: v.id,
        title: v.title,
        durationSeconds: v.duration_seconds,
        status: v.status,
        sortOrder: v.sort_order,
      })),
      quizzes: l.quizzes?.map((q) => ({
        id: q.id,
        title: q.title,
        passScore: q.pass_score,
        timeLimit: q.time_limit,
      })),
    };
  }
}
