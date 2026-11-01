import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { quizCourses, quizQuestions } from '../frontend/src/data/quiz.js';
import { QuizService } from '../frontend/src/modules/quiz/QuizService.js';

const curriculum = JSON.parse(await readFile(new URL('../ai-server/curriculum.json', import.meta.url), 'utf8'));
assert.equal(quizCourses.length, 5);
assert.equal(quizQuestions.length, 90);
assert.equal(new Set(quizQuestions.map(question => question.id)).size, 90, 'Question IDs must be unique');

let checkedScopes = 0;
for (const [index, course] of curriculum.entries()) {
    assert.equal(quizCourses[index].id, course.id);
    assert.equal(quizCourses[index].name, course.name);
    assert.deepEqual(quizCourses[index].lessons.map(lesson => lesson.id), course.lessons.map(lesson => lesson.id));
    for (const lesson of course.lessons) {
        const questions = quizQuestions.filter(question => question.courseId === course.id && question.lessonId === lesson.id);
        assert.equal(questions.length, 3, `${course.id}/${lesson.id}: three relevant questions required`);
        assert.equal(new Set(questions.map(question => question.q.trim().toLocaleLowerCase('vi'))).size, 3, 'Duplicate question text');
        const approved = questions.find(question => question.id === `${course.id}:${lesson.id}:core`);
        assert.ok(approved, 'The approved in-course question must be retained');
        assert.equal(approved.q, lesson.q);
        assert.deepEqual(approved.opts, lesson.opts);
        assert.equal(approved.ans, lesson.answer);
        assert.equal(approved.exp, lesson.why);
        for (const question of questions) {
            assert.ok(question.q.trim() && question.exp.trim());
            assert.ok(question.opts.length >= 3);
            assert.equal(new Set(question.opts.map(option => option.trim())).size, question.opts.length);
            assert.ok(Number.isInteger(question.ans) && question.ans >= 0 && question.ans < question.opts.length);
        }
        checkedScopes++;
    }
}

const service = new QuizService({ random: () => 0.25, storage: null });
assert.deepEqual(service.getCourses().map(course => course.id), quizCourses.map(course => course.id));
assert.deepEqual(service.getQuestions('arduino', 'matrix'), [], 'A lesson from another course must not return any questions');
for (const config of [
    { courseId: '', lessonId: 'all', count: 6 },
    { courseId: 'arduino', lessonId: 'matrix', count: 3 },
    { courseId: 'arduino', lessonId: 'all', count: 5 },
    { courseId: 'arduino', lessonId: 'led', count: 6 }
]) assert.throws(() => service.createQuiz(config), RangeError, 'Invalid/cross-course exam scope must be rejected');
let checkedAttempts = 0;
for (const course of curriculum) {
    assert.deepEqual(service.getLessons(course.id).map(lesson => lesson.id), course.lessons.map(lesson => lesson.id));
    assert.equal(service.getQuestions(course.id).length, 18);
    assert.deepEqual(service.getAvailableCounts(course.id), [6, 12, 18]);
    for (const count of [6, 12, 18]) {
        const attempt = service.createQuiz({ courseId: course.id, lessonId: 'all', count });
        assert.equal(attempt.length, count);
        assert.equal(new Set(attempt.map(question => question.id)).size, count, 'Attempt repeated a question');
        assert.ok(attempt.every(question => question.courseId === course.id), 'Attempt crossed course boundaries');
        for (const lesson of course.lessons) {
            assert.equal(attempt.filter(question => question.lessonId === lesson.id).length, count / 6, 'Whole-course attempts must cover every lesson evenly');
        }
        checkedAttempts++;
    }
    for (const lesson of course.lessons) {
        assert.deepEqual(service.getAvailableCounts(course.id, lesson.id), [3]);
        const attempt = service.createQuiz({ courseId: course.id, lessonId: lesson.id, count: 3 });
        assert.equal(attempt.length, 3);
        assert.ok(attempt.every(question => question.courseId === course.id && question.lessonId === lesson.id), 'Lesson attempt crossed its scope');
        checkedAttempts++;
    }
}

const questions = service.createQuiz({ courseId: 'arduino', lessonId: 'all', count: 6 });
const perfect = questions.map(question => question.ans);
const perfectScore = service.grade(questions, perfect);
assert.equal(perfectScore.correct, 6);
assert.equal(perfectScore.total, 6);
assert.equal(perfectScore.percentage, 100);
assert.equal(perfectScore.byLesson.length, 6);
assert.ok(perfectScore.byLesson.every(topic => topic.correct === 1 && topic.total === 1));
const mixed = [...perfect];
mixed[0] = (questions[0].ans + 1) % questions[0].opts.length;
const mixedScore = service.grade(questions, mixed);
assert.equal(mixedScore.correct, 5);
assert.equal(mixedScore.total, 6);
assert.equal(mixedScore.byLesson.reduce((sum, topic) => sum + topic.correct, 0), 5);
assert.equal(service.grade(questions, Array(6).fill(null)).correct, 0);
assert.deepEqual(service.grade(questions, perfect), perfectScore, 'Grading must not accumulate points between calls');

const values = new Map();
const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
};
const persisted = new QuizService({ storage });
const snapshot = number => ({
    id: `assessment-${number}`,
    courseId: 'arduino', lessonId: 'all', correct: 5, total: 6, percentage: 83,
    createdAt: new Date(Date.UTC(2026, 10, 1, 0, number)).toISOString()
});
for (let i = 0; i < 25; i++) assert.equal(persisted.saveResult(snapshot(i)), true);
const history = persisted.getHistory('arduino', 'all');
assert.equal(history.length, 20, 'Completed history must remain bounded');
assert.equal(history[0].id, 'assessment-24', 'History should show newest result first');
assert.deepEqual(persisted.getHistory('microbit', 'all'), [], 'A course cannot see another course history');
assert.deepEqual(persisted.getHistory('arduino', 'led'), [], 'Lesson history must not show all-course results');
assert.equal(persisted.saveResult({ ...snapshot(26), id: 'lesson-result', lessonId: 'led', correct: 3, total: 3, percentage: 100 }), true);
assert.equal(persisted.getHistory('arduino', 'led').length, 1);

const malformed = new QuizService({ storage: { getItem: () => '{broken', setItem: () => {} } });
assert.deepEqual(malformed.getHistory('arduino'), []);
const unavailable = new QuizService({ storage: {
    getItem: () => { throw new Error('Storage disabled'); },
    setItem: () => { throw new Error('Storage disabled'); }
} });
assert.deepEqual(unavailable.getHistory('arduino'), []);
assert.equal(unavailable.saveResult(snapshot(27)), false, 'Storage errors must not break completed assessments');

console.log(`PASS 90 mapped questions, ${checkedScopes} lesson scopes, ${checkedAttempts} balanced/scoped attempts, grading and bounded history`);
