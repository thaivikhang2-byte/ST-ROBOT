import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import sanitizeHtml from 'sanitize-html';
import { NotFoundException } from '../../shared/sdk/errors/domain.exception';
import type { RequestUser } from '../../shared/sdk';
import { assignedCourse, systemManager } from '../roles/authorization';

export function cleanContent(content: string): string {
  return sanitizeHtml(content, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'em',
      'b',
      'i',
      'u',
      'h1',
      'h2',
      'h3',
      'h4',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'a',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'hr',
    ],
    allowedAttributes: { a: ['href', 'title'] },
    allowedSchemes: ['https', 'mailto'],
    allowProtocolRelative: false,
  });
}

export function hasContent(content: string | null | undefined): boolean {
  return !!sanitizeHtml(content ?? '', { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// Every course/lesson write takes the same parent lock before checking invariants.
export async function lockCourse(tx: Prisma.TransactionClient, id: string, actor?: RequestUser) {
  const locked = await tx.course.updateMany({
    where: { id, deleted_at: null },
    data: { sort_order: { increment: 0 } },
  });
  if (locked.count !== 1) throw new NotFoundException('Course', id);
  const course = await tx.course.findUniqueOrThrow({ where: { id } });
  if (
    actor &&
    !systemManager(actor) &&
    course.creator_id !== actor.id &&
    !assignedCourse(actor, id)
  )
    throw new ForbiddenException('Course ownership required');
  return course;
}

export async function checkPublishedCourse(tx: Prisma.TransactionClient, courseId: string) {
  const course = await tx.course.findUniqueOrThrow({
    where: { id: courseId },
    include: { creator: true, category: true },
  });
  if (course.status !== 'published') return;
  if (!hasContent(course.title) || !hasContent(course.description))
    throw new BadRequestException('A published course requires a title and description');
  if (!course.creator.is_active || course.creator.deleted_at)
    throw new BadRequestException('Course creator is inactive');
  if (course.category && (!course.category.is_active || course.category.deleted_at))
    throw new BadRequestException('Course category is inactive');
  const lessons = await tx.lesson.findMany({
    where: { course_id: courseId, deleted_at: null, status: 'published' },
    select: { content: true },
  });
  if (!lessons.length || lessons.some((lesson) => !hasContent(lesson.content)))
    throw new BadRequestException('A published course requires published lessons with content');
}

export async function checkCategory(tx: Prisma.TransactionClient, id: string | null | undefined) {
  if (!id) return;
  const changed = await tx.category.updateMany({
    where: { id, deleted_at: null, is_active: true },
    data: { sort_order: { increment: 0 } },
  });
  if (changed.count !== 1) throw new BadRequestException('Category must exist and be active');
}

export async function auditContent(
  tx: Prisma.TransactionClient,
  action: string,
  userId: string,
  resource: string,
  id: string,
) {
  await tx.auditLog.create({ data: { user_id: userId, action, resource, resource_id: id } });
}
