import { QuizService } from './QuizService.js?v=simple-quiz-v7';
import { ReviewService } from './ReviewService.js?v=simple-quiz-v7';
import { QuizRenderer } from './QuizRenderer.js?v=simple-quiz-v7';
import { createAutomaticPractice, getDifficultyLevel, listAutomaticTemplates } from './generation/AutomaticPractice.js?v=simple-quiz-v7';

const el = id => document.getElementById(id);
const PRACTICE_PLAN_URL = 'https://st-robot-1.onrender.com/api/practice-plan';
const DIFFICULTY_NAMES = { easy: 'Dễ', medium: 'Vừa', hard: 'Khó' };
const PLAN_TIMEOUT = 4000;
const PLAN_CACHE_TTL = 5 * 60 * 1000;
const PLAN_FAILURE_COOLDOWN = 60 * 1000;

export class QuizController {
    constructor() {
        this.service = new QuizService();
        this.renderer = new QuizRenderer();
        this.review = new ReviewService();
        this.reviewReasons = new Map(); this.attemptId = null; this.deleteCourseId = null;
        this.questions = []; this.responses = []; this.activeIndex = 0; this.config = null; this.completed = false;
        this.generationToken = 0; this.generationAbort = null; this.isGenerating = false;
        this.planCache = new Map(); this.plannerCooldownUntil = 0;
    }
    init() {
        const courses = this.service.getCourses();
        this.renderer.options(el('quizCourseSelect'), [{ id: '', title: '— Chọn khóa học —' }, ...courses.map(c => ({ id: c.id, title: c.name }))]);
        const params = new URLSearchParams(location.search);
        if (courses.some(c => c.id === params.get('course'))) el('quizCourseSelect').value = params.get('course');
        if (Object.hasOwn(DIFFICULTY_NAMES, params.get('difficulty'))) el('quizDifficulty').value = params.get('difficulty');
        this.syncScope(true, params.get('lesson'));
        el('quizCourseSelect').addEventListener('change', () => this.syncScope(true));
        el('quizLessonSelect').addEventListener('change', () => this.syncScope(false, null, true));
        for (const id of ['quizQuestionCount', 'quizDifficulty']) el(id).addEventListener('change', () => this.syncScope());
        el('quizCancelGeneration').addEventListener('click', () => { this.cancelGeneration('Đã hủy chuẩn bị đề.'); el('btnInitQuiz').focus(); });
        el('quizSetupForm').addEventListener('submit', event => { event.preventDefault(); this.startQuiz(); });
        el('quizAnswerForm').addEventListener('change', () => {
            if (this.responses[this.activeIndex] !== null) return;
            el('confirmAnswerBtn').disabled = !el('answerOptionsArea').querySelector('input:checked');
            el('answerOptionsArea').querySelectorAll('.answer-btn').forEach(label => label.classList.toggle('answer-selected', label.querySelector('input').checked));
        });
        el('quizAnswerForm').addEventListener('submit', event => { event.preventDefault(); this.confirmAnswer(); });
        el('forwardBtn').addEventListener('click', () => this.nextQuestion());
        el('backQuestionBtn').addEventListener('click', () => { if (this.activeIndex > 0) { this.activeIndex--; this.renderQuestion(); } });
        el('btnRestartQuiz').addEventListener('click', () => this.config.mode === 'review' ? this.startReview(this.config.courseId) : this.startQuiz(this.config));
        el('btnBackIntro').addEventListener('click', () => this.returnToSetup());
        el('quizExitBtn').addEventListener('click', () => el('quizExitDialog').showModal());
        el('quizContinueBtn').addEventListener('click', () => el('quizExitDialog').close());
        el('quizDiscardBtn').addEventListener('click', () => { el('quizExitDialog').close(); this.returnToSetup(); });
        el('btnAdaptiveReview').addEventListener('click', () => this.startReview(el('quizCourseSelect').value));
        el('btnReviewNext').addEventListener('click', () => this.startReview(this.config.courseId));
        el('btnExportReview').addEventListener('click', () => this.exportReview());
        el('btnDeleteReview').addEventListener('click', () => {
            this.deleteCourseId = el('quizCourseSelect').value;
            const course = this.service.getCourses().find(item => item.id === this.deleteCourseId);
            if (!course) return;
            el('reviewDeleteDescription').textContent = `Xóa hồ sơ ôn và lịch sử kiểm tra của ${course.name} trên trình duyệt này? Hành động này không hoàn tác được trong website.`;
            el('reviewDeleteDialog').showModal();
        });
        el('btnCancelDeleteReview').addEventListener('click', () => el('reviewDeleteDialog').close());
        el('btnConfirmDeleteReview').addEventListener('click', () => {
            const reviewDeleted = this.review.clearCourse(this.deleteCourseId);
            const historyDeleted = this.service.deleteHistory(this.deleteCourseId);
            el('reviewDeleteDialog').close(); this.syncScope();
            el('reviewDataNotice').textContent = reviewDeleted && historyDeleted
                ? 'Đã xóa dữ liệu của khóa đã chọn.'
                : 'Chưa xóa được toàn bộ dữ liệu vì trình duyệt chặn lưu trữ. Hãy kiểm tra lại trước khi dùng chung trình duyệt.';
            el('btnDeleteReview').focus();
        });
    }
    syncScope(resetLesson = false, requestedLesson = null, resetCount = false) {
        this.cancelGeneration();
        const courseId = el('quizCourseSelect').value;
        const course = this.service.getCourses().find(c => c.id === courseId);
        const previousLesson = resetLesson ? requestedLesson || 'all' : el('quizLessonSelect').value;
        const previousCount = resetLesson || resetCount ? 0 : Number(el('quizQuestionCount').value);
        const lessons = this.service.getLessons(courseId);
        this.renderer.options(el('quizLessonSelect'), [{ id: 'all', title: course ? 'Tất cả 6 bài' : 'Chọn khóa học trước' }, ...lessons]);
        el('quizLessonSelect').value = lessons.some(lesson => lesson.id === previousLesson) ? previousLesson : 'all';
        const lessonId = el('quizLessonSelect').value;
        const counts = course ? lessonId === 'all' ? [6, 12, 18] : [3, 6, 9, 12] : [];
        this.renderer.options(el('quizQuestionCount'), counts.map(count => ({ id: String(count), title: `${count} câu` })));
        if (counts.includes(previousCount)) el('quizQuestionCount').value = String(previousCount);
        el('quizLessonSelect').disabled = !course;
        el('quizQuestionCount').disabled = !course;
        el('btnInitQuiz').disabled = !course;
        el('quizSetupError').hidden = true;
        const lesson = course?.lessons.find(item => item.id === lessonId);
        this.renderer.setupSummary(course, lesson, Number(el('quizQuestionCount').value), DIFFICULTY_NAMES[el('quizDifficulty').value]);
        this.generationStatus('', 'idle');
        const history = course ? [...this.review.getPracticeHistory(courseId, lessonId), ...this.service.getHistory(courseId, lessonId)] : null;
        const seen = new Set();
        this.renderer.history(history?.filter(record => { if (seen.has(record.id)) return false; seen.add(record.id); return true; }));
        this.renderer.reviewDashboard(course ? this.review.plan(courseId) : null, course);
    }
    learningContext(courseId) {
        const { evidence, attempts } = this.review.evidence(courseId);
        return {
            weakLessonIds: [...new Set([...evidence.values()].filter(row => row.latestCorrect === false).map(row => row.lessonId))].sort(),
            excludeIds: [...new Set([...attempts].reverse().flatMap(attempt => [...attempt.answers].reverse().map(answer => answer.questionId)))].reverse()
        };
    }
    generationStatus(message, state) {
        el('quizGenerationStatus').textContent = message;
        el('quizGenerationStatus').dataset.state = state;
    }
    cancelGeneration(message = '') {
        this.generationToken++;
        this.generationAbort?.abort(); this.generationAbort = null; this.isGenerating = false;
        el('quizSetupForm').removeAttribute('aria-busy');
        el('quizCancelGeneration').hidden = true;
        el('btnInitQuiz').disabled = !el('quizCourseSelect').value || !el('quizQuestionCount').value;
        if (message) this.generationStatus(message, 'idle');
    }
    async preparePlan(chosen, weakLessonIds, token) {
        // Easy and hard already select one fixed task tier per lesson. A remote
        // plan cannot change that choice, so keep those quizzes local and leave
        // the shared AI service available for meaningful planning and chat.
        if (chosen.difficulty !== 'medium') return { templateIds: [], source: 'local' };
        const now = Date.now();
        for (const [key, cached] of this.planCache) if (cached.expiresAt <= now) this.planCache.delete(key);
        const key = JSON.stringify([chosen.courseId, chosen.lessonId, chosen.count, chosen.difficulty, weakLessonIds]);
        const cached = this.planCache.get(key);
        if (cached) return { templateIds: cached.templateIds, source: 'ai' };
        if (now < this.plannerCooldownUntil) return { templateIds: [], source: 'fallback' };

        const controller = new AbortController(); this.generationAbort = controller; this.isGenerating = true;
        el('btnInitQuiz').disabled = true; el('quizCancelGeneration').hidden = false;
        el('quizSetupForm').setAttribute('aria-busy', 'true');
        this.generationStatus('Đang chuẩn bị đề…', 'loading');
        const timeout = setTimeout(() => controller.abort(), PLAN_TIMEOUT);
        try {
            const response = await fetch(PRACTICE_PLAN_URL, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
                body: JSON.stringify({ courseId: chosen.courseId, lessonId: chosen.lessonId, count: chosen.count,
                    difficulty: chosen.difficulty, level: getDifficultyLevel(chosen.difficulty), weakLessonIds })
            });
            if (!response.ok) throw new Error('planner-unavailable');
            const data = await response.json();
            const allowed = new Set(listAutomaticTemplates(chosen).map(template => template.id));
            if (data?.source !== 'ai-plan' || !Array.isArray(data.templateIds) || !data.templateIds.length
                || data.templateIds.length > chosen.count || new Set(data.templateIds).size !== data.templateIds.length
                || data.templateIds.some(id => typeof id !== 'string' || !allowed.has(id))) throw new Error('invalid-plan');
            if (token !== this.generationToken) return null;
            if (this.planCache.size >= 32) this.planCache.delete(this.planCache.keys().next().value);
            this.planCache.set(key, { templateIds: [...data.templateIds], expiresAt: Date.now() + PLAN_CACHE_TTL });
            return { templateIds: data.templateIds, source: 'ai' };
        } catch {
            if (token !== this.generationToken) return null;
            this.plannerCooldownUntil = Date.now() + PLAN_FAILURE_COOLDOWN;
            return { templateIds: [], source: 'fallback' };
        } finally {
            clearTimeout(timeout);
            if (token === this.generationToken) {
                this.generationAbort = null; this.isGenerating = false;
                el('quizSetupForm').removeAttribute('aria-busy');
                el('quizCancelGeneration').hidden = true; el('btnInitQuiz').disabled = false;
            }
        }
    }
    async startQuiz(config = null) {
        if (this.isGenerating) return;
        const chosen = config ? { ...config } : {
            courseId: el('quizCourseSelect').value, lessonId: el('quizLessonSelect').value,
            count: Number(el('quizQuestionCount').value), difficulty: el('quizDifficulty').value
        };
        this.cancelGeneration(); this.renderer.showIntro();
        el('quizSetupError').hidden = true;
        const token = this.generationToken;
        const { weakLessonIds, excludeIds } = this.learningContext(chosen.courseId);
        const plan = await this.preparePlan(chosen, weakLessonIds, token);
        if (!plan || token !== this.generationToken) return;
        try {
            const options = { courseId: chosen.courseId, lessonId: chosen.lessonId, count: chosen.count,
                difficulty: chosen.difficulty, preferredTemplateIds: plan.templateIds,
                seed: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}` };
            const windows = [excludeIds, excludeIds.slice(-54), excludeIds.slice(-18), []];
            for (let index = 0; index < windows.length; index++) {
                try { this.questions = createAutomaticPractice({ ...options, excludeIds: windows[index] }); break; }
                catch (error) {
                    if (!(error instanceof RangeError) || !error.message.includes('đã được luyện gần đây') || index === windows.length - 1) throw error;
                }
            }
        } catch (error) {
            el('quizSetupError').textContent = error.message; el('quizSetupError').hidden = false;
            this.generationStatus('', 'idle'); return;
        }
        const recycled = this.questions.some(question => excludeIds.includes(question.id));
        if (recycled) el('reviewDataNotice').textContent = 'Một số câu đã được đưa trở lại để bạn ôn tập.';
        this.generationStatus('', 'ready');
        this.beginSession({ ...chosen, mode: 'generated', planSource: plan.source, recycled });
    }
    beginSession(config) {
        this.config = { ...config }; this.responses = Array(this.questions.length).fill(null); this.activeIndex = 0; this.completed = false;
        this.attemptId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
        if (config.mode !== 'review') this.reviewReasons.clear();
        el('quizActiveGame').dataset.difficulty = config.difficulty || 'review';
        el('quizActiveGame').dataset.planSource = config.planSource || 'local';
        this.renderer.showGame(this.scopeLabel()); this.renderQuestion();
    }
    startReview(courseId) {
        this.cancelGeneration();
        let plan;
        try { plan = this.review.plan(courseId); }
        catch (error) { el('quizSetupError').textContent = error.message; el('quizSetupError').hidden = false; return; }
        if (!plan.items.length) { this.returnToSetup(); el('reviewDataNotice').textContent = this.renderer.reviewStatus(plan); return; }
        this.questions = plan.items.map(item => item.question);
        this.reviewReasons = new Map(plan.items.map(item => [item.question.id, item.reason]));
        this.beginSession({ courseId, lessonId: 'all', count: this.questions.length, mode: 'review' });
    }
    exportReview() {
        try {
            const courseId = el('quizCourseSelect').value;
            const backup = this.review.exportCourse(courseId);
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a'); link.href = url; link.download = `strobot-on-tap-${courseId}.json`;
            document.body.append(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            el('reviewDataNotice').textContent = 'Đã tải dữ liệu ôn của khóa này.';
        } catch { el('reviewDataNotice').textContent = 'Chưa tải được dữ liệu. Hãy kiểm tra quyền tải tệp và lưu trữ của trình duyệt.'; }
    }
    scopeLabel() {
        const course = this.service.getCourses().find(c => c.id === this.config.courseId);
        const lesson = course.lessons.find(item => item.id === this.config.lessonId);
        const scope = this.config.mode === 'review' ? 'Ôn theo kết quả' : `${lesson ? lesson.title : 'Tất cả 6 bài'} · ${DIFFICULTY_NAMES[this.config.difficulty]}`;
        return `${course.name} · ${scope} · ${this.questions.length} câu`;
    }
    renderQuestion() {
        const question = this.questions[this.activeIndex];
        const lesson = this.service.getLessons(question.courseId).find(item => item.id === question.lessonId);
        this.renderer.question(question, lesson.title, this.activeIndex, this.questions.length, this.responses[this.activeIndex],
            this.responses.filter(response => response !== null).length, this.reviewReasons.get(question.id));
    }
    confirmAnswer() {
        if (this.completed || !this.questions.length || this.responses[this.activeIndex] !== null) return;
        const checked = el('answerOptionsArea').querySelector('input:checked');
        if (!checked) return;
        const choice = Number(checked.value);
        if (!Number.isInteger(choice) || choice < 0 || choice >= this.questions[this.activeIndex].opts.length) return;
        this.responses[this.activeIndex] = choice;
        this.renderQuestion(); el('feedbackBox').focus();
    }
    nextQuestion() {
        if (this.completed || this.responses[this.activeIndex] === null) return;
        if (this.activeIndex + 1 < this.questions.length) { this.activeIndex++; this.renderQuestion(); }
        else this.finishQuiz();
    }
    finishQuiz() {
        if (this.completed || !this.questions.length || this.responses.some(response => response === null)) return;
        this.completed = true;
        const report = this.service.grade(this.questions, this.responses);
        this.renderer.summary(report, this.scopeLabel(), this.questions, this.responses, this.config.courseId, this.config);
        const result = this.review.recordCompletedAttempt({ completed: true, id: this.attemptId, courseId: this.config.courseId, mode: this.config.mode,
            answers: this.questions.map((question, index) => ({ questionId: question.id, choice: this.responses[index] })) });
        el('btnRestartQuiz').textContent = this.config.mode === 'review' ? 'Ôn tiếp' : 'Làm đề khác';
        this.renderer.reviewOutcome(this.review.plan(this.config.courseId), result);
    }
    returnToSetup() {
        this.cancelGeneration(); this.questions = []; this.responses = []; this.activeIndex = 0;
        this.renderer.showIntro(); this.syncScope(); el('quizSetupTitle').focus();
    }
}
