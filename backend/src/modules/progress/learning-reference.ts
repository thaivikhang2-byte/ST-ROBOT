import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CurrentUser, Permissions } from '../../shared/sdk';
import type { RequestUser } from '../../shared/sdk';
import { ForbiddenException, NotFoundException } from '../../shared/sdk/errors/domain.exception';
import { PrismaService } from '../../database/prisma.service';
import { ProgressService } from './progress.service';
import { authoredCourseKeys, authoredId } from './authored-id';

@ApiTags('Learning references')
@ApiBearerAuth('access-token')
@Controller('v1/learning/courses')
export class LearningReferenceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly progress: ProgressService,
  ) {}
  @Get(':id/reference')
  @Permissions('learning:read')
  @ApiOperation({
    summary:
      'Authored PDF includes solutions; released only after course completion and all six current authored quizzes passed with review enabled',
  })
  async reference(@CurrentUser() actor: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    const source = authoredCourseKeys.find((key) => authoredId(`course:${key}`) === id);
    if (!source) throw new NotFoundException('Course reference', id);
    const summary = await this.progress.getCourseProgress(actor.id, id);
    if (!summary.isComplete)
      throw new ForbiddenException('Complete this course before opening the solution reference');
    const quizzes = await this.prisma.quiz.findMany({
      where: { lesson: { course_id: id }, status: 'published', deleted_at: null },
      select: { id: true, revision: true, review_answers: true },
    });
    // Imported quiz IDs are bound to their lesson's original source key, kept in material.
    const lessons = await this.prisma.lesson.findMany({
      where: { course_id: id, deleted_at: null, status: 'published' },
      select: { learning_material: true },
    });
    const expected = lessons
      .map((l) => l.learning_material as { sourceId?: string } | null)
      .filter((m) => !!m?.sourceId)
      .map((m) => authoredId(`quiz:${source}:${m!.sourceId}`));
    const gates = quizzes.filter((q) => expected.includes(q.id));
    if (expected.length !== 6 || gates.length !== 6 || gates.some((q) => !q.review_answers))
      throw new ForbiddenException(
        'Solution reference is not available under the current review policy',
      );
    const passed = await this.prisma.quizAttempt.groupBy({
      by: ['quiz_id'],
      where: {
        user_id: actor.id,
        status: 'graded',
        is_passed: true,
        OR: gates.map((q) => ({ quiz_id: q.id, quiz_revision: q.revision })),
      },
    });
    if (passed.length !== 6)
      throw new ForbiddenException('Pass every authored assessment before downloading solutions');
    const pdf = await readFile(path.resolve(process.cwd(), 'prisma/content/pdf', `${source}.pdf`));
    return {
      filename: `${source}-giao-trinh-6-bai.pdf`,
      contentType: 'application/pdf',
      base64: pdf.toString('base64'),
    };
  }
}
