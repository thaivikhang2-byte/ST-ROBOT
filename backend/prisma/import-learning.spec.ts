import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { importLearning, validateAuthoredContent } from './import-learning';
import { authoredId } from '../src/modules/progress/authored-id';

jest.mock('../src/modules/courses/content-integrity', () => ({ cleanContent: (html: string) => html }));

const catalog = JSON.parse(readFileSync(path.join(__dirname, 'content/strobot-catalog.json'), 'utf8'));
const bank = JSON.parse(readFileSync(path.join(__dirname, 'content/strobot-question-bank.json'), 'utf8'));

function memoryDatabase() {
  const courses = new Map<string, Record<string, any>>();
  const lessons = new Map<string, Record<string, any>>();
  const quizzes = new Map<string, Record<string, any>>();
  const model = (rows: Map<string, Record<string, any>>) => ({
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null),
    create: jest.fn(async ({ data }: { data: Record<string, any> }) => {
      rows.set(data.id, structuredClone(data));
      return data;
    }),
  });
  const tx = {
    course: model(courses),
    lesson: model(lessons),
    quiz: model(quizzes),
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma = {
    user: {
      findUniqueOrThrow: jest.fn(async () => ({
        is_active: true,
        deleted_at: null,
        role: { name: 'admin', is_active: true },
      })),
    },
    $transaction: jest.fn(async (work: (client: typeof tx) => Promise<void>) => work(tx)),
  } as unknown as PrismaClient;
  return { prisma, tx, courses, lessons, quizzes };
}

describe('Approved catalog import', () => {
  it('contains exactly the approved frontend content and lesson-scoped question bank', () => {
    const frontend = path.resolve(__dirname, '../../frontend/src/data');
    const courseSource = readFileSync(path.join(frontend, 'curriculum.js'), 'utf8');
    const approvedCourses = JSON.parse(courseSource.slice(courseSource.indexOf('=') + 1).trim().replace(/;$/, ''));
    const questionSource = readFileSync(path.join(frontend, 'quiz.js'), 'utf8');
    const marker = 'export const quizQuestions =';
    const approvedQuestions = JSON.parse(questionSource.slice(questionSource.indexOf(marker) + marker.length).trim().replace(/;$/, ''));
    expect(catalog).toEqual(approvedCourses);
    expect(bank).toEqual(approvedQuestions);
    expect(bank).toHaveLength(90);
    const pdfSource = readFileSync(path.join(frontend, 'lesson-pdfs.js'), 'utf8');
    const approvedPdfs = JSON.parse(pdfSource.slice(pdfSource.indexOf('=') + 1).trim().replace(/;$/, ''));
    for (const course of catalog)
      expect(readFileSync(path.join(__dirname, 'content/pdf', `${course.id}.pdf`)))
        .toEqual(Buffer.from(approvedPdfs[course.id], 'base64'));
    expect(() => validateAuthoredContent(catalog, bank)).not.toThrow();
  });

  it('creates thirty optional lesson quizzes without changing the approved lab choices', async () => {
    const db = memoryDatabase();
    await expect(importLearning(db.prisma, 'owner')).resolves.toMatchObject({
      createdCourses: 5,
      createdLessons: 30,
      createdQuizzes: 30,
    });
    expect(db.quizzes.size).toBe(30);
    for (const course of catalog)
      for (const lesson of course.lessons) {
        const quiz = db.quizzes.get(authoredId(`quiz:${course.id}:${lesson.id}`))!;
        expect(quiz.lesson_id).toBe(authoredId(`lesson:${course.id}:${lesson.id}`));
        expect(quiz.requires_pass).toBe(false);
        expect(quiz.questions.create).toHaveLength(3);
        expect(quiz.questions.create[0].id).toBe(authoredId(`question:${course.id}:${lesson.id}`));
        const material = db.lessons.get(quiz.lesson_id)!.learning_material;
        expect(material.theory).toBe(lesson.theory);
        expect(material.tools).toEqual(course.tools);
      }
    // No obsolete generic quiz is attached to Arduino LED.
    expect(db.quizzes.has(authoredId('quiz:stem-practice'))).toBe(false);
  });

  it('does not overwrite existing content, quiz policies, questions or ownership on repeat import', async () => {
    const db = memoryDatabase();
    await importLearning(db.prisma, 'owner');
    const lesson = db.lessons.get(authoredId('lesson:arduino:led'))!;
    lesson.title = 'Teacher-owned revision';
    const quiz = db.quizzes.get(authoredId('quiz:arduino:led'))!;
    quiz.requires_pass = true;
    quiz.questions = { create: [{ id: 'existing-question', question_text: 'Existing work' }] };
    await expect(importLearning(db.prisma, 'owner')).resolves.toMatchObject({
      createdCourses: 0,
      createdLessons: 0,
      createdQuizzes: 0,
    });
    expect(lesson.title).toBe('Teacher-owned revision');
    expect(quiz.requires_pass).toBe(true);
    expect(quiz.questions.create[0].id).toBe('existing-question');
    expect(db.tx.course.create).toHaveBeenCalledTimes(5);
    expect(db.tx.lesson.create).toHaveBeenCalledTimes(30);
    expect(db.tx.quiz.create).toHaveBeenCalledTimes(30);
  });

  it('refuses to resurrect a deleted deterministic lesson or reuse a reassigned quiz', async () => {
    const db = memoryDatabase();
    await importLearning(db.prisma, 'owner');
    const lessonId = authoredId('lesson:arduino:led');
    db.lessons.get(lessonId)!.deleted_at = new Date();
    await expect(importLearning(db.prisma, 'owner')).rejects.toThrow('Imported lesson was reassigned');
    delete db.lessons.get(lessonId)!.deleted_at;
    db.quizzes.get(authoredId('quiz:arduino:led'))!.lesson_id = 'different-lesson';
    await expect(importLearning(db.prisma, 'owner')).rejects.toThrow('Imported quiz was reassigned');
  });

  it('rejects foreign lesson mappings, duplicate questions and invalid answer keys before writing', () => {
    expect(() => validateAuthoredContent(catalog, [{ ...bank[0], lessonId: 'missing' }, ...bank.slice(1)])).toThrow();
    expect(() => validateAuthoredContent(catalog, [...bank, bank[0]])).toThrow();
    expect(() => validateAuthoredContent(catalog, [{ ...bank[0], ans: 99 }, ...bank.slice(1)])).toThrow();
    expect(() => validateAuthoredContent(catalog, bank.filter((question: { courseId: string; lessonId: string }) => question.courseId !== 'arduino' || question.lessonId !== 'led'))).toThrow('Every authored lesson');
  });
});
