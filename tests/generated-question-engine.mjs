import assert from 'node:assert/strict';
import { quizCourses, quizQuestions } from '../frontend/src/data/quiz.js';
import { ASSESSMENT_FORMS } from '../frontend/src/data/assessment.js';
import { listTemplates, resolveGeneratedQuestion, createGeneratedQuiz, getGenerationCapacity } from '../frontend/src/modules/quiz/generation/QuestionEngine.js';
import { formatNumber } from '../frontend/src/modules/quiz/generation/helpers.js';
import * as serverEngine from '../ai-server/generation/QuestionEngine.js';

const registry = listTemplates();
assert.equal(registry.length, 60);
assert.equal(new Set(registry.map(template => template.id)).size, registry.length);
const reservedText = new Set([...quizQuestions, ...Object.values(ASSESSMENT_FORMS).flat()].map(question => question.q));
const stems = new Set();
const numeric = value => Number(value.match(/^-?\d+(?:,\d+)?/)[0].replace(',', '.'));
let total = 0;
for (const template of registry) {
    assert.ok(quizCourses.find(course => course.id === template.courseId)?.lessons.some(lesson => lesson.id === template.lessonId));
    for (let index = 0; index < template.variantCount; index++) {
        const id = `gen:v1:${template.id}:${index}`;
        const question = resolveGeneratedQuestion(id);
        assert.ok(question, id);
        assert.equal(question.courseId, template.courseId);
        assert.equal(question.lessonId, template.lessonId);
        assert.equal(question.engineVersion, 1);
        assert.equal(new Set(question.opts).size, question.opts.length);
        assert.ok(question.opts.length >= 3 && question.opts.length <= 4);
        assert.ok(Number.isInteger(question.ans) && question.opts[question.ans]);
        assert.ok(!stems.has(question.q), `Repeated scenario counted as new: ${id}`);
        assert.ok(!reservedText.has(question.q), `Practice/assessment item copied: ${id}`);
        stems.add(question.q); total++;
        assert.deepEqual(resolveGeneratedQuestion(id), question, 'IDs must reconstruct the same answer order');
        // Independently calculate the Arduino answers from the visible given values.
        if (template.courseId === 'arduino') {
            const numbers = [...question.q.matchAll(/-?\d+(?:,\d+)?/g)].map(match => Number(match[0].replace(',', '.')));
            let expected;
            switch (template.id) {
                case 'arduino-led-current': expected = (numbers[0] - numbers[1]) / numbers[2] * 1000; break;
                case 'arduino-led-resistor': expected = (numbers[0] - numbers[1]) / (numbers[2] / 1000); break;
                case 'arduino-timing-frequency': expected = 1000 / (numbers[0] + numbers[1]); break;
                case 'arduino-timing-duty': expected = numbers[0] * numbers[1] / 100; break;
                case 'arduino-distance-echo': expected = numbers[0] * numbers[1] / 2; break;
                case 'arduino-distance-valid-mean': expected = (numbers[0] + numbers[1]) / 2; break;
                case 'arduino-calibration-offset': expected = numbers[1] - numbers[0]; break;
                case 'arduino-calibration-absolute-error': expected = Math.abs(numbers[1] - numbers[0]); break;
                case 'arduino-alarm-boundary': {
                    const values = numbers.slice(-3);
                    assert.equal(question.opts[question.ans], values.map(distance => distance < numbers[0] ? 'ON' : 'OFF').join(' → ')); break;
                }
                case 'arduino-alarm-test-boundary': expected = numbers[0]; break;
                case 'arduino-project-hysteresis': {
                    let state = false;
                    const sequence = numbers.slice(-4).map(distance => {
                        if (distance < numbers[0]) state = true; else if (distance > numbers[1]) state = false;
                        return state ? 'ON' : 'OFF';
                    });
                    assert.equal(question.opts[question.ans], sequence.join(' → ')); break;
                }
                case 'arduino-project-timeout-memory': {
                    const state = question.q.match(/đang (ON|OFF)/)[1];
                    assert.equal(question.opts[question.ans], `${state}; đèn ${state === 'ON' ? 'sáng' : 'tắt'}`); break;
                }
                default: assert.fail(`Missing independent Arduino oracle ${template.id}`);
            }
            if (expected !== undefined) assert.ok(Math.abs(numeric(question.opts[question.ans]) - expected) <= 0.00500001, id);
        }
    }
    for (const index of [0, Math.floor(template.variantCount / 2), template.variantCount - 1]) {
        const id = `gen:v1:${template.id}:${index}`;
        assert.deepEqual(serverEngine.resolveGeneratedQuestion(id), resolveGeneratedQuestion(id), 'Server/browser engine drift');
    }
}
assert.equal(total, getGenerationCapacity());
assert.deepEqual(serverEngine.listTemplates(), registry);
assert.equal(formatNumber(4.125), '4,13');
assert.equal(formatNumber(-4.125), '-4,13');
assert.equal(formatNumber(84.375), '84,38');
assert.equal(formatNumber(-0.00001), '0');

for (const course of quizCourses) {
    for (const count of [6, 12, 18]) {
        const questions = createGeneratedQuiz({ courseId: course.id, count, seed: 'balanced' });
        assert.equal(questions.length, count);
        assert.equal(new Set(questions.map(question => question.id)).size, count);
        for (const lesson of course.lessons) assert.equal(questions.filter(question => question.lessonId === lesson.id).length, count / 6);
        assert.deepEqual(questions, createGeneratedQuiz({ courseId: course.id, count, seed: 'balanced' }));
        const fresh = createGeneratedQuiz({ courseId: course.id, count, seed: 'balanced', excludeIds: questions.map(question => question.id) });
        assert.ok(fresh.every(question => !questions.some(previous => previous.id === question.id)));
    }
    for (const lesson of course.lessons) {
        const questions = createGeneratedQuiz({ courseId: course.id, lessonId: lesson.id, count: 12, seed: 'lesson' });
        assert.ok(questions.every(question => question.courseId === course.id && question.lessonId === lesson.id));
        assert.ok(getGenerationCapacity(course.id, lesson.id) > 12);
    }
}
const focused = createGeneratedQuiz({ courseId: 'arduino', count: 12, focusLessonIds: ['led'], seed: 12 });
assert.ok(focused.every(question => question.lessonId === 'led'));
const preferred = createGeneratedQuiz({ courseId: 'arduino', lessonId: 'led', count: 3, preferredTemplateIds: ['arduino-led-resistor'], seed: 1 });
assert.equal(preferred[0].templateId, 'arduino-led-resistor');
for (const id of ['study:A:led:1', 'gen:v0:arduino-led-current:1', 'gen:v1:unknown:0', 'gen:v1:arduino-led-current:-1', 'gen:v1:arduino-led-current:01', 'gen:v1:arduino-led-current:1.0', 'gen:v1:arduino-led-current:360', 'gen:v1:__proto__:0', '', null]) assert.equal(resolveGeneratedQuestion(id), null);
for (const options of [{ courseId: 'unknown', count: 6 }, { courseId: 'arduino', count: 5 }, { courseId: 'arduino', count: 19 }, { courseId: 'arduino', lessonId: 'matrix', count: 3 }, { courseId: 'arduino', count: 6, focusLessonIds: ['matrix'] }, { courseId: 'arduino', count: 6, preferredTemplateIds: ['mb-matrix-pixel'] }]) assert.throws(() => createGeneratedQuiz(options));
const exhausted = Array.from({ length: 360 }, (_, index) => `gen:v1:arduino-led-current:${index}`);
assert.throws(() => createGeneratedQuiz({ courseId: 'arduino', lessonId: 'led', level: 'basic', count: 3, excludeIds: exhausted }), /đã được luyện gần đây/);
console.log(`PASS ${registry.length} verified templates, ${total} distinct parameterized scenarios, all 30 lessons, Arduino oracles, deterministic reconstruction, scope/balance/focus/exclusions and portable server parity`);
