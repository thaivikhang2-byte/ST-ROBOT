import { quizCourses } from '../../../data/quiz.js?v=generated-v6';
import { arduinoTemplates } from './templates/arduino.js?v=generated-v6';
import { creativeTemplates } from './templates/creative.js?v=generated-v6';
import { roboticsTemplates } from './templates/robotics.js?v=generated-v6';
import { hashString } from './helpers.js';

// A released ID is a reproducible question, including its answer order. Preserve
// v1 definitions when adding future versions so saved evidence stays readable.
export const GENERATION_VERSION = 1;
const LEVELS = new Set(['all', 'basic', 'apply', 'reason']);
const templates = [...arduinoTemplates, ...creativeTemplates, ...roboticsTemplates];
const byId = new Map();
const courses = new Map(quizCourses.map(course => [course.id, course]));
for (const template of templates) {
    const course = courses.get(template.courseId);
    if (!/^[a-z0-9-]{1,80}$/.test(template.id) || byId.has(template.id)
        || !course?.lessons.some(lesson => lesson.id === template.lessonId)
        || !LEVELS.has(template.level) || template.level === 'all'
        || typeof template.skillId !== 'string' || !template.skillId
        || !Number.isSafeInteger(template.variantCount) || template.variantCount < 1 || template.variantCount > 1000000
        || typeof template.render !== 'function') throw new TypeError('Invalid practice template metadata');
    byId.set(template.id, template);
}

function validateScope({ courseId, lessonId = 'all', level = 'all' } = {}) {
    if (!LEVELS.has(level) || typeof lessonId !== 'string') throw new RangeError('Chọn dạng bài hợp lệ.');
    if (courseId === undefined && lessonId === 'all') return { course: null, lessonId, level };
    const course = courses.get(courseId);
    if (!course || (lessonId !== 'all' && !course.lessons.some(lesson => lesson.id === lessonId))) {
        throw new RangeError('Chọn đúng khóa và bài học để tạo câu mới.');
    }
    return { course, lessonId, level };
}

export function listTemplates(options = {}) {
    const { course, lessonId, level } = validateScope(options);
    return templates.filter(template => (!course || template.courseId === course.id)
        && (lessonId === 'all' || template.lessonId === lessonId)
        && (level === 'all' || template.level === level))
        .map(({ id, courseId, lessonId, skillId, level, variantCount }) => ({ id, courseId, lessonId, skillId, level, variantCount }));
}

export function getGenerationCapacity(courseId, lessonId = 'all', level = 'all') {
    return listTemplates({ courseId, lessonId, level }).reduce((sum, template) => sum + template.variantCount, 0);
}

function render(template, index) {
    const value = template.render(index);
    if (!value || typeof value.q !== 'string' || !value.q.trim() || value.q.length > 5000
        || typeof value.exp !== 'string' || !value.exp.trim() || value.exp.length > 5000
        || !Array.isArray(value.opts) || value.opts.length < 3 || value.opts.length > 4
        || value.opts.some(option => typeof option !== 'string' || !option.trim() || option.length > 1500)
        || new Set(value.opts.map(option => option.trim())).size !== value.opts.length
        || !Number.isInteger(value.ans) || value.ans < 0 || value.ans >= value.opts.length) {
        throw new TypeError(`Invalid question from ${template.id}`);
    }
    return { id: `gen:v1:${template.id}:${index}`, courseId: template.courseId, lessonId: template.lessonId,
        q: value.q, opts: [...value.opts], ans: value.ans, exp: value.exp,
        skillId: template.skillId, templateId: template.id, source: 'generated', level: template.level,
        variantIndex: index, engineVersion: GENERATION_VERSION };
}

export function resolveGeneratedQuestion(id) {
    if (typeof id !== 'string' || id.length > 110) return null;
    const match = /^gen:v1:([a-z0-9-]{1,80}):(0|[1-9]\d{0,6})$/.exec(id);
    if (!match) return null;
    const template = byId.get(match[1]), index = Number(match[2]);
    if (!template || !Number.isSafeInteger(index) || index >= template.variantCount) return null;
    try { return render(template, index); } catch { return null; }
}

function random(seed) {
    let state = hashString(seed);
    return () => {
        state = (state + 0x6D2B79F5) | 0;
        let value = Math.imul(state ^ state >>> 15, 1 | state);
        value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
        return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
}
function shuffle(items, rng) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}
function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }

export function createGeneratedQuiz({ courseId, lessonId = 'all', count, level = 'all', seed,
    excludeIds = [], focusLessonIds = [], preferredTemplateIds = [] } = {}) {
    const { course } = validateScope({ courseId, lessonId, level });
    if (!course || !Number.isInteger(count) || count < 1 || count > 18) throw new RangeError('Chọn từ 1 đến 18 câu cho một lượt luyện.');
    if (!Array.isArray(excludeIds) || excludeIds.length > 5000 || excludeIds.some(id => typeof id !== 'string')
        || !Array.isArray(focusLessonIds) || focusLessonIds.length > 6
        || focusLessonIds.some(id => !course.lessons.some(lesson => lesson.id === id))
        || !Array.isArray(preferredTemplateIds) || preferredTemplateIds.length > 60) throw new TypeError('Dữ liệu chọn câu không hợp lệ.');
    const scoped = listTemplates({ courseId, lessonId, level });
    const allowed = new Set(scoped.map(template => template.id));
    if (preferredTemplateIds.some(id => typeof id !== 'string' || !allowed.has(id))) throw new RangeError('Gợi ý dạng bài phải thuộc nội dung đã chọn.');
    const focus = lessonId === 'all' ? [...new Set(focusLessonIds)] : [];
    const lessonIds = lessonId === 'all' ? (focus.length ? focus : course.lessons.map(lesson => lesson.id)) : [lessonId];
    if (lessonId === 'all' && !focus.length && count % lessonIds.length) throw new RangeError('Lượt cả khóa cần chia đều cho 6 bài.');
    if (lessonIds.some(id => !scoped.some(template => template.lessonId === id))) throw new RangeError('Chọn tất cả dạng bài để luyện đủ phạm vi này.');
    if (seed !== undefined && !['string', 'number'].includes(typeof seed)) throw new TypeError('Seed must be a string or number');
    const rng = random(seed === undefined ? `${Date.now()}:${Math.random()}` : String(seed));
    const excluded = new Set(excludeIds), preferred = new Set(preferredTemplateIds);
    const pools = new Map(lessonIds.map(id => {
        const entries = shuffle(scoped.filter(template => template.lessonId === id), rng)
            .sort((a, b) => Number(preferred.has(b.id)) - Number(preferred.has(a.id)))
            .map(metadata => {
                const size = metadata.variantCount;
                let step = Math.max(1, Math.floor(rng() * size));
                while (gcd(step, size) !== 1) step++;
                return { template: byId.get(metadata.id), offset: Math.floor(rng() * size), step, visited: 0 };
            });
        return [id, { entries, cursor: 0 }];
    }));
    const seenStems = new Set(), selected = [];
    const nextQuestion = lesson => {
        const pool = pools.get(lesson);
        while (pool.entries.some(entry => entry.visited < entry.template.variantCount)) {
            const entry = pool.entries[pool.cursor++ % pool.entries.length];
            if (entry.visited >= entry.template.variantCount) continue;
            const index = (entry.offset + entry.step * entry.visited++) % entry.template.variantCount;
            const id = `gen:v1:${entry.template.id}:${index}`;
            if (excluded.has(id)) continue;
            const question = render(entry.template, index);
            if (seenStems.has(question.q)) continue;
            seenStems.add(question.q); return question;
        }
        return null;
    };
    const order = shuffle(lessonIds, rng);
    for (let index = 0; index < count; index++) {
        const question = nextQuestion(order[index % order.length]);
        if (!question) throw new RangeError('Các câu trong phạm vi này đã được luyện gần đây. Hãy chọn thêm bài hoặc dạng bài.');
        selected.push(question);
    }
    return selected;
}
