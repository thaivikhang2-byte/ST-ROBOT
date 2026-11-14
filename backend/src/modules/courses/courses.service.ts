// ═══════════════════════════════════════════
// Courses — Service (Full Implementation)
// ═══════════════════════════════════════════

import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Course, Lesson, User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { EventBusService } from '../../shared/sdk/events/event-bus.service';
import { PaginationQueryDto, PaginatedResult, buildPrismaQuery } from '../../shared/sdk';
import { NotFoundException, ConflictException } from '../../shared/sdk/errors/domain.exception';
import { CreateCourseDto, UpdateCourseDto, CourseQueryDto } from './dto/course.dto';
import {
  CourseCreatedEvent,
  CoursePublishedEvent,
  CourseDeletedEvent,
} from './events/course.events';
import {
  auditContent,
  checkCategory,
  checkPublishedCourse,
  cleanContent,
  lockCourse,
} from './content-integrity';

import type { RequestUser } from '../../shared/sdk';
type CourseView = Course & {
  creator?: Pick<User, 'id' | 'first_name' | 'last_name'>;
  _count?: { lessons?: number; enrollments?: number };
  lessons?: Pick<Lesson, 'id' | 'title' | 'sort_order' | 'is_free' | 'status'>[];
};

@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  async findAll(query: CourseQueryDto, creatorId?: string, actor?: RequestUser) {
    const { skip, take } = buildPrismaQuery(query);
    const orderBy = this.orderBy(query);
    const scoped =
      actor && !actor.grants?.some((g) => g.group === 'MANAGER' && g.scopeType === 'SYSTEM');
    // Preserve the legacy teacher API: a forged creator filter cannot suppress or widen the authorized list.
    const selectedCreator = scoped ? undefined : (creatorId ?? query.creatorId);

    const where: Prisma.CourseWhereInput = {
      deleted_at: null,
      ...(selectedCreator ? { creator_id: selectedCreator } : {}),
    };
    if (scoped && actor) {
      where.AND = [
        {
          OR: [
            { creator_id: actor.id },
            {
              id: {
                in:
                  actor.grants
                    ?.filter(
                      (g) => g.scopeType === 'COURSE' && g.permissions.includes('courses:read'),
                    )
                    .map((g) => g.scopeId) ?? [],
              },
            },
          ],
        },
      ];
    }
    if (query.categoryId) where.category_id = query.categoryId;
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.course.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          creator: { select: { id: true, first_name: true, last_name: true } },
          _count: { select: { lessons: true, enrollments: true } },
        },
      }),
      this.prisma.course.count({ where }),
    ]);

    return new PaginatedResult(
      data.map((c) => this.mapCourse(c)),
      total,
      query.page,
      query.limit,
    );
  }

  async findPublished(query: CourseQueryDto) {
    const { skip, take } = buildPrismaQuery(query);
    const orderBy = this.orderBy(query);

    const where: Prisma.CourseWhereInput = { deleted_at: null, status: 'published' };
    if (query.categoryId) where.category_id = query.categoryId;
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.course.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          creator: { select: { id: true, first_name: true, last_name: true } },
          _count: { select: { lessons: true, enrollments: true } },
        },
      }),
      this.prisma.course.count({ where }),
    ]);

    return new PaginatedResult(
      data.map((c) => this.mapCourse(c)),
      total,
      query.page,
      query.limit,
    );
  }

  async findById(id: string) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, first_name: true, last_name: true, email: true } },
        lessons: {
          where: { deleted_at: null, status: 'published' },
          orderBy: { sort_order: 'asc' },
          select: { id: true, title: true, sort_order: true, is_free: true, status: true },
        },
        _count: { select: { enrollments: true } },
      },
    });

    if (!course || course.deleted_at) {
      throw new NotFoundException('Course', id);
    }

    return this.mapCourseDetail(course);
  }

  async findBySlug(slug: string) {
    const course = await this.prisma.course.findUnique({
      where: { slug, status: 'published', deleted_at: null },
      include: {
        creator: { select: { id: true, first_name: true, last_name: true } },
        lessons: {
          where: { deleted_at: null, status: 'published' },
          orderBy: { sort_order: 'asc' },
          select: { id: true, title: true, sort_order: true, is_free: true, status: true },
        },
        _count: { select: { enrollments: true } },
      },
    });

    if (!course || course.deleted_at) {
      throw new NotFoundException('Course', slug);
    }

    return this.mapCourseDetail(course);
  }

  async create(dto: CreateCourseDto, creatorId: string) {
    const slug = await this.generateUniqueSlug(dto.title);
    if (!dto.title.trim()) throw new BadRequestException('Course title is required');
    const course = await this.write(async (tx) => {
      await checkCategory(tx, dto.categoryId);
      const result = await tx.course.create({
        data: {
          title: dto.title.trim(),
          slug,
          description: dto.description === undefined ? undefined : cleanContent(dto.description),
          thumbnail_url: dto.thumbnailUrl,
          creator_id: creatorId,
          category_id: dto.categoryId,
          status: 'draft',
        },
        include: {
          creator: { select: { id: true, first_name: true, last_name: true } },
          _count: { select: { lessons: true, enrollments: true } },
        },
      });
      await auditContent(tx, 'course.created', creatorId, 'course', result.id);
      return result;
    });

    this.eventBus.emit(new CourseCreatedEvent(course.id, creatorId));

    return this.mapCourse(course);
  }

  async createAgentDraftInTransaction(
    tx: Prisma.TransactionClient,
    input: { title: string; description: string },
    creatorId: string,
    proposalId: string,
  ) {
    const slug = await this.generateUniqueSlug(`${input.title}-${proposalId.slice(0, 8)}`);
    const course = await tx.course.create({
      data: {
        title: input.title.trim(),
        slug,
        description: cleanContent(input.description),
        creator_id: creatorId,
        status: 'draft',
        ai_action_proposal_id: proposalId,
      },
      select: { id: true, title: true, slug: true, status: true },
    });
    await auditContent(tx, 'course.created', creatorId, 'course', course.id);
    return course;
  }

  emitAgentCourseCreated(courseId: string, creatorId: string) {
    this.eventBus.emit(new CourseCreatedEvent(courseId, creatorId));
  }

  async updateAgentCourseInfoInTransaction(
    tx: Prisma.TransactionClient,
    courseId: string,
    input: { title: string; description: string },
    actor: RequestUser,
    proposalId: string,
  ) {
    await lockCourse(tx, courseId, actor);
    const slug = await this.generateUniqueSlug(input.title, courseId);
    const updated = await tx.course.update({
      where: { id: courseId },
      data: {
        title: input.title.trim(),
        slug,
        description: cleanContent(input.description),
        content_version: { increment: 1 },
      },
      select: { id: true, title: true, slug: true, status: true, content_version: true },
    });
    await checkPublishedCourse(tx, courseId);
    await auditContent(tx, `course.updated.ai:${proposalId.slice(0, 8)}`, actor.id, 'course', courseId);
    return updated;
  }

  async publishAgentCourseInTransaction(
    tx: Prisma.TransactionClient,
    courseId: string,
    actor: RequestUser,
    proposalId: string,
  ) {
    await lockCourse(tx, courseId, actor);
    const updated = await tx.course.update({
      where: { id: courseId },
      data: {
        status: 'published',
        content_version: { increment: 1 },
      },
      select: { id: true, title: true, slug: true, status: true, content_version: true },
    });
    await checkPublishedCourse(tx, courseId);
    await auditContent(tx, `course.published.ai:${proposalId.slice(0, 8)}`, actor.id, 'course', courseId);
    return updated;
  }

  emitAgentCoursePublished(courseId: string, userId: string) {
    this.eventBus.emit(new CoursePublishedEvent(courseId, userId));
  }

  async update(id: string, dto: UpdateCourseDto, userId: string) {
    const slug = dto.title === undefined ? undefined : await this.generateUniqueSlug(dto.title, id);
    let published = false;
    const updated = await this.write(async (tx) => {
      const course = await lockCourse(tx, id);
      await checkCategory(tx, dto.categoryId === undefined ? course.category_id : dto.categoryId);
      const data: Prisma.CourseUncheckedUpdateInput = { content_version: { increment: 1 } };
      if (dto.title !== undefined) {
        if (!dto.title.trim()) throw new BadRequestException('Course title is required');
        data.title = dto.title.trim();
        data.slug = slug;
      }
      if (dto.description !== undefined) data.description = cleanContent(dto.description);
      if (dto.thumbnailUrl !== undefined) data.thumbnail_url = dto.thumbnailUrl;
      if (dto.sortOrder !== undefined) data.sort_order = dto.sortOrder;
      if (dto.categoryId !== undefined) data.category_id = dto.categoryId;

      // Status transitions
      if (dto.status !== undefined) {
        data.status = dto.status;
        if (dto.status === 'published' && course.status !== 'published') {
          published = true;
        }
      }

      const result = await tx.course.update({
        where: { id },
        data,
        include: {
          creator: { select: { id: true, first_name: true, last_name: true } },
          _count: { select: { lessons: true, enrollments: true } },
        },
      });

      await checkPublishedCourse(tx, id);
      await auditContent(
        tx,
        dto.status ? `course.${dto.status}` : 'course.updated',
        userId,
        'course',
        id,
      );
      return result;
    });
    if (published) this.eventBus.emit(new CoursePublishedEvent(id, userId));
    return this.mapCourse(updated);
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.write(async (tx) => {
      await lockCourse(tx, id);
      await tx.course.update({
        where: { id },
        data: { deleted_at: new Date() },
      });
      await auditContent(tx, 'course.deleted', userId, 'course', id);
    });

    this.eventBus.emit(new CourseDeletedEvent(id, userId));
  }

  // ── Helpers ─────────────────────────────

  private async generateUniqueSlug(title: string, excludeId?: string): Promise<string> {
    let slug =
      title
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, 'd')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 210) || `course-${randomUUID()}`;

    const where: Prisma.CourseWhereInput = { slug };
    if (excludeId) {
      where.NOT = { id: excludeId };
    }

    const existing = await this.prisma.course.findFirst({ where });
    if (existing) {
      slug = `${slug}-${randomUUID().slice(0, 8)}`;
    }

    return slug;
  }

  private orderBy(query: PaginationQueryDto): Prisma.CourseOrderByWithRelationInput {
    const sort = query.sort ?? 'created_at';
    if (!['title', 'created_at', 'updated_at', 'sort_order', 'status'].includes(sort))
      throw new BadRequestException('Unsupported course sort field');
    return { [sort]: query.order };
  }

  private async write<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await this.prisma.$transaction(callback);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Course slug already exists; retry with a different title');
      throw error;
    }
  }

  private mapCourse(c: CourseView) {
    return {
      id: c.id,
      title: c.title,
      slug: c.slug,
      description: c.description,
      thumbnailUrl: c.thumbnail_url,
      status: c.status,
      categoryId: c.category_id,
      sortOrder: c.sort_order,
      creator: c.creator
        ? { id: c.creator.id, name: `${c.creator.first_name} ${c.creator.last_name}` }
        : undefined,
      lessonCount: c._count?.lessons ?? 0,
      enrollmentCount: c._count?.enrollments ?? 0,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    };
  }

  private mapCourseDetail(c: CourseView) {
    return {
      ...this.mapCourse(c),
      lessons: c.lessons?.map((l) => ({
        id: l.id,
        title: l.title,
        sortOrder: l.sort_order,
        isFree: l.is_free,
        status: l.status,
      })),
    };
  }
}
