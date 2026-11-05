import { quizCourses, quizQuestions } from '../../../data/quiz.js?v=simple-quiz-v7';
import { createGeneratedQuiz } from './QuestionEngine.js?v=simple-quiz-v7';
import { listAutomaticTemplates, getDifficultyLevel } from './DifficultyPolicy.js?v=simple-quiz-v7';
import { hashString } from './helpers.js';
export { listAutomaticTemplates, getDifficultyLevel };

const courseById = new Map(quizCourses.map(course => [course.id, course]));
const bankType = { easy: 'core', medium: 'apply', hard: 'reason' };
const rank = { basic: 0, apply: 1, reason: 2 };
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
    const values = [...items];
    for (let index = values.length - 1; index > 0; index--) {
        const other = Math.floor(rng() * (index + 1));
        [values[index], values[other]] = [values[other], values[index]];
    }
    return values;
}

export function createAutomaticPractice({ courseId, lessonId = 'all', count, difficulty = 'medium',
    seed, excludeIds = [], preferredTemplateIds = [] } = {}) {
    getDifficultyLevel(difficulty);
    const course = courseById.get(courseId);
    if (!course || !Number.isInteger(count) || count < 1 || count > 18
        || (lessonId !== 'all' && !course.lessons.some(lesson => lesson.id === lessonId))
        || (lessonId === 'all' && count % course.lessons.length)) throw new RangeError('Chọn đúng khóa, bài và số câu cho đề.');
    if (!Array.isArray(excludeIds) || excludeIds.length > 4000 || excludeIds.some(id => typeof id !== 'string')
        || !Array.isArray(preferredTemplateIds) || preferredTemplateIds.length > 60
        || (seed !== undefined && (!['string', 'number'].includes(typeof seed) || (typeof seed === 'number' && !Number.isFinite(seed))))) throw new TypeError('Dữ liệu tạo đề không hợp lệ.');
    const eligible = listAutomaticTemplates({ courseId, lessonId, difficulty });
    const eligibleIds = new Set(eligible.map(template => template.id));
    if (preferredTemplateIds.some(id => typeof id !== 'string' || !eligibleIds.has(id))) throw new RangeError('Gợi ý dạng bài phải khớp mức độ và nội dung đã chọn.');
    const sessionSeed = seed === undefined ? `${Date.now()}:${Math.random()}` : String(seed);
    const rng = random(sessionSeed);
    const lessonIds = shuffle(course.lessons.filter(lesson => lessonId === 'all' || lesson.id === lessonId).map(lesson => lesson.id), rng);
    const perLesson = count / lessonIds.length;
    const excluded = new Set(excludeIds), selected = [], selectedStems = new Set();
    const bankChoices = new Map();
    const bankBudget = Math.floor(count / 4);
    // Existing approved questions supplement fresh variants. Recent bank items
    // are skipped, rather than being forced into every repeat of a small scope.
    for (const id of shuffle(lessonIds, rng)) {
        if (bankChoices.size >= bankBudget) break;
        const candidates = quizQuestions.filter(question => question.courseId === courseId && question.lessonId === id
            && question.id.endsWith(`:${bankType[difficulty]}`) && !excluded.has(question.id));
        const question = shuffle(candidates, rng)[0];
        if (question) bankChoices.set(id, { ...question, opts: [...question.opts], source: 'bank' });
    }
    const offset = Math.floor(rng() * 2);
    for (let round = 0; round < perLesson; round++) {
        for (let position = 0; position < lessonIds.length; position++) {
            const id = lessonIds[position];
            let question = round === 0 ? bankChoices.get(id) : null;
            if (!question) {
                const choices = eligible.filter(template => template.lessonId === id);
                if (!choices.length) throw new RangeError('Phạm vi đã chọn cần thêm dạng bài. Hãy chọn lại nội dung.');
                const levels = [...new Set(choices.map(template => template.level))].sort((a, b) => rank[a] - rank[b]);
                const preferredLevel = preferredTemplateIds.map(templateId => choices.find(template => template.id === templateId)?.level).find(Boolean);
                const firstGeneratedRound = bankChoices.has(id) ? 1 : 0;
                const start = preferredLevel ? levels.indexOf(preferredLevel) + round - firstGeneratedRound : round + position + offset;
                const requestedLevel = difficulty === 'medium' ? levels[start % levels.length] : levels[0];
                const candidateLevels = [requestedLevel, ...levels.filter(level => level !== requestedLevel)];
                let lastError;
                for (const level of candidateLevels) {
                    try {
                        const allowed = new Set(choices.filter(template => template.level === level).map(template => template.id));
                        [question] = createGeneratedQuiz({ courseId, lessonId: id, count: 1, level,
                            seed: `${sessionSeed}:${id}:${round}:${level}`, excludeIds: [...excluded],
                            preferredTemplateIds: preferredTemplateIds.filter(templateId => allowed.has(templateId)) });
                        break;
                    } catch (error) {
                        if (!(error instanceof RangeError) || !error.message.includes('đã được luyện gần đây')) throw error;
                        lastError = error;
                    }
                }
                if (!question) throw lastError;
            }
            if (selectedStems.has(question.q)) throw new Error('Đề có câu trùng nội dung. Hãy tạo lại đề.');
            selected.push(question); excluded.add(question.id); selectedStems.add(question.q);
        }
    }
    return selected;
}
