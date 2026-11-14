import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { QuizAnswerDto, QuizQuestionDto } from './quiz.dto';

export interface SnapshotQuestion {
  id: string;
  text: string;
  type: string;
  points: number;
  options: { id: string; text: string; isCorrect: boolean }[];
  acceptedAnswers: string[];
  caseSensitive: boolean;
  explanation: string | null;
  gradingRubric: string | null;
}
export interface QuizSnapshot {
  version: 1;
  title: string;
  passScore: number;
  reviewAnswers: boolean;
  questions: SnapshotQuestion[];
}
export function normalizedAnswer(value: string, caseSensitive: boolean) {
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  return caseSensitive ? normalized : normalized.toLocaleLowerCase('en-US');
}
export function validateQuestions(
  questions: (Omit<QuizQuestionDto, 'explanation' | 'gradingRubric'> & {
    gradingRubric?: string | null;
  })[],
) {
  if (!questions.length || questions.length > 100)
    throw new BadRequestException('Supply between 1 and 100 questions');
  for (const q of questions) {
    if (
      !['single_choice', 'multiple_choice', 'true_false', 'short_answer', 'open_ended'].includes(
        q.type,
      ) ||
      !Number.isFinite(q.points) ||
      q.points <= 0 ||
      q.points > 10000
    )
      throw new BadRequestException('Unsupported question type or points');
    if (!q.text.trim()) throw new BadRequestException('Question text is required');
    const options = q.options ?? [];
    if (
      new Set(options.map((option) => option.id)).size !== options.length ||
      options.length > 10 ||
      options.some(
        (option) =>
          !/^[a-zA-Z0-9_-]{1,40}$/.test(option.id) ||
          !option.text.trim() ||
          option.text.length > 2000,
      )
    )
      throw new BadRequestException('Unique nonempty options required');
    const correct = options.filter((option) => option.isCorrect).length;
    if (['single_choice', 'true_false'].includes(q.type) && (options.length < 2 || correct !== 1))
      throw new BadRequestException('Single-choice questions require exactly one correct option');
    if (q.type === 'true_false' && options.length !== 2)
      throw new BadRequestException('True/false requires two options');
    if (q.type === 'multiple_choice' && (options.length < 2 || correct < 1))
      throw new BadRequestException('Multiple-choice requires correct option(s)');
    if (['short_answer', 'open_ended'].includes(q.type) && options.length)
      throw new BadRequestException('Text questions cannot have options');
    if (
      q.type === 'short_answer' &&
      !(
        q.acceptedAnswers?.length &&
        q.acceptedAnswers.every((answer) => normalizedAnswer(answer, q.caseSensitive ?? false))
      )
    )
      throw new BadRequestException('Short-answer keys cannot be empty');
    if (q.type !== 'short_answer' && q.acceptedAnswers?.length)
      throw new BadRequestException('Answer keys only apply to short answers');
    if (q.type === 'open_ended' && !q.gradingRubric?.trim())
      throw new BadRequestException('Manual questions require a grading rubric');
  }
}
export function learnerQuestion(q: SnapshotQuestion) {
  return {
    id: q.id,
    text: q.text,
    type: q.type,
    points: q.points,
    options: q.options.map(({ id, text }) => ({ id, text })),
  };
}
export function canonicalAnswers(snapshot: QuizSnapshot, submitted: QuizAnswerDto[]) {
  const byId = new Map(submitted.map((answer) => [answer.questionId, answer]));
  if (
    byId.size !== submitted.length ||
    submitted.some((answer) => !snapshot.questions.some((q) => q.id === answer.questionId))
  )
    throw new BadRequestException('Unknown or duplicated question');
  return snapshot.questions
    .map((q) => {
      const answer = byId.get(q.id);
      if (['short_answer', 'open_ended'].includes(q.type)) {
        if (answer?.optionIds?.length)
          throw new BadRequestException('Text question cannot receive options');
        return { questionId: q.id, text: answer?.text ?? '' };
      }
      if (answer?.text !== undefined)
        throw new BadRequestException('Choice question cannot receive text');
      const ids = [...(answer?.optionIds ?? [])].sort();
      if (
        new Set(ids).size !== ids.length ||
        ids.some((id) => !q.options.some((o) => o.id === id)) ||
        (q.type !== 'multiple_choice' && ids.length > 1)
      )
        throw new BadRequestException('Invalid answer options');
      return { questionId: q.id, optionIds: ids };
    })
    .sort((a, b) => a.questionId.localeCompare(b.questionId));
}
export function submissionHash(answers: ReturnType<typeof canonicalAnswers>) {
  return createHash('sha256').update(JSON.stringify(answers)).digest('hex');
}
export function gradeObjective(
  q: SnapshotQuestion,
  answer: { text?: string; optionIds?: string[] },
) {
  if (q.type === 'open_ended') return { points: null, isCorrect: null };
  const correct =
    q.type === 'short_answer'
      ? q.acceptedAnswers.some(
          (key) =>
            normalizedAnswer(key, q.caseSensitive) ===
            normalizedAnswer(answer.text ?? '', q.caseSensitive),
        )
      : JSON.stringify(
          q.options
            .filter((o) => o.isCorrect)
            .map((o) => o.id)
            .sort(),
        ) === JSON.stringify(answer.optionIds ?? []);
  return { points: new Prisma.Decimal(correct ? q.points : 0), isCorrect: correct };
}
export function finalScore(points: Prisma.Decimal[], maximum: Prisma.Decimal, passScore: number) {
  const score = points.reduce((sum, point) => sum.plus(point), new Prisma.Decimal(0));
  if (maximum.lte(0)) throw new BadRequestException('Invalid assessment maximum');
  return {
    score,
    percentage: score.mul(100).div(maximum).toDecimalPlaces(2).toNumber(),
    is_passed: score.mul(100).gte(maximum.mul(passScore)),
  };
}
