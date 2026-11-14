import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { cleanContent } from '../src/modules/courses/content-integrity';
import { authoredId } from '../src/modules/progress/authored-id';
interface AuthoredLesson {
  id: string;
  title: string;
  goal: string;
  theory: string;
  example: string;
  steps: string[];
  code: string;
  lang: string;
  prereq: string;
  labGuide: string;
  exercise: string;
  checks: string[];
  q: string;
  opts: string[];
  answer: number;
  why: string;
}
interface AuthoredCourse {
  id: string;
  name: string;
  tag: string;
  tools: string[];
  lessons: AuthoredLesson[];
}
interface AuthoredQuestion {
  id: string;
  courseId: string;
  lessonId: string;
  q: string;
  opts: string[];
  ans: number;
  exp: string;
}
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );

export function validateAuthoredContent(courses: AuthoredCourse[], bank: AuthoredQuestion[]) {
  const courseKeys = ['arduino', 'vex-iq', 'microbit', 'lego-spike', 'vex-vr'];
  if (
    !Array.isArray(courses) ||
    courses.length !== courseKeys.length ||
    new Set(courses.map((course) => course.id)).size !== courseKeys.length ||
    courses.some(
      (course) =>
        !courseKeys.includes(course.id) ||
        !Array.isArray(course.lessons) ||
        course.lessons.length !== 6 ||
        new Set(course.lessons.map((lesson) => lesson.id)).size !== 6 ||
        course.lessons.some((lesson) => !/^[a-z0-9-]+$/.test(lesson.id)),
    )
  )
    throw new Error('Unexpected authored catalog');
  if (!Array.isArray(bank) || !bank.length || new Set(bank.map((q) => q.id)).size !== bank.length)
    throw new Error('Unexpected authored question bank');
  for (const question of bank) {
    const course = courses.find((entry) => entry.id === question.courseId);
    if (
      !course?.lessons.some((lesson) => lesson.id === question.lessonId) ||
      typeof question.id !== 'string' ||
      !question.id.startsWith(`${question.courseId}:${question.lessonId}:`) ||
      typeof question.q !== 'string' ||
      !question.q.trim() ||
      !Array.isArray(question.opts) ||
      question.opts.length < 2 ||
      question.opts.some((option) => typeof option !== 'string' || !option.trim()) ||
      !Number.isInteger(question.ans) ||
      question.ans < 0 ||
      question.ans >= question.opts.length ||
      typeof question.exp !== 'string'
    )
      throw new Error('Invalid authored question or lesson mapping');
  }
  for (const course of courses)
    for (const lesson of course.lessons)
      if (!bank.some((question) => question.courseId === course.id && question.lessonId === lesson.id))
        throw new Error('Every authored lesson needs practice questions');
}
export async function importLearning(
  prisma: PrismaClient,
  creatorId: string,
  allowExistingStudentOwner = false,
) {
  const creator = await prisma.user.findUniqueOrThrow({
    where: { id: creatorId },
    include: { role: true },
  });
  const permittedOwner =
    ['teacher', 'admin', 'superadmin'].includes(creator.role.name) ||
    (allowExistingStudentOwner && creator.role.name === 'student');
  if (!creator.is_active || creator.deleted_at || !creator.role.is_active || !permittedOwner)
    throw new Error(
      'An active teacher/administrator is required unless the operator explicitly preserves an existing student owner',
    );
  const courses = JSON.parse(
    await readFile(path.resolve(process.cwd(), 'prisma/content/strobot-catalog.json'), 'utf8'),
  ) as AuthoredCourse[];
  const bank = JSON.parse(
    await readFile(
      path.resolve(process.cwd(), 'prisma/content/strobot-question-bank.json'),
      'utf8',
    ),
  ) as AuthoredQuestion[];
  validateAuthoredContent(courses, bank);
  let createdCourses = 0,
    createdLessons = 0,
    createdQuizzes = 0;
  // All-or-nothing import; existing deterministic IDs are preserved, never overwritten.
  await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      for (const course of courses) {
        const courseId = authoredId(`course:${course.id}`);
        const existing = await tx.course.findUnique({ where: { id: courseId } });
        if (
          existing &&
          (existing.slug !== course.id || existing.creator_id !== creatorId || existing.deleted_at)
        )
          throw new Error('Imported course identity or ownership changed; manual review required');
        if (!existing) {
          await tx.course.create({
            data: {
              id: courseId,
              title: course.name,
              slug: course.id,
              description: `${course.tag}. ${course.lessons.length} bài học lý thuyết và thực hành từ nội dung ST-Robot hiện có.`,
              creator_id: creatorId,
              status: 'published',
            },
          });
          createdCourses++;
        }
        for (const [index, lesson] of course.lessons.entries()) {
          const lessonId = authoredId(`lesson:${course.id}:${lesson.id}`);
          const material = {
            sourceId: lesson.id,
            courseSourceId: course.id,
            tag: course.tag,
            tools: course.tools,
            goal: lesson.goal,
            theory: lesson.theory,
            example: lesson.example,
            steps: lesson.steps,
            code: lesson.code,
            lang: lesson.lang,
            prereq: lesson.prereq,
            labGuide: lesson.labGuide,
            exercise: lesson.exercise,
            checks: lesson.checks,
          };
          const content = cleanContent(
            `<h2>${escapeHtml(lesson.title)}</h2><p>${escapeHtml(lesson.goal)}</p>${lesson.theory
              .split('\n\n')
              .map((p) => `<p>${escapeHtml(p)}</p>`)
              .join(
                '',
              )}<p>${escapeHtml(lesson.example)}</p><ol>${lesson.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol><pre><code>${escapeHtml(lesson.code)}</code></pre><p>${escapeHtml(lesson.exercise)}</p>`,
          );
          const previous = await tx.lesson.findUnique({ where: { id: lessonId } });
          if (previous && (previous.course_id !== courseId || previous.deleted_at))
            throw new Error('Imported lesson was reassigned');
          if (!previous) {
            await tx.lesson.create({
              data: {
                id: lessonId,
                course_id: courseId,
                title: lesson.title,
                content,
                learning_material: material,
                sort_order: index + 1,
                status: 'published',
                is_required: true,
              },
            });
            createdLessons++;
          }
          const quizId = authoredId(`quiz:${course.id}:${lesson.id}`);
          const previousQuiz = await tx.quiz.findUnique({ where: { id: quizId } });
          if (previousQuiz && (previousQuiz.lesson_id !== lessonId || previousQuiz.deleted_at))
            throw new Error('Imported quiz was reassigned or removed; manual review required');
          if (!previousQuiz) {
            const questions = bank.filter(
              (question) => question.courseId === course.id && question.lessonId === lesson.id,
            );
            await tx.quiz.create({
              data: {
                id: quizId,
                lesson_id: lessonId,
                title: `${lesson.title} — kiểm tra`,
                status: 'published',
                pass_score: 70,
                // Preserve the approved self-study workflow: practice is optional.
                requires_pass: false,
                review_answers: true,
                questions: {
                  create: questions.map((question, questionIndex) => ({
                    // Keep the original core question identity for existing integrations.
                    id: authoredId(
                      question.id === `${course.id}:${lesson.id}:core`
                        ? `question:${course.id}:${lesson.id}`
                        : `question:${question.id}`,
                    ),
                    question_text: question.q,
                    question_type: 'single_choice',
                    points: 1,
                    options: question.opts.map((text, i) => ({
                      id: `option_${i}`,
                      text,
                      isCorrect: i === question.ans,
                    })),
                    explanation: question.exp,
                    sort_order: questionIndex + 1,
                  })),
                },
              },
            });
            createdQuizzes++;
          }
          // Lab choices and iframe policies remain in the approved frontend.
          // Do not invent external-only resources from the obsolete course.lab field.
        }
      }
      await tx.auditLog.create({
        data: {
          user_id: creatorId,
          action: 'learning.authored_content_imported',
          resource: 'catalog',
          new_data: {
            createdCourses,
            createdLessons,
            createdQuizzes,
            source: 'existing-strobot-content-v1',
          },
        },
      });
    },
    { timeout: 30000 },
  );
  return {
    createdCourses,
    createdLessons,
    createdQuizzes,
    sourceCourses: courses.length,
    sourceLessons: courses.reduce((sum, c) => sum + c.lessons.length, 0),
  };
}

if (require.main === module) {
  const prisma = new PrismaClient();
  const creatorId = process.argv[2];
  if (!creatorId)
    throw new Error('Usage: import-learning.ts <existing-active-teacher-or-admin-uuid>');
  importLearning(prisma, creatorId, process.argv.includes('--allow-existing-student-owner'))
    .then((result) => console.log(result))
    .catch(() => {
      console.error(
        'Learning import failed; no content was committed. Check creator, schema and existing identity collisions.',
      );
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
