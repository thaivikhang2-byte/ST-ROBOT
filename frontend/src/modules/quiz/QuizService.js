import { quizCourses, quizQuestions } from '../../data/quiz.js?v=quiz-20261103-v3';

export const QUIZ_HISTORY_KEY = 'strobot.quiz.history.v1';
const clone = question => ({ ...question, opts: [...question.opts] });

export class QuizService {
    constructor({ random = Math.random, storage } = {}) {
        this.random = random;
        if (storage !== undefined) this.storage = storage;
        else { try { this.storage = typeof window === 'undefined' ? null : window.localStorage; } catch { this.storage = null; } }
    }
    getCourses() { return quizCourses.map(c => ({ ...c, lessons: c.lessons.map(l => ({ ...l })) })); }
    getLessons(courseId) { return this.getCourses().find(c => c.id === courseId)?.lessons || []; }
    getQuestions(courseId, lessonId = 'all') {
        return quizQuestions.filter(q => q.courseId === courseId && (lessonId === 'all' || q.lessonId === lessonId)).map(clone);
    }
    getAvailableCounts(courseId, lessonId = 'all') {
        const pool = this.getQuestions(courseId, lessonId);
        if (!pool.length) return [];
        if (lessonId !== 'all') return [pool.length];
        const lessons = this.getLessons(courseId);
        const rounds = Math.min(...lessons.map(l => pool.filter(q => q.lessonId === l.id).length));
        return Array.from({ length: rounds }, (_, index) => (index + 1) * lessons.length);
    }
    shuffle(items) {
        const copy = [...items];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(this.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    }
    createQuiz({ courseId, lessonId = 'all', count }) {
        if (!this.getAvailableCounts(courseId, lessonId).includes(count)) throw new RangeError('Hãy chọn khóa học, bài học và số câu phù hợp.');
        const pool = this.getQuestions(courseId, lessonId);
        const lessons = this.getLessons(courseId).filter(l => lessonId === 'all' || l.id === lessonId);
        const groups = this.shuffle(lessons.map(l => this.shuffle(pool.filter(q => q.lessonId === l.id))));
        const selected = [];
        while (selected.length < count) {
            for (const group of groups) {
                if (group.length && selected.length < count) selected.push(group.pop());
            }
        }
        return this.shuffle(selected);
    }
    grade(questions, responses) {
        const byLesson = new Map();
        let correct = 0;
        questions.forEach((q, index) => {
            const right = responses[index] === q.ans;
            if (right) correct++;
            if (!byLesson.has(q.lessonId)) byLesson.set(q.lessonId, { lessonId: q.lessonId, title: this.getLessons(q.courseId).find(l => l.id === q.lessonId)?.title || q.lessonId, correct: 0, total: 0 });
            const row = byLesson.get(q.lessonId);
            row.total++;
            if (right) row.correct++;
        });
        return { correct, total: questions.length, percentage: questions.length ? Math.round(correct / questions.length * 100) : 0, byLesson: [...byLesson.values()] };
    }
    validResult(r) {
        if (!r || typeof r !== 'object') return false;
        return typeof r.id === 'string' && r.id.length > 0 && quizCourses.some(c => c.id === r.courseId)
            && (r.lessonId === 'all' || this.getLessons(r.courseId).some(l => l.id === r.lessonId))
            && Number.isInteger(r.total) && r.total > 0 && Number.isInteger(r.correct) && r.correct >= 0 && r.correct <= r.total
            && r.percentage === Math.round(r.correct / r.total * 100) && typeof r.createdAt === 'string' && Number.isFinite(Date.parse(r.createdAt));
    }
    readHistory() {
        try {
            const records = JSON.parse(this.storage?.getItem(QUIZ_HISTORY_KEY) || '[]');
            return Array.isArray(records) ? records.filter(r => this.validResult(r)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 20) : [];
        } catch { return []; }
    }
    getHistory(courseId, lessonId = 'all') { return this.readHistory().filter(r => r.courseId === courseId && r.lessonId === lessonId); }
    deleteHistory(courseId) {
        if (!this.storage || !this.getCourses().some(course => course.id === courseId)) return false;
        try {
            this.storage.setItem(QUIZ_HISTORY_KEY, JSON.stringify(this.readHistory().filter(record => record.courseId !== courseId)));
            return true;
        } catch { return false; }
    }
    saveResult(snapshot) {
        if (!this.storage || !this.validResult(snapshot)) return false;
        try {
            const { id, courseId, lessonId, correct, total, percentage, createdAt } = snapshot;
            const record = { id, courseId, lessonId, correct, total, percentage, createdAt };
            const records = [record, ...this.readHistory().filter(r => r.id !== id)].slice(0, 20);
            this.storage.setItem(QUIZ_HISTORY_KEY, JSON.stringify(records));
            return true;
        } catch { return false; }
    }
}
