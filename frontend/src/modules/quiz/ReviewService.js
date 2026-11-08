import { quizCourses, quizQuestions } from '../../data/quiz.js?v=guided-learning-v15';
import { resolveGeneratedQuestion, getGenerationCapacity } from './generation/QuestionEngine.js?v=generated-v6';

export const REVIEW_STORAGE_KEY = 'strobot.review.evidence.v1';
export const MAX_REVIEW_ATTEMPTS = 120;
const DAY = 24 * 60 * 60 * 1000;
const questionsById = new Map(quizQuestions.map(question => [question.id, question]));
const resolveQuestion = id => questionsById.get(id) || resolveGeneratedQuestion(id);
const validCourse = id => quizCourses.some(course => course.id === id);
const copyQuestion = question => ({ ...question, opts: [...question.opts] });

/* A transparent practice rule, not a model of mastery. Evidence is limited to
   completed sessions from the public practice bank; assessment data is separate. */
export class ReviewService {
    constructor({ storage, now = () => Date.now() } = {}) {
        this.now = now;
        if (storage !== undefined) this.storage = storage;
        else { try { this.storage = typeof window === 'undefined' ? null : window.localStorage; } catch { this.storage = null; } }
    }
    validAttempt(attempt) {
        return attempt && typeof attempt === 'object'
            && typeof attempt.id === 'string' && attempt.id.length > 0 && attempt.id.length <= 150
            && validCourse(attempt.courseId) && ['quiz', 'review', 'generated'].includes(attempt.mode)
            && typeof attempt.completedAt === 'string' && Number.isFinite(Date.parse(attempt.completedAt))
            && new Date(attempt.completedAt).getUTCFullYear() >= 2000 && new Date(attempt.completedAt).getUTCFullYear() <= 2200
            && Array.isArray(attempt.answers) && attempt.answers.length >= 1 && attempt.answers.length <= 18
            && new Set(attempt.answers.map(answer => answer?.questionId)).size === attempt.answers.length
            && attempt.answers.every(answer => {
                const question = resolveQuestion(answer?.questionId);
                return question?.courseId === attempt.courseId && Number.isInteger(answer.choice)
                    && answer.choice >= 0 && answer.choice < question.opts.length;
            });
    }
    cleanAttempt(attempt) {
        return { id: attempt.id, courseId: attempt.courseId, mode: attempt.mode,
            completedAt: new Date(attempt.completedAt).toISOString(),
            answers: attempt.answers.map(({ questionId, choice }) => ({ questionId, choice })) };
    }
    read() {
        if (!this.storage) return { attempts: [], status: 'blocked' };
        try {
            const raw = this.storage.getItem(REVIEW_STORAGE_KEY);
            if (raw === null) return { attempts: [], status: 'ok' };
            if (typeof raw !== 'string' || raw.length > 1000000) return { attempts: [], status: 'corrupt' };
            const data = JSON.parse(raw);
            if (data?.version !== 1 || !Array.isArray(data.attempts)) return { attempts: [], status: 'corrupt' };
            const ids = new Set();
            let rejected = false;
            const attempts = data.attempts.filter(attempt => {
                if (!this.validAttempt(attempt) || ids.has(attempt.id)) { rejected = true; return false; }
                ids.add(attempt.id); return true;
            }).map(attempt => this.cleanAttempt(attempt)).slice(-MAX_REVIEW_ATTEMPTS);
            return { attempts, status: rejected ? 'corrupt' : 'ok' };
        } catch (error) { return { attempts: [], status: error instanceof SyntaxError ? 'corrupt' : 'blocked' }; }
    }
    write(attempts) {
        try {
            if (!this.storage) return false;
            this.storage.setItem(REVIEW_STORAGE_KEY, JSON.stringify({ version: 1, attempts: attempts.slice(-MAX_REVIEW_ATTEMPTS) }));
            return true;
        } catch { return false; }
    }
    recordCompletedAttempt({ completed, id, courseId, mode = 'quiz', answers }) {
        if (completed !== true) return { saved: false, reason: 'incomplete' };
        const completedDate = new Date(this.now());
        if (!Number.isFinite(completedDate.getTime())) return { saved: false, reason: 'invalid-clock' };
        const attempt = { id, courseId, mode, answers, completedAt: completedDate.toISOString() };
        if (!this.validAttempt(attempt)) return { saved: false, reason: 'invalid' };
        const { attempts, status } = this.read();
        if (status === 'blocked') return { saved: false, reason: 'blocked' };
        if (attempts.some(previous => previous.id === id)) return { saved: true, duplicate: true };
        const saved = this.write([...attempts, this.cleanAttempt(attempt)]);
        return { saved, reason: saved ? 'ok' : 'blocked', replacedCorruptData: saved && status === 'corrupt' };
    }
    evidence(courseId) {
        const { attempts, status } = this.read();
        const evidence = new Map();
        // Preserve completion insertion order even if the device clock moves backward.
        for (const attempt of attempts.filter(item => item.courseId === courseId)) {
            for (const answer of attempt.answers) {
                const question = resolveQuestion(answer.questionId);
                const previous = evidence.get(question.id);
                const right = question.ans === answer.choice;
                const streak = right ? (previous?.streak || 0) + 1 : 0;
                const interval = right ? (streak === 1 ? 1 : streak === 2 ? 3 : 7) * DAY : 0;
                evidence.set(question.id, { questionId: question.id, lessonId: question.lessonId,
                    skillId: question.skillId || null, templateId: question.templateId || null, source: question.source || 'bank',
                    attempts: (previous?.attempts || 0) + 1, correct: (previous?.correct || 0) + Number(right),
                    latestCorrect: right, lastAt: attempt.completedAt, streak,
                    dueAt: new Date(Date.parse(attempt.completedAt) + interval).toISOString() });
            }
        }
        return { evidence, status, attempts: attempts.filter(item => item.courseId === courseId) };
    }
    plan(courseId, limit = 6) {
        if (!validCourse(courseId)) throw new RangeError('Chọn khóa học trước khi ôn theo lỗi.');
        if (!Number.isInteger(limit) || limit < 1 || limit > 18) throw new RangeError('Số câu ôn phải từ 1 đến 18.');
        const { evidence, status, attempts } = this.evidence(courseId);
        const staticPool = quizQuestions.filter(question => question.courseId === courseId);
        const practicedGenerated = [...evidence.keys()].filter(id => id.startsWith('gen:v1:')).map(resolveQuestion).filter(Boolean);
        const pool = [...staticPool, ...practicedGenerated];
        const wrong = pool.filter(question => evidence.get(question.id)?.latestCorrect === false)
            .sort((a, b) => Date.parse(evidence.get(a.id).lastAt) - Date.parse(evidence.get(b.id).lastAt) || a.id.localeCompare(b.id));
        const weakLessons = new Set(wrong.map(question => question.lessonId));
        const unseen = staticPool.filter(question => !evidence.has(question.id) && weakLessons.has(question.lessonId));
        const due = pool.filter(question => evidence.get(question.id)?.latestCorrect && Date.parse(evidence.get(question.id).dueAt) <= this.now())
            .sort((a, b) => Date.parse(evidence.get(a.id).dueAt) - Date.parse(evidence.get(b.id).dueAt) || a.id.localeCompare(b.id));
        const candidates = [
            ...wrong.map(question => ({ question: copyQuestion(question), reasonType: 'wrong', reason: 'Ôn lại câu đã trả lời sai ở lần gần nhất.' })),
            ...unseen.map(question => ({ question: copyQuestion(question), reasonType: 'unseen', reason: 'Luyện thêm câu mới trong bài có câu trả lời sai.' })),
            ...due.map(question => ({ question: copyQuestion(question), reasonType: 'due', reason: 'Câu đã trả lời đúng và đã đến ngày ôn lại.' }))
        ];
        const futureDates = [...evidence.values()].filter(item => item.latestCorrect && Date.parse(item.dueAt) > this.now()).map(item => item.dueAt).sort();
        const course = quizCourses.find(item => item.id === courseId);
        const lessons = course.lessons.map(lesson => {
            const rows = [...evidence.values()].filter(item => item.lessonId === lesson.id);
            return { ...lesson, distinct: rows.length, questionCount: staticPool.filter(question => question.lessonId === lesson.id).length + getGenerationCapacity(courseId, lesson.id),
                attempts: rows.reduce((sum, item) => sum + item.attempts, 0), correct: rows.reduce((sum, item) => sum + item.correct, 0),
                latestCorrect: rows.filter(item => item.latestCorrect).length, latestWrong: rows.filter(item => !item.latestCorrect).length,
                insufficient: rows.length < 3 };
        });
        return { courseId, items: candidates.slice(0, limit), availableCount: candidates.length, lessons,
            status, hasEvidence: evidence.size > 0, attemptCount: attempts.length, nextDueAt: futureDates[0] || null };
    }
    exportCourse(courseId) {
        if (!validCourse(courseId)) throw new RangeError('Khóa học không hợp lệ.');
        const { attempts, status } = this.evidence(courseId);
        if (status === 'blocked') throw new Error('Không đọc được dữ liệu trên trình duyệt này.');
        return { version: 1, type: 'strobot-practice-backup', courseId, exportedAt: new Date(this.now()).toISOString(), attempts };
    }
    getPracticeHistory(courseId, lessonId = 'all') {
        const course = quizCourses.find(item => item.id === courseId);
        if (!course || (lessonId !== 'all' && !course.lessons.some(lesson => lesson.id === lessonId))) return [];
        return this.evidence(courseId).attempts.filter(attempt => ['quiz', 'generated'].includes(attempt.mode)).flatMap(attempt => {
            const questions = attempt.answers.map(answer => resolveQuestion(answer.questionId));
            const lessons = new Set(questions.map(question => question.lessonId));
            const matches = lessonId === 'all' ? lessons.size === course.lessons.length : lessons.size === 1 && lessons.has(lessonId);
            if (!matches) return [];
            const correct = questions.filter((question, index) => question.ans === attempt.answers[index].choice).length;
            return [{ id: attempt.id, createdAt: attempt.completedAt, correct, total: questions.length, percentage: Math.round(correct / questions.length * 100) }];
        }).reverse();
    }
    clearCourse(courseId) {
        if (!validCourse(courseId)) return false;
        const { attempts, status } = this.read();
        if (status === 'blocked') return false;
        return this.write(attempts.filter(attempt => attempt.courseId !== courseId));
    }
}
