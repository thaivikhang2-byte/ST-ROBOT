import assert from 'node:assert/strict';
import { quizCourses, quizQuestions } from '../frontend/src/data/quiz.js';
import { createAutomaticPractice, listAutomaticTemplates, getDifficultyLevel } from '../frontend/src/modules/quiz/generation/AutomaticPractice.js';
import { listTemplates, resolveGeneratedQuestion } from '../frontend/src/modules/quiz/generation/QuestionEngine.js';
import { listAutomaticTemplates as serverPolicy } from '../ai-server/generation/DifficultyPolicy.js';
import { ReviewService } from '../frontend/src/modules/quiz/ReviewService.js';

const bank = new Map(quizQuestions.map(question => [question.id, question]));
const resolve = id => bank.get(id) || resolveGeneratedQuestion(id);
const rank = { basic: 0, apply: 1, reason: 2 };
const suffix = { easy: 'core', medium: 'apply', hard: 'reason' };
let sessions = 0, questionsChecked = 0;
for (const course of quizCourses) for (const difficulty of ['easy', 'medium', 'hard']) {
    const eligible = listAutomaticTemplates({ courseId: course.id, difficulty });
    assert.deepEqual(serverPolicy({ courseId: course.id, difficulty }), eligible);
    const eligibleIds = new Set(eligible.map(template => template.id));
    for (const count of [6, 12, 18]) {
        const options = { courseId: course.id, count, difficulty, seed: `${course.id}-${difficulty}` };
        const questions = createAutomaticPractice(options);
        assert.equal(questions.length, count);
        assert.equal(new Set(questions.map(question => question.id)).size, count);
        assert.equal(new Set(questions.map(question => question.q)).size, count);
        assert.deepEqual(createAutomaticPractice(options), questions);
        assert.equal(questions.filter(question => question.source === 'bank').length, Math.floor(count / 4));
        for (const lesson of course.lessons) assert.equal(questions.filter(question => question.lessonId === lesson.id).length, count / 6);
        for (const question of questions) {
            const canonical = resolve(question.id);
            for (const field of ['q', 'opts', 'ans', 'exp']) assert.deepEqual(question[field], canonical[field]);
            if (question.source === 'bank') assert.ok(question.id.endsWith(':' + suffix[difficulty]));
            else assert.ok(eligibleIds.has(question.templateId));
            assert.ok(!question.id.startsWith('study:'));
            questionsChecked++;
        }
        const next = createAutomaticPractice({ ...options, excludeIds: questions.map(question => question.id) });
        assert.ok(next.every(question => !questions.some(old => old.id === question.id)), 'Repeat avoids recent bank and generated items');
        sessions++;
    }
    for (const lesson of course.lessons) {
        const questions = createAutomaticPractice({ courseId: course.id, lessonId: lesson.id, count: 12, difficulty, seed: 'single' });
        assert.ok(questions.every(question => question.courseId === course.id && question.lessonId === lesson.id));
        const declared = listTemplates({ courseId: course.id, lessonId: lesson.id }).map(template => rank[template.level]);
        const actual = questions.filter(question => question.source === 'generated').map(question => rank[question.level]);
        if (difficulty === 'easy') assert.ok(actual.every(value => value === Math.min(...declared)));
        if (difficulty === 'hard') assert.ok(actual.every(value => value === Math.max(...declared)));
        if (difficulty === 'medium') {
            assert.ok(actual.includes(Math.min(...declared)) && actual.includes(Math.max(...declared)), 'Medium mixes tiers in each lesson');
        }
        questionsChecked += questions.length; sessions++;
    }
}
assert.equal(getDifficultyLevel('easy'), 'all');
assert.throws(() => getDifficultyLevel('unknown'));
const prefer = listAutomaticTemplates({ courseId: 'arduino', lessonId: 'led', difficulty: 'hard' })[0].id;
assert.ok(createAutomaticPractice({ courseId: 'arduino', lessonId: 'led', count: 3, difficulty: 'hard', preferredTemplateIds: [prefer], seed: 1 }).every(question => question.templateId === prefer));
// A plan must change actual template selection, not just provenance metadata.
for (const course of quizCourses) {
    const templates = listAutomaticTemplates({ courseId: course.id, difficulty: 'medium' });
    const lowIds = [], highIds = [];
    for (const lesson of course.lessons) {
        const scoped = templates.filter(template => template.lessonId === lesson.id).sort((a, b) => rank[a.level] - rank[b.level]);
        lowIds.push(scoped[0].id); highIds.push(scoped.at(-1).id);
    }
    for (const lessonId of ['all', ...course.lessons.map(lesson => lesson.id)]) {
        const scopedLow = lowIds.filter(id => templates.find(template => template.id === id).lessonId === lessonId || lessonId === 'all');
        const scopedHigh = highIds.filter(id => templates.find(template => template.id === id).lessonId === lessonId || lessonId === 'all');
        const options = { courseId: course.id, lessonId, count: lessonId === 'all' ? 18 : 6, difficulty: 'medium', seed: 'same-plan-seed' };
        const low = createAutomaticPractice({ ...options, preferredTemplateIds: scopedLow });
        const high = createAutomaticPractice({ ...options, preferredTemplateIds: scopedHigh });
        assert.notDeepEqual(low, high, 'AI preference changes the resulting question order with the same seed');
        for (const [questions, preferredIds] of [[low, scopedLow], [high, scopedHigh]]) {
            for (const lesson of course.lessons.filter(item => lessonId === 'all' || item.id === lessonId)) {
                const generated = questions.filter(question => question.lessonId === lesson.id && question.source === 'generated');
                assert.ok(preferredIds.includes(generated[0].templateId), 'First actual generated slot follows the AI preference');
                assert.equal(new Set(generated.map(question => question.level)).size, 2, 'Medium still includes both lesson tiers');
            }
        }
    }
}
for (const options of [
    { courseId: 'unknown', count: 6 }, { courseId: 'arduino', count: 5 },
    { courseId: 'arduino', count: 19 }, { courseId: 'arduino', lessonId: 'matrix', count: 3 },
    { courseId: 'arduino', count: 6, difficulty: 'impossible' },
    { courseId: 'arduino', lessonId: 'led', count: 3, difficulty: 'easy', preferredTemplateIds: [prefer] },
    { courseId: 'arduino', count: 6, excludeIds: Array(4001).fill('x') },
    { courseId: 'arduino', count: 6, seed: NaN }
]) assert.throws(() => createAutomaticPractice(options));

// Mixed attempts are reconstructed using each question's canonical bank/engine key.
const values = new Map();
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
const review = new ReviewService({ storage });
const session = createAutomaticPractice({ courseId: 'arduino', count: 18, difficulty: 'medium', seed: 'history' });
assert.ok(session.some(question => question.source === 'bank') && session.some(question => question.source === 'generated'));
assert.equal(review.recordCompletedAttempt({ completed: true, id: 'mixed-history', mode: 'generated', courseId: 'arduino', answers: session.map((question, index) => ({ questionId: question.id, choice: index ? question.ans : (question.ans + 1) % question.opts.length })) }).saved, true);
assert.equal(review.getPracticeHistory('arduino')[0].correct, 17);
assert.equal(review.getPracticeHistory('arduino')[0].total, 18);
assert.equal(review.getPracticeHistory('arduino')[0].percentage, 94);
assert.deepEqual(review.getPracticeHistory('microbit'), []);
assert.deepEqual(review.getPracticeHistory('arduino', 'led'), []);
assert.ok(review.plan('arduino').items.some(item => item.question.id === session[0].id));
const single = createAutomaticPractice({ courseId: 'arduino', lessonId: 'led', count: 6, difficulty: 'easy', seed: 'single-history' });
review.recordCompletedAttempt({ completed: true, id: 'single-history', mode: 'generated', courseId: 'arduino', answers: single.map(question => ({ questionId: question.id, choice: question.ans })) });
assert.equal(review.getPracticeHistory('arduino', 'led')[0].correct, 6);
assert.equal(review.getPracticeHistory('arduino').length, 1, 'Single lesson does not masquerade as a whole-course result');
console.log(`PASS ${sessions} automatic difficulty/scope sessions, ${questionsChecked} canonical answers, automatic source mixing, recent exclusions, policy parity and mixed history/review`);
