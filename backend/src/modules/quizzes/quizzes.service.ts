import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginationQueryDto, PaginatedResult } from '../../shared/sdk';
import type { RequestUser } from '../../shared/sdk';
import { PrismaService } from '../../database/prisma.service';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '../../shared/sdk/errors/domain.exception';
import { lockCourse, auditContent } from '../courses/content-integrity';
import { LearningAccessService } from '../progress/learning-access.service';
import { ProgressService } from '../progress/progress.service';
import {
  CreateQuizDto,
  UpdateQuizDto,
  QuizListDto,
  SubmitQuizDto,
  ManualGradeDto,
} from './quiz.dto';
import {
  canonicalAnswers,
  finalScore,
  gradeObjective,
  learnerQuestion,
  QuizSnapshot,
  SnapshotQuestion,
  submissionHash,
  validateQuestions,
} from './quiz-grading';

const quizInclude = {
  questions: { where: { deleted_at: null }, orderBy: { sort_order: 'asc' as const } },
  lesson: true,
} satisfies Prisma.QuizInclude;
type QuizWithQuestions = Prisma.QuizGetPayload<{ include: typeof quizInclude }>;
const attemptInclude = {
  answers: true,
  quiz: { include: { lesson: true } },
} satisfies Prisma.QuizAttemptInclude;
type Attempt = Prisma.QuizAttemptGetPayload<{ include: typeof attemptInclude }>;

@Injectable()
export class QuizzesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: LearningAccessService,
    private readonly progress: ProgressService,
  ) {}

  private snapshot(quiz: QuizWithQuestions): QuizSnapshot {
    return {
      version: 1,
      title: quiz.title,
      passScore: quiz.pass_score,
      reviewAnswers: quiz.review_answers,
      questions: quiz.questions.map((q) => ({
        id: q.id,
        text: q.question_text,
        type: q.question_type,
        points: q.points.toNumber(),
        options: this.options(q.options),
        acceptedAnswers: q.accepted_answers,
        caseSensitive: q.case_sensitive,
        explanation: q.explanation,
        gradingRubric: q.grading_rubric,
      })),
    };
  }
  private options(value: Prisma.JsonValue): SnapshotQuestion['options'] {
    if (!Array.isArray(value))
      throw new ConflictException('Question options require author review');
    return value.map((option, index) => {
      if (
        !option ||
        typeof option !== 'object' ||
        Array.isArray(option) ||
        typeof option.text !== 'string' ||
        typeof option.isCorrect !== 'boolean'
      )
        throw new ConflictException('Question options require author review');
      return {
        id: typeof option.id === 'string' ? option.id : `legacy_${index}`,
        text: option.text,
        isCorrect: option.isCorrect,
      };
    });
  }
  private snapshotOf(attempt: Attempt): QuizSnapshot {
    if (!attempt.snapshot) throw new ConflictException('Legacy attempt has no grading snapshot');
    return attempt.snapshot as unknown as QuizSnapshot;
  }
  private async quiz(id: string, tx: Prisma.TransactionClient = this.prisma) {
    const quiz = await tx.quiz.findFirst({
      where: { id, deleted_at: null, lesson: { deleted_at: null, course: { deleted_at: null } } },
      include: quizInclude,
    });
    if (!quiz) throw new NotFoundException('Quiz', id);
    return quiz;
  }
  private metadata(quiz: QuizWithQuestions) {
    return {
      id: quiz.id,
      lessonId: quiz.lesson_id,
      title: quiz.title,
      description: quiz.description,
      status: quiz.status,
      revision: quiz.revision,
      passScore: quiz.pass_score,
      timeLimit: quiz.time_limit,
      maxAttempts: quiz.max_attempts,
      requiresPass: quiz.requires_pass,
      reviewAnswers: quiz.review_answers,
      availableFrom: quiz.available_from,
      availableUntil: quiz.available_until,
    };
  }
  async findAll(query: QuizListDto, actor: RequestUser, author = false) {
    if (author) {
      const lesson = await this.prisma.lesson.findFirst({
        where: { id: query.lessonId, deleted_at: null },
      });
      if (!lesson) throw new NotFoundException('Lesson', query.lessonId);
      await this.access.owner(actor, lesson.course_id);
    } else await this.access.lesson(actor.id, query.lessonId);
    const where = {
      lesson_id: query.lessonId,
      deleted_at: null,
      ...(!author ? { status: 'published' } : {}),
    };
    const [quizzes, total] = await Promise.all([
      this.prisma.quiz.findMany({
        where,
        include: quizInclude,
        skip: query.skip,
        take: query.take,
        orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.quiz.count({ where }),
    ]);
    return new PaginatedResult(
      quizzes.map((q) => ({ ...this.metadata(q), questionCount: q.questions.length })),
      total,
      query.page,
      query.limit,
    );
  }
  async findById(id: string, actor: RequestUser, author = false) {
    const quiz = await this.quiz(id);
    if (author) await this.access.owner(actor, quiz.lesson.course_id);
    else {
      await this.access.lesson(actor.id, quiz.lesson_id);
      if (quiz.status !== 'published') throw new NotFoundException('Published quiz', id);
    }
    const snapshot = this.snapshot(quiz);
    return {
      ...this.metadata(quiz),
      questions: author ? snapshot.questions : snapshot.questions.map(learnerQuestion),
    };
  }
  private questionData(questions: CreateQuizDto['questions']) {
    validateQuestions(questions);
    return questions.map((q, index) => ({
      question_text: q.text.trim(),
      question_type: q.type,
      points: q.points,
      options: (q.options ?? []).map((o) => ({ ...o })),
      accepted_answers: q.acceptedAnswers ?? [],
      case_sensitive: q.caseSensitive ?? false,
      explanation: q.explanation,
      grading_rubric: q.gradingRubric,
      sort_order: index + 1,
    }));
  }
  private settings(dto: CreateQuizDto | UpdateQuizDto): Prisma.QuizUncheckedUpdateInput {
    return {
      title: dto.title?.trim(),
      description: dto.description,
      pass_score: dto.passScore,
      time_limit: dto.timeLimit,
      max_attempts: dto.maxAttempts,
      requires_pass: dto.requiresPass,
      review_answers: dto.reviewAnswers,
      available_from:
        dto.availableFrom === undefined
          ? undefined
          : dto.availableFrom
            ? new Date(dto.availableFrom)
            : null,
      available_until:
        dto.availableUntil === undefined
          ? undefined
          : dto.availableUntil
            ? new Date(dto.availableUntil)
            : null,
    };
  }
  private validateSettings(quiz: {
    title: string;
    available_from: Date | null;
    available_until: Date | null;
  }) {
    if (!quiz.title.trim()) throw new BadRequestException('Quiz title is required');
    if (quiz.available_from && quiz.available_until && quiz.available_from >= quiz.available_until)
      throw new BadRequestException('Availability start must precede end');
  }
  async create(dto: CreateQuizDto, actor: RequestUser) {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: dto.lessonId, deleted_at: null },
    });
    if (!lesson) throw new NotFoundException('Lesson', dto.lessonId);
    const questions = this.questionData(dto.questions);
    return this.prisma.$transaction(async (tx) => {
      await lockCourse(tx, lesson.course_id);
      const current = await this.access.actor(tx, actor, 'quizzes:create');
      await this.access.owner(current, lesson.course_id, tx);
      const activeLesson = await tx.lesson.findFirst({
        where: { id: lesson.id, deleted_at: null },
      });
      if (!activeLesson) throw new NotFoundException('Lesson', lesson.id);
      const quiz = await tx.quiz.create({
        data: {
          title: dto.title.trim(),
          description: dto.description,
          lesson_id: lesson.id,
          pass_score: dto.passScore,
          time_limit: dto.timeLimit,
          max_attempts: dto.maxAttempts,
          requires_pass: dto.requiresPass,
          review_answers: dto.reviewAnswers,
          available_from: dto.availableFrom ? new Date(dto.availableFrom) : null,
          available_until: dto.availableUntil ? new Date(dto.availableUntil) : null,
          questions: { create: questions },
        },
        include: quizInclude,
      });
      this.validateSettings(quiz);
      await auditContent(tx, 'quiz.created', actor.id, 'quiz', quiz.id);
      return { ...this.metadata(quiz), questions: this.snapshot(quiz).questions };
    });
  }
  async update(id: string, dto: UpdateQuizDto, actor: RequestUser) {
    const prior = await this.quiz(id);
    const questions = dto.questions ? this.questionData(dto.questions) : undefined;
    return this.prisma.$transaction(async (tx) => {
      await lockCourse(tx, prior.lesson.course_id);
      const current = await this.access.actor(tx, actor, 'quizzes:update');
      await this.access.owner(current, prior.lesson.course_id, tx);
      await this.quiz(id, tx);
      if (questions)
        await tx.quizQuestion.updateMany({
          where: { quiz_id: id, deleted_at: null },
          data: { deleted_at: new Date() },
        });
      const quiz = await tx.quiz.update({
        where: { id },
        data: {
          ...this.settings(dto),
          status: dto.status,
          revision: { increment: 1 },
          ...(questions ? { questions: { create: questions } } : {}),
        },
        include: quizInclude,
      });
      this.validateSettings(quiz);
      if (quiz.status === 'published' && !quiz.questions.length)
        throw new BadRequestException('Published quiz requires questions');
      if (quiz.status === 'published') validateQuestions(this.snapshot(quiz).questions);
      await tx.course.update({
        where: { id: prior.lesson.course_id },
        data: { content_version: { increment: 1 } },
      });
      await auditContent(tx, 'quiz.updated', actor.id, 'quiz', id);
      return { ...this.metadata(quiz), questions: this.snapshot(quiz).questions };
    });
  }
  async delete(id: string, actor: RequestUser) {
    const quiz = await this.quiz(id);
    return this.prisma.$transaction(async (tx) => {
      await lockCourse(tx, quiz.lesson.course_id);
      const current = await this.access.actor(tx, actor, 'quizzes:delete');
      await this.access.owner(current, quiz.lesson.course_id, tx);
      await tx.quiz.update({ where: { id }, data: { deleted_at: new Date(), status: 'archived' } });
      await tx.course.update({
        where: { id: quiz.lesson.course_id },
        data: { content_version: { increment: 1 } },
      });
      await auditContent(tx, 'quiz.deleted', actor.id, 'quiz', id);
      return { id, deleted: true };
    });
  }

  async start(id: string, actor: RequestUser) {
    const prior = await this.quiz(id);
    const result = await this.prisma.$transaction(async (tx) => {
      await lockCourse(tx, prior.lesson.course_id);
      await this.access.actor(tx, actor, 'quizzes:attempt');
      const quiz = await this.quiz(id, tx);
      await this.access.lesson(actor.id, quiz.lesson_id, tx);
      const now = new Date();
      await tx.quizAttempt.updateMany({
        where: { quiz_id: id, user_id: actor.id, status: 'in_progress', deadline_at: { lte: now } },
        data: { status: 'expired', finished_at: now },
      });
      if (
        quiz.status !== 'published' ||
        (quiz.available_from && now < quiz.available_from) ||
        (quiz.available_until && now >= quiz.available_until)
      )
        throw new ConflictException('Quiz is unavailable');
      const active = await tx.quizAttempt.findFirst({
        where: { quiz_id: id, user_id: actor.id, status: 'in_progress' },
        include: attemptInclude,
      });
      if (active) return active;
      const count = await tx.quizAttempt.count({ where: { quiz_id: id, user_id: actor.id } });
      if (quiz.max_attempts && count >= quiz.max_attempts) return null;
      if (!quiz.questions.length) throw new ConflictException('Quiz has no questions');
      const snapshot = this.snapshot(quiz);
      validateQuestions(snapshot.questions);
      const deadline = [
        quiz.time_limit ? now.getTime() + quiz.time_limit * 60000 : null,
        quiz.available_until?.getTime() ?? null,
      ].filter((value): value is number => value !== null);
      const attempt = await tx.quizAttempt.create({
        data: {
          quiz_id: id,
          user_id: actor.id,
          quiz_revision: quiz.revision,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          max_score: snapshot.questions.reduce(
            (sum, q) => sum.plus(q.points),
            new Prisma.Decimal(0),
          ),
          deadline_at: deadline.length ? new Date(Math.min(...deadline)) : null,
        },
        include: attemptInclude,
      });
      await auditContent(tx, 'quiz.attempt_started', actor.id, 'quiz_attempt', attempt.id);
      return attempt;
    });
    if (!result) throw new ConflictException('Quiz attempt limit reached');
    return this.viewAttempt(result);
  }
  private viewAttempt(attempt: Attempt, author = false) {
    const snapshot = attempt.snapshot ? this.snapshotOf(attempt) : null;
    const finished = ['graded', 'pending_grading'].includes(attempt.status);
    const review =
      !!snapshot &&
      ((author && finished) || (attempt.status === 'graded' && snapshot.reviewAnswers));
    return {
      id: attempt.id,
      quizId: attempt.quiz_id,
      quizRevision: attempt.quiz_revision,
      title: snapshot?.title ?? attempt.quiz.title,
      status: attempt.status,
      startedAt: attempt.started_at,
      deadlineAt: attempt.deadline_at,
      submittedAt: attempt.submitted_at,
      gradedAt: attempt.graded_at,
      score: attempt.status === 'graded' ? (attempt.score?.toNumber() ?? null) : null,
      maxScore: attempt.max_score.toNumber(),
      percentage: attempt.status === 'graded' ? attempt.percentage : null,
      isPassed: attempt.status === 'graded' ? attempt.is_passed : null,
      questions:
        snapshot?.questions.map((q) => ({
          ...learnerQuestion(q),
          ...(review
            ? {
                correctOptionIds: q.options.filter((o) => o.isCorrect).map((o) => o.id),
                acceptedAnswers: q.acceptedAnswers,
                explanation: q.explanation,
                ...(author ? { gradingRubric: q.gradingRubric } : {}),
              }
            : {}),
        })) ?? [],
      answers: finished
        ? attempt.answers.map((a) => ({
            questionId: a.question_id,
            answer: a.answer,
            points: a.points?.toNumber() ?? null,
            isCorrect: a.is_correct,
            feedback: a.feedback,
            gradedAt: a.graded_at,
          }))
        : [],
    };
  }
  private async attempt(id: string, tx: Prisma.TransactionClient = this.prisma) {
    const attempt = await tx.quizAttempt.findUnique({ where: { id }, include: attemptInclude });
    if (!attempt) throw new NotFoundException('Quiz attempt', id);
    return attempt;
  }
  async getAttempt(id: string, actor: RequestUser, author = false) {
    let attempt = await this.attempt(id);
    if (author) await this.access.owner(actor, attempt.quiz.lesson.course_id);
    else if (attempt.user_id !== actor.id) throw new ForbiddenException('Own attempt required');
    if (
      attempt.status === 'in_progress' &&
      attempt.deadline_at &&
      attempt.deadline_at <= new Date()
    ) {
      await this.prisma.quizAttempt.updateMany({
        where: { id, status: 'in_progress', deadline_at: { lte: new Date() } },
        data: { status: 'expired', finished_at: new Date() },
      });
      attempt = await this.attempt(id);
    }
    return this.viewAttempt(attempt, author);
  }
  async myAttempts(id: string, actor: RequestUser, query: PaginationQueryDto) {
    // Historical attempts remain readable after cancellation or content archival.
    const where = { quiz_id: id, user_id: actor.id };
    const [attempts, total] = await Promise.all([
      this.prisma.quizAttempt.findMany({
        where,
        skip: query.skip,
        take: query.take,
        include: attemptInclude,
        orderBy: [{ started_at: 'desc' }, { id: 'asc' }],
      }),
      this.prisma.quizAttempt.count({ where }),
    ]);
    return new PaginatedResult(
      attempts.map((attempt) => this.viewAttempt(attempt)),
      total,
      query.page,
      query.limit,
    );
  }
  async submit(id: string, dto: SubmitQuizDto, actor: RequestUser) {
    const prior = await this.attempt(id);
    if (prior.user_id !== actor.id) throw new ForbiddenException('Own attempt required');
    const result = await this.prisma.$transaction(async (tx) => {
      await lockCourse(tx, prior.quiz.lesson.course_id);
      await this.access.actor(tx, actor, 'quizzes:attempt');
      const attempt = await this.attempt(id, tx);
      const snapshot = this.snapshotOf(attempt);
      const answers = canonicalAnswers(snapshot, dto.answers);
      const hash = submissionHash(answers);
      if (['graded', 'pending_grading'].includes(attempt.status)) {
        if (attempt.submission_hash !== hash)
          throw new ConflictException('Attempt already submitted with different answers');
        return attempt;
      }
      const now = new Date();
      if (attempt.status === 'expired' || (attempt.deadline_at && attempt.deadline_at <= now)) {
        await tx.quizAttempt.update({
          where: { id },
          data: { status: 'expired', finished_at: now },
        });
        return null;
      }
      await this.access.lesson(actor.id, attempt.quiz.lesson_id, tx);
      if (attempt.quiz.deleted_at || attempt.quiz.status !== 'published')
        throw new ConflictException('Quiz is no longer available');
      const graded = snapshot.questions.map((q) => ({
        q,
        answer: answers.find((answer) => answer.questionId === q.id)!,
        grade: gradeObjective(
          q,
          answers.find((answer) => answer.questionId === q.id)!,
        ),
      }));
      await tx.quizAttemptAnswer.createMany({
        data: graded.map(({ q, answer, grade }) => ({
          attempt_id: id,
          question_id: q.id,
          answer: answer,
          points: grade.points,
          is_correct: grade.isCorrect,
        })),
      });
      const pending = graded.some(({ grade }) => grade.points === null);
      const final = pending
        ? {}
        : finalScore(
            graded.map(({ grade }) => grade.points!),
            attempt.max_score,
            snapshot.passScore,
          );
      const updated = await tx.quizAttempt.update({
        where: { id },
        data: {
          ...final,
          status: pending ? 'pending_grading' : 'graded',
          submission_hash: hash,
          submitted_at: now,
          finished_at: now,
          graded_at: pending ? null : now,
        },
        include: attemptInclude,
      });
      await auditContent(tx, 'quiz.attempt_submitted', actor.id, 'quiz_attempt', id);
      await this.progress.reconcile(tx, actor.id, attempt.quiz.lesson.course_id);
      return updated;
    });
    if (!result) throw new ConflictException('Quiz attempt expired');
    return this.viewAttempt(result);
  }
  async grade(id: string, dto: ManualGradeDto, actor: RequestUser) {
    const prior = await this.attempt(id);
    return this.prisma.$transaction(async (tx) => {
      await lockCourse(tx, prior.quiz.lesson.course_id);
      const current = await this.access.actor(tx, actor, 'quizzes:grade');
      await this.access.owner(current, prior.quiz.lesson.course_id, tx);
      const attempt = await this.attempt(id, tx);
      if (attempt.user_id === actor.id) throw new ForbiddenException('Self grading is prohibited');
      if (!['pending_grading', 'graded'].includes(attempt.status))
        throw new ConflictException('Attempt has not been submitted');
      const snapshot = this.snapshotOf(attempt);
      if (new Set(dto.answers.map((a) => a.questionId)).size !== dto.answers.length)
        throw new BadRequestException('Duplicate grading entries');
      const now = new Date();
      for (const grade of dto.answers) {
        const question = snapshot.questions.find((q) => q.id === grade.questionId);
        if (
          !question ||
          question.type !== 'open_ended' ||
          new Prisma.Decimal(grade.points).gt(question.points) ||
          !grade.feedback.trim()
        )
          throw new BadRequestException(
            'Grade must target a manual question and be within its maximum',
          );
        const answer = attempt.answers.find((a) => a.question_id === grade.questionId)!;
        await tx.quizAttemptAnswer.update({
          where: { id: answer.id },
          data: {
            points: grade.points,
            is_correct: grade.points === question.points,
            feedback: grade.feedback.trim(),
            graded_by: actor.id,
            graded_at: now,
          },
        });
        await tx.auditLog.create({
          data: {
            user_id: actor.id,
            action: 'quiz.answer_graded',
            resource: 'quiz_attempt',
            resource_id: id,
            old_data: { questionId: grade.questionId, points: answer.points?.toString() ?? null },
            new_data: { questionId: grade.questionId, points: grade.points },
          },
        });
      }
      const answers = await tx.quizAttemptAnswer.findMany({ where: { attempt_id: id } });
      const pending = answers.some((a) => a.points === null);
      const final = pending
        ? { score: null, percentage: null, is_passed: null }
        : finalScore(
            answers.map((a) => a.points!),
            attempt.max_score,
            snapshot.passScore,
          );
      const updated = await tx.quizAttempt.update({
        where: { id },
        data: {
          ...final,
          status: pending ? 'pending_grading' : 'graded',
          graded_at: pending ? null : now,
        },
        include: attemptInclude,
      });
      await this.progress.reconcile(tx, attempt.user_id, attempt.quiz.lesson.course_id);
      return this.viewAttempt(updated, true);
    });
  }
}
