import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AiAgentMode } from '@prisma/client';
import { isUUID } from 'class-validator';
import sanitizeHtml from 'sanitize-html';
import { PrismaService } from '../../../database/prisma.service';
import type { RequestUser } from '../../../shared/sdk';
import { LearningAccessService } from '../../progress/learning-access.service';
import { ProgressService } from '../../progress/progress.service';
import { LearningAnalyticsService } from '../../progress/learning-analytics';
import { QuizzesService } from '../../quizzes/quizzes.service';
import { PaginationQueryDto } from '../../../shared/sdk';
import { systemManager } from '../../roles/authorization';
import type { AgentToolDefinition } from './agent-tool-registry';
import { ownLearningReport, aggregateLearningReports } from './learning-reports';

const uuidSchema = { type: 'string', format: 'uuid' };
const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  requiredPermissions: string[],
): AgentToolDefinition => ({
  name,
  description,
  agentModes: ['EDUCATIONAL'],
  inputSchema: {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  },
  requiredPermissions,
  riskLevel: 'R0',
  requiresConfirmation: false,
  timeoutMs: 5000,
});

export const educationalToolDefinitions: AgentToolDefinition[] = [
  tool(
    'learning_get_lesson',
    'Read permitted lesson text with a first-party source citation; never assessment answer keys.',
    { lessonId: uuidSchema },
    ['lessons:read'],
  ),
  tool(
    'rag_search_authorized_documents',
    'Search published lesson text within an authorized course. Returns bounded source excerpts, not remote URLs or private file bytes.',
    { courseId: uuidSchema, query: { type: 'string', minLength: 1, maxLength: 120 } },
    ['lessons:read'],
  ),
  tool(
    'learning_recommend_next_lesson',
    'Return the authenticated enrolled learner’s actual next lesson and completion counts.',
    { courseId: uuidSchema },
    ['learning:read'],
  ),
  tool(
    'quiz_explain_attempt',
    'Retrieve only the caller’s graded quiz attempt using existing answer-visibility rules.',
    { attemptId: uuidSchema },
    ['quizzes:read'],
  ),
  tool(
    'teacher_get_assigned_courses',
    'List up to twenty courses owned by or explicitly assigned to this teacher; requires a teaching or management grant.',
    {},
    ['courses:read'],
  ),
  tool(
    'teacher_get_class_progress',
    'Read aggregate progress for one owned or assigned course; never return individual student identities to the model.',
    { courseId: uuidSchema },
    ['analytics:read'],
  ),
];

@Injectable()
export class EducationalToolsService {
  constructor(
    private readonly db: PrismaService,
    private readonly access: LearningAccessService,
    private readonly progress: ProgressService,
    private readonly analytics: LearningAnalyticsService,
    private readonly quizzes: QuizzesService,
  ) {}

  handles(name: string) {
    return educationalToolDefinitions.some((tool) => tool.name === name);
  }

  validate(name: string, raw: unknown): Record<string, string> {
    const definition = educationalToolDefinitions.find((tool) => tool.name === name);
    if (!definition || !raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new ForbiddenException('Invalid educational tool');
    const args = raw as Record<string, unknown>;
    const keys = Object.keys(definition.inputSchema.properties ?? {});
    if (
      Object.keys(args).length !== keys.length ||
      Object.keys(args).some((key) => !keys.includes(key))
    )
      throw new ForbiddenException('Unexpected tool arguments');
    const validated: Record<string, string> = {};
    for (const key of keys) {
      const value = args[key];
      if (
        typeof value !== 'string' ||
        (key === 'query' ? !value.trim() || value.length > 120 : !isUUID(value))
      )
        throw new ForbiddenException('Invalid tool argument');
      validated[key] = value.trim();
    }
    return validated;
  }

  private async actor(user: RequestUser, permission: string, courseId?: string) {
    return this.db.$transaction((tx) =>
      this.access.actor(tx, { ...user, scopeCourseId: courseId }, permission),
    );
  }

  private async course(user: RequestUser, courseId: string, permission: string) {
    const actor = await this.actor(user, permission, courseId);
    const course = await this.db.course.findFirst({ where: { id: courseId, deleted_at: null } });
    if (!course) throw new NotFoundException('Course');
    const teaching = actor.grants?.some(
      (grant) =>
        ['TEACHER', 'MANAGER'].includes(grant.group) &&
        grant.permissions.includes(permission) &&
        ((grant.scopeType === 'SYSTEM' &&
          (systemManager(actor) || course.creator_id === actor.id)) ||
          (grant.scopeType === 'COURSE' && grant.scopeId === courseId)),
    );
    if (!teaching) await this.access.course(actor.id, courseId);
    return { actor, course, teaching: !!teaching };
  }

  private text(content: string | null) {
    return sanitizeHtml(content ?? '', { allowedTags: [], allowedAttributes: {} });
  }

  private async assessmentCheck(userId: string, lessonIds: string[]) {
    if (
      await this.db.quizAttempt.count({
        where: {
          user_id: userId,
          quiz: { lesson_id: { in: lessonIds } },
          status: 'in_progress',
          OR: [{ deadline_at: null }, { deadline_at: { gt: new Date() } }],
        },
      })
    ) {
      throw new ConflictException(
        'Submit the active lesson assessment before retrieving tutor context',
      );
    }
  }

  async execute(
    user: RequestUser,
    mode: AiAgentMode,
    name: string,
    raw: unknown,
    conversationScope?: string,
  ): Promise<unknown> {
    if (mode !== 'EDUCATIONAL') throw new ForbiddenException('Educational partition required');
    const args = this.validate(name, raw);
    if (name === 'teacher_get_assigned_courses') {
      const actor = await this.actor(user, 'courses:read', conversationScope);
      const grants = (actor.grants ?? []).filter(
        (g) => ['TEACHER', 'MANAGER'].includes(g.group) && g.permissions.includes('courses:read'),
      );
      if (!grants.length) throw new ForbiddenException('Teaching grant required');
      const assigned = grants.filter((g) => g.scopeType === 'COURSE').map((g) => g.scopeId);
      const where = {
        deleted_at: null,
        ...(conversationScope ? { id: conversationScope } : {}),
        ...(!systemManager(actor)
          ? { OR: [{ creator_id: actor.id }, { id: { in: assigned } }] }
          : {}),
      };
      return {
        courses: await this.db.course.findMany({
          where,
          select: { id: true, title: true, status: true },
          orderBy: { id: 'asc' },
          take: 20,
        }),
        limit: 20,
      };
    }
    if (name === 'quiz_explain_attempt') {
      const attempt = await this.db.quizAttempt.findUnique({
        where: { id: args.attemptId },
        select: {
          user_id: true,
          status: true,
          quiz: { select: { lesson: { select: { course_id: true } } } },
        },
      });
      if (!attempt || attempt.user_id !== user.id)
        throw new NotFoundException('Own graded attempt');
      const courseId = attempt.quiz.lesson.course_id;
      if (conversationScope && conversationScope !== courseId)
        throw new ForbiddenException('Conversation course mismatch');
      const actor = await this.actor(user, 'quizzes:read', courseId);
      if (attempt.status !== 'graded')
        throw new ConflictException('Only completed graded attempts may be explained');
      return this.quizzes.getAttempt(args.attemptId, actor);
    }
    let courseId = args.courseId;
    let lesson: Awaited<ReturnType<PrismaService['lesson']['findFirst']>> = null;
    if (name === 'learning_get_lesson') {
      lesson = await this.db.lesson.findFirst({
        where: { id: args.lessonId, deleted_at: null, status: 'published' },
      });
      if (!lesson) throw new NotFoundException('Published lesson');
      courseId = lesson.course_id;
    }
    if (conversationScope && conversationScope !== courseId)
      throw new ForbiddenException('Conversation course mismatch');
    const permission =
      name === 'teacher_get_class_progress'
        ? 'analytics:read'
        : name === 'learning_recommend_next_lesson'
          ? 'learning:read'
          : 'lessons:read';
    const { actor, course, teaching } = await this.course(user, courseId, permission);
    if (name === 'learning_get_lesson' && lesson) {
      if (course.status !== 'published') throw new NotFoundException('Published course');
      await this.assessmentCheck(actor.id, [lesson.id]);
      return {
        courseId,
        lessonId: lesson.id,
        title: lesson.title,
        content: this.text(lesson.content).slice(0, 6000),
        source: {
          type: 'lesson',
          id: lesson.id,
          href: `/course.learning.html?course=${courseId}&lesson=${lesson.id}`,
        },
        untrustedReference: true,
      };
    }
    if (name === 'rag_search_authorized_documents') {
      if (course.status !== 'published') throw new NotFoundException('Published course');
      const lessons = await this.db.lesson.findMany({
        where: {
          course_id: courseId,
          status: 'published',
          deleted_at: null,
          OR: [
            { title: { contains: args.query, mode: 'insensitive' } },
            { content: { contains: args.query, mode: 'insensitive' } },
          ],
        },
        orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
        take: 5,
        select: { id: true, title: true, content: true },
      });
      await this.assessmentCheck(
        actor.id,
        lessons.map((row) => row.id),
      );
      return {
        retrieval: 'keyword',
        sources: lessons.map((row) => {
          const text = this.text(row.content);
          const match = text.toLowerCase().indexOf(args.query.toLowerCase());
          return {
            id: row.id,
            title: row.title,
            excerpt: text.slice(Math.max(0, match - 160), Math.max(0, match - 160) + 1200),
            href: `/course.learning.html?course=${courseId}&lesson=${row.id}`,
          };
        }),
        untrustedReference: true,
      };
    }
    if (name === 'learning_recommend_next_lesson') {
      const summary = await this.progress.getCourseProgress(actor.id, courseId);
      return {
        courseId,
        nextLessonId: summary.resumeLessonId,
        completedLessons: summary.completedLessons,
        totalLessons: summary.totalLessons,
        selfReportedLearning: await ownLearningReport(this.db, actor.id, courseId),
        notice: 'nextLessonId comes from server lesson records. Synchronized browser reports are separate self-reports and may have a different completion state.',
      };
    }
    if (name === 'teacher_get_class_progress') {
      if (!teaching) throw new ForbiddenException('Assigned teaching scope required');
      const query = new PaginationQueryDto();
      query.page = 1;
      query.limit = 1;
      const summary = await this.analytics.course(
        { ...actor, requiredPermissions: ['analytics:read'] },
        courseId,
        query,
      );
      return {
        courseId,
        enrolledStudents: summary.enrolledStudents,
        gradedAttempts: summary.gradedAttempts,
        averageScore: summary.averageScore,
        selfReportedLearning: await aggregateLearningReports(this.db, { id: courseId, slug: course.slug }),
      };
    }
    throw new ForbiddenException('Unknown educational tool');
  }
}
