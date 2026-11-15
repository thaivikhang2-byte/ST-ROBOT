// Only learning records from the current page's account-scoped storage may be
// sent to the vision/guest tutor. Never enumerate localStorage or sessionStorage.
const COURSE_IDS = new Set(['arduino', 'microbit', 'vex-iq', 'lego-spike', 'vex-vr']);
const SOURCES = new Set(['local-model', 'external', 'hardware']);
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const lessonId = value => typeof value === 'string' && /^[a-z0-9-]{1,40}$/.test(value);

function read(storage, key, maximum) {
    try {
        const raw = storage?.getItem(key);
        return typeof raw === 'string' && raw.length <= maximum ? JSON.parse(raw) : null;
    } catch { return null; }
}

export function buildTutorLearningContext({ courses = [], courseId, lessonId: currentLessonId,
    storage, currentRecord } = {}) {
    if (!COURSE_IDS.has(courseId) || !lessonId(currentLessonId)) return undefined;
    const catalog = courses.filter(course => COURSE_IDS.has(course?.id) && Array.isArray(course.lessons)).slice(0, 5);
    const saved = read(storage, 'strobot.original.course.v3', 8 * 1024 * 1024);
    const records = plain(saved) ? saved : {};
    const activeCourse = catalog.find(course => course.id === courseId);
    if (!activeCourse?.lessons.some(lesson => lesson.id === currentLessonId)) return undefined;
    const record = plain(currentRecord) ? currentRecord
        : (plain(records[courseId]?.[currentLessonId]) ? records[courseId][currentLessonId] : {});
    const journal = {};
    for (const [key, max] of [['note', 1600], ['prediction', 600], ['observation', 600], ['explanation', 600], ['transfer', 600]]) {
        const value = text(record[key], max);
        if (value) journal[key] = value;
    }
    if (SOURCES.has(record.source)) journal.practiceSource = record.source;
    const history = read(storage, 'strobot.quiz.history.v1', 512 * 1024);
    const quizHistory = (Array.isArray(history) ? history : []).filter(result =>
        plain(result) && COURSE_IDS.has(result.courseId) && Number.isInteger(result.correct)
        && Number.isInteger(result.total) && result.total >= 1 && result.total <= 100
        && result.correct >= 0 && result.correct <= result.total
    ).slice(0, 5).map(result => ({
        courseId: result.courseId,
        ...(lessonId(result.lessonId) ? { lessonId: result.lessonId } : {}),
        correct: result.correct, total: result.total,
    }));
    return {
        version: 1,
        source: 'browser-self-report',
        courses: catalog.map(course => {
            const ids = course.lessons.map(lesson => lesson.id).filter(lessonId).slice(0, 30);
            const entries = plain(records[course.id]) ? records[course.id] : {};
            return {
                courseId: course.id,
                completedLessonIds: ids.filter(id => entries[id]?.done === true),
                savedLessonIds: ids.filter(id => plain(entries[id])),
            };
        }),
        currentLesson: { courseId, lessonId: currentLessonId, completed: record.done === true, journal },
        quizHistory,
    };
}
