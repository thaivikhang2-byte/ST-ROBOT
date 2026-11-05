import assert from 'node:assert/strict';
import { ReviewService, REVIEW_STORAGE_KEY } from '../frontend/src/modules/quiz/ReviewService.js';
import { QuizService, QUIZ_HISTORY_KEY } from '../frontend/src/modules/quiz/QuizService.js';
import { createGeneratedQuiz, resolveGeneratedQuestion } from '../frontend/src/modules/quiz/generation/QuestionEngine.js';

const values = new Map();
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
let time = Date.parse('2026-11-05T00:00:00Z');
const service = new ReviewService({ storage, now: () => time });
const generated = createGeneratedQuiz({ courseId: 'arduino', lessonId: 'led', count: 3, seed: 'review' });
const question = generated[0];
const wrong = { questionId: question.id, choice: (question.ans + 1) % question.opts.length };
const right = { questionId: question.id, choice: question.ans };
const record = (id, answers, extra = {}) => service.recordCompletedAttempt({ completed: true, id, courseId: 'arduino', mode: 'generated', answers, ...extra });
assert.equal(record('aborted', [wrong], { completed: false }).saved, false);
for (const id of ['gen:v2:nope:1', 'gen:v1:arduino-led-current:-1', 'gen:v1:arduino-led-current:9999999', 'study:A:led:1']) {
    assert.equal(record('bad-' + id, [{ questionId: id, choice: 0 }]).saved, false);
}
assert.equal(record('wrong-course', [wrong], { courseId: 'microbit' }).saved, false);
assert.equal(record('invalid-choice', [{ questionId: question.id, choice: 99 }]).saved, false);
assert.equal(record('first', [wrong]).saved, true);
assert.equal(record('first', [right]).duplicate, true);
let plan = service.plan('arduino');
assert.equal(plan.items[0].question.id, question.id);
assert.equal(plan.items[0].reasonType, 'wrong');
assert.deepEqual(plan.items[0].question, resolveGeneratedQuestion(question.id));
assert.equal(service.evidence('arduino').evidence.get(question.id).templateId, question.templateId);
assert.equal(service.plan('microbit').items.length, 0);
assert.ok(plan.lessons.find(lesson => lesson.id === 'led').questionCount > 3);

// Reconstruct on a fresh service; grade the canonical answer, not a stored answer key.
const reloaded = new ReviewService({ storage, now: () => time });
assert.deepEqual(reloaded.plan('arduino').items[0].question, question);
const quiz = new QuizService({ storage });
assert.equal(quiz.grade([question], [question.ans]).percentage, 100);
assert.equal(quiz.grade([question], [wrong.choice]).percentage, 0);
time += 1000;
assert.equal(record('corrected', [right], { mode: 'review' }).saved, true);
assert.equal(service.plan('arduino').items.some(item => item.question.id === question.id), false);
time += 86400000;
plan = service.plan('arduino');
assert.equal(plan.items.find(item => item.question.id === question.id).reasonType, 'due');
assert.equal(service.evidence('arduino').evidence.get(question.id).streak, 1);
assert.equal(values.has(QUIZ_HISTORY_KEY), false, 'Generated practice must not silently create ordinary quiz comparisons');

const exported = service.exportCourse('arduino');
assert.equal(exported.attempts[0].mode, 'generated');
assert.equal(exported.attempts[0].answers[0].questionId, question.id);
const stored = JSON.parse(values.get(REVIEW_STORAGE_KEY));
stored.attempts[0].answers[0].ans = wrong.choice;
values.set(REVIEW_STORAGE_KEY, JSON.stringify(stored));
assert.equal(service.evidence('arduino').evidence.get(question.id).latestCorrect, true, 'Stored answer-key fields never override canonical rendering');
values.set('strobot.assessment.v1', 'assessment preserved');
assert.equal(service.clearCourse('arduino'), true);
assert.equal(service.evidence('arduino').attempts.length, 0);
assert.equal(values.get('strobot.assessment.v1'), 'assessment preserved');
console.log('PASS generated evidence: canonical ID reconstruction, wrong-answer review, correction/due dates, invalid data, isolated history/export/deletion');
