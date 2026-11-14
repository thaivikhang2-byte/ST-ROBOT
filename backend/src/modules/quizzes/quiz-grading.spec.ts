import { Prisma } from '@prisma/client';
import {
  canonicalAnswers,
  finalScore,
  gradeObjective,
  normalizedAnswer,
  QuizSnapshot,
  SnapshotQuestion,
  submissionHash,
  validateQuestions,
} from './quiz-grading';

const question = (overrides: Partial<SnapshotQuestion> = {}): SnapshotQuestion => ({
  id: 'q1',
  text: 'Choose',
  type: 'single_choice',
  points: 2.5,
  options: [
    { id: 'a', text: 'A', isCorrect: true },
    { id: 'b', text: 'B', isCorrect: false },
  ],
  acceptedAnswers: [],
  caseSensitive: false,
  explanation: null,
  gradingRubric: null,
  ...overrides,
});
const snapshot = (questions: SnapshotQuestion[]): QuizSnapshot => ({
  version: 1,
  title: 'Quiz',
  passScore: 70,
  reviewAnswers: false,
  questions,
});
describe('Authoritative quiz grading', () => {
  it('keeps decimal addition exact and compares the unrounded pass threshold', () => {
    expect(
      finalScore(
        [new Prisma.Decimal('0.1'), new Prisma.Decimal('0.2')],
        new Prisma.Decimal('0.3'),
        100,
      ),
    ).toMatchObject({ percentage: 100, is_passed: true });
    expect(
      finalScore([new Prisma.Decimal('19999')], new Prisma.Decimal('20000'), 100),
    ).toMatchObject({ percentage: 100, is_passed: false });
  });
  it('requires exact multiple-select membership regardless of submission order', () => {
    const q = question({
      type: 'multiple_choice',
      options: [
        { id: 'a', text: 'A', isCorrect: true },
        { id: 'b', text: 'B', isCorrect: true },
        { id: 'c', text: 'C', isCorrect: false },
      ],
    });
    const answers = canonicalAnswers(snapshot([q]), [{ questionId: 'q1', optionIds: ['b', 'a'] }]);
    expect(gradeObjective(q, answers[0]).isCorrect).toBe(true);
    expect(gradeObjective(q, { optionIds: ['a'] }).points?.toNumber()).toBe(0);
    expect(gradeObjective(q, { optionIds: ['a', 'b', 'c'] }).isCorrect).toBe(false);
  });
  it('normalizes Unicode compatibility and whitespace but retains Vietnamese diacritics', () => {
    expect(normalizedAnswer('  ＡＲＤＵＩＮＯ\tUno ', false)).toBe('arduino uno');
    expect(normalizedAnswer('điện trở', false)).not.toBe(normalizedAnswer('dien tro', false));
    const q = question({ type: 'short_answer', options: [], acceptedAnswers: ['Arduino Uno'] });
    expect(gradeObjective(q, { text: ' ARDUINO   uno ' }).isCorrect).toBe(true);
    expect(gradeObjective({ ...q, caseSensitive: true }, { text: 'arduino uno' }).isCorrect).toBe(
      false,
    );
  });
  it('does not fabricate manual grades and gives omitted objective answers zero', () => {
    expect(
      gradeObjective(question({ type: 'open_ended', options: [] }), { text: 'Student work' }),
    ).toEqual({ points: null, isCorrect: null });
    expect(gradeObjective(question(), { optionIds: [] }).points?.toNumber()).toBe(0);
  });
  it('canonicalizes explicit empty answers and omitted answers to the same idempotency hash', () => {
    const quiz = snapshot([
      question(),
      question({ id: 'q2', type: 'short_answer', options: [], acceptedAnswers: ['Uno'] }),
    ]);
    expect(submissionHash(canonicalAnswers(quiz, []))).toBe(
      submissionHash(
        canonicalAnswers(quiz, [
          { questionId: 'q2', text: '' },
          { questionId: 'q1', optionIds: [] },
        ]),
      ),
    );
  });
  it('rejects unknown/duplicate questions, option IDs and wrong answer types', () => {
    const quiz = snapshot([question()]);
    for (const answers of [
      [{ questionId: 'other', optionIds: ['a'] }],
      [{ questionId: 'q1', optionIds: ['x'] }],
      [{ questionId: 'q1', optionIds: ['a', 'a'] }],
      [{ questionId: 'q1', text: 'a' }],
      [{ questionId: 'q1' }, { questionId: 'q1' }],
    ])
      expect(() => canonicalAnswers(quiz, answers)).toThrow();
  });
  it('rejects empty questions, unsupported types, missing answer keys and invalid rubrics', () => {
    expect(() => validateQuestions([])).toThrow();
    for (const q of [
      question({ type: 'unsupported' }),
      question({ points: 0 }),
      question({ type: 'true_false', options: [] }),
      question({ type: 'short_answer', options: [], acceptedAnswers: [' '] }),
      question({ type: 'open_ended', options: [], gradingRubric: '' }),
      question({
        options: [
          { id: 'a', text: 'A', isCorrect: true },
          { id: 'a', text: 'B', isCorrect: false },
        ],
      }),
    ])
      expect(() => validateQuestions([q])).toThrow();
  });
});
