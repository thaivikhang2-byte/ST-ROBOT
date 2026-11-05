import { QuizService } from './QuizService.js?v=generated-v6';
import { ReviewService } from './ReviewService.js?v=generated-v6';
import { QuizRenderer } from './QuizRenderer.js?v=generated-v6';
import { createGeneratedQuiz, getGenerationCapacity, listTemplates } from './generation/QuestionEngine.js?v=generated-v6';
const el = id => document.getElementById(id);
const PRACTICE_PLAN_URL = 'https://st-robot.onrender.com/api/practice-plan';
const LEVEL_NAMES = { all: 'Kết hợp các mức độ', basic: 'Cơ bản', apply: 'Vận dụng', reason: 'Suy luận' };

export class QuizController {
    constructor() {
        this.service = new QuizService();
        this.renderer = new QuizRenderer();
        this.review = new ReviewService();
        this.reviewReasons = new Map(); this.attemptId = null; this.deleteCourseId = null;
        this.questions = []; this.responses = []; this.activeIndex = 0; this.config = null; this.completed = false;
        this.generationToken = 0; this.generationAbort = null; this.isGenerating = false;
    }
    init() {
        const courses = this.service.getCourses();
        this.renderer.options(el('quizCourseSelect'), [{ id: '', title: '— Chọn khóa học —' }, ...courses.map(c => ({ id: c.id, title: c.name }))]);
        const params = new URLSearchParams(location.search);
        if (courses.some(c => c.id === params.get('course'))) el('quizCourseSelect').value = params.get('course');
        if (params.get('source') === 'generated') el('quizQuestionSource').value = 'generated';
        this.syncScope(true, params.get('lesson'));
        el('quizCourseSelect').addEventListener('change', () => this.syncScope(true));
        el('quizLessonSelect').addEventListener('change', () => this.syncScope());
        el('quizQuestionCount').addEventListener('change', () => this.syncScope());
        for (const id of ['quizQuestionSource', 'quizGeneratedLevel', 'quizPersonalized', 'quizAiPlan']) el(id).addEventListener('change', () => this.syncScope());
        el('btnGeneratedPractice').addEventListener('click', () => { el('quizQuestionSource').value = 'generated'; this.syncScope(); el('quizCourseSelect').focus(); });
        el('quizCancelGeneration').addEventListener('click', () => this.cancelGeneration('Đã hủy gợi ý AI. Bạn có thể đổi lựa chọn hoặc bắt đầu lượt khác.'));
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
            el('reviewDeleteDescription').textContent = `Xóa hồ sơ ôn theo lỗi và lịch sử kiểm tra của ${course.name} trên trình duyệt này? Hành động này không hoàn tác được trong website.`;
            el('reviewDeleteDialog').showModal();
        });
        el('btnCancelDeleteReview').addEventListener('click', () => el('reviewDeleteDialog').close());
        el('btnConfirmDeleteReview').addEventListener('click', () => {
            const reviewDeleted = this.review.clearCourse(this.deleteCourseId);
            const historyDeleted = this.service.deleteHistory(this.deleteCourseId);
            el('reviewDeleteDialog').close(); this.syncScope();
            el('reviewDataNotice').textContent = reviewDeleted && historyDeleted ? 'Đã xóa dữ liệu kiểm tra và ôn của khóa đã chọn. Các dữ liệu khác được giữ nguyên.' : 'Chưa xóa được toàn bộ dữ liệu vì trình duyệt chặn lưu trữ. Hãy kiểm tra lại trước khi dùng chung trình duyệt.';
            el('btnDeleteReview').focus();
        });
    }
    syncScope(resetLesson = false, requestedLesson = null) {
        this.cancelGeneration();
        const courseId = el('quizCourseSelect').value;
        const course = this.service.getCourses().find(c => c.id === courseId);
        const previousLesson = resetLesson ? requestedLesson || 'all' : el('quizLessonSelect').value;
        const previousCount = Number(el('quizQuestionCount').value);
        this.renderer.options(el('quizLessonSelect'), [{ id: 'all', title: course ? 'Tất cả 6 bài trong khóa' : 'Chọn khóa học trước' }, ...this.service.getLessons(courseId)]);
        el('quizLessonSelect').value = this.service.getLessons(courseId).some(l => l.id === previousLesson) ? previousLesson : 'all';
        const lessonId = el('quizLessonSelect').value;
        const generated = el('quizQuestionSource').value === 'generated';
        el('quizGeneratedSettings').hidden = !generated;
        const templates = course ? listTemplates({ courseId, lessonId }) : [];
        const levels = ['basic', 'apply', 'reason'].filter(level => {
            const filtered = templates.filter(template => template.level === level);
            return lessonId === 'all' ? !!course && course.lessons.every(lesson => filtered.some(template => template.lessonId === lesson.id)) : filtered.length > 0;
        });
        const previousLevel = el('quizGeneratedLevel').value;
        this.renderer.options(el('quizGeneratedLevel'), ['all', ...levels].map(level => ({ id: level, title: LEVEL_NAMES[level] })));
        el('quizGeneratedLevel').value = levels.includes(previousLevel) ? previousLevel : 'all';
        el('quizGeneratedLevel').disabled = !course;
        el('quizPersonalized').disabled = !course || lessonId !== 'all';
        el('quizAiPlan').disabled = !course;
        const level = el('quizGeneratedLevel').value;
        const weakLessonIds = generated && course && el('quizPersonalized').checked && lessonId === 'all' ? this.learningContext(courseId).weakLessonIds : [];
        let capacity = course ? getGenerationCapacity(courseId, lessonId, level) : 0;
        let counts = this.service.getAvailableCounts(courseId, lessonId);
        if (generated) {
            const scopedTemplates = templates.filter(template => level === 'all' || template.level === level);
            const includedLessons = course?.lessons.filter(lesson => lessonId === 'all' ? !weakLessonIds.length || weakLessonIds.includes(lesson.id) : lesson.id === lessonId) || [];
            const scopedCapacity = scopedTemplates.filter(template => includedLessons.some(lesson => lesson.id === template.lessonId)).reduce((sum, template) => sum + template.variantCount, 0);
            capacity = scopedCapacity;
            counts = (lessonId === 'all' ? [6, 12, 18] : [3, 6, 9, 12]).filter(count => count <= scopedCapacity
                && includedLessons.every(lesson => scopedTemplates.filter(template => template.lessonId === lesson.id).reduce((sum, template) => sum + template.variantCount, 0) >= Math.ceil(count / includedLessons.length)));
        }
        this.renderer.options(el('quizQuestionCount'), counts.map(count => ({ id: String(count), title: generated ? `${count} câu mới${lessonId === 'all' && !el('quizPersonalized').checked ? ` · ${count / course.lessons.length} câu mỗi bài` : ''}` : lessonId === 'all' ? `${count} câu · ${count / course.lessons.length} câu mỗi bài` : `${count} câu · trọn bài đã chọn` })));
        if (counts.includes(previousCount)) el('quizQuestionCount').value = String(previousCount);
        el('quizLessonSelect').disabled = !course;
        el('quizQuestionCount').disabled = !course || counts.length <= 1;
        el('btnInitQuiz').disabled = !course || !counts.length;
        el('quizSetupError').hidden = true;
        const lesson = course?.lessons.find(l => l.id === lessonId);
        this.renderer.setupSummary(course, lesson, Number(el('quizQuestionCount').value), generated ? capacity : this.service.getQuestions(courseId, lessonId).length,
            generated ? { level: LEVEL_NAMES[level], focusTitles: course?.lessons.filter(item => weakLessonIds.includes(item.id)).map(item => item.title) || [], requestedFocus: el('quizPersonalized').checked && lessonId === 'all', aiPlan: el('quizAiPlan').checked, templateCount: templates.filter(template => (level === 'all' || template.level === level) && (!weakLessonIds.length || weakLessonIds.includes(template.lessonId))).length } : null);
        this.generationStatus('', 'idle');
        this.renderer.history(course ? this.service.getHistory(courseId, lessonId) : null);
        this.renderer.reviewDashboard(course ? this.review.plan(courseId) : null, course);
    }
    async startQuiz(config = null) {
        if (this.isGenerating) return;
        const chosen = config ? { ...config } : { courseId: el('quizCourseSelect').value, lessonId: el('quizLessonSelect').value, count: Number(el('quizQuestionCount').value), mode: el('quizQuestionSource').value === 'generated' ? 'generated' : 'quiz', level: el('quizGeneratedLevel').value, personalized: el('quizPersonalized').checked, aiPlan: el('quizAiPlan').checked };
        if (chosen.mode === 'generated') { await this.startGeneratedQuiz(chosen); return; }
        try { this.questions = this.service.createQuiz(chosen); }
        catch (error) { el('quizSetupError').textContent = error.message; el('quizSetupError').hidden = false; return; }
        this.beginSession({ ...chosen, mode: 'quiz' });
    }
    learningContext(courseId) {
        const { evidence, attempts } = this.review.evidence(courseId);
        return { weakLessonIds: [...new Set([...evidence.values()].filter(row => row.latestCorrect === false).map(row => row.lessonId))],
            excludeIds: [...new Set([...attempts].reverse().flatMap(attempt => [...attempt.answers].reverse().map(answer => answer.questionId)))].reverse() };
    }
    generationStatus(message, state) {
        el('quizGenerationStatus').textContent = message;
        el('quizGenerationStatus').dataset.state = state;
    }
    cancelGeneration(message = '') {
        this.generationToken++;
        this.generationAbort?.abort(); this.generationAbort = null; this.isGenerating = false;
        el('quizCancelGeneration').hidden = true;
        el('btnInitQuiz').disabled = !el('quizCourseSelect').value || !el('quizQuestionCount').value;
        if (message) this.generationStatus(message, 'idle');
    }
    async startGeneratedQuiz(chosen) {
        this.cancelGeneration();
        this.renderer.showIntro();
        const token = this.generationToken;
        const { weakLessonIds, excludeIds } = this.learningContext(chosen.courseId);
        const focusLessonIds = chosen.personalized && chosen.lessonId === 'all' ? weakLessonIds : [];
        let preferredTemplateIds = [], planSource = 'local';
        this.generationStatus('Đang dùng bộ sinh câu đã kiểm tra đáp án theo quy tắc.', 'ready');
        if (chosen.aiPlan) {
            const controller = new AbortController(); this.generationAbort = controller; this.isGenerating = true;
            el('btnInitQuiz').disabled = true; el('quizCancelGeneration').hidden = false;
            this.generationStatus('AI đang gợi ý dạng bài theo phạm vi đã chọn…', 'loading');
            const timeout = setTimeout(() => controller.abort(), 20000);
            try {
                const response = await fetch(PRACTICE_PLAN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
                    body: JSON.stringify({ courseId: chosen.courseId, lessonId: chosen.lessonId, count: chosen.count, level: chosen.level || 'all', weakLessonIds: focusLessonIds }) });
                if (!response.ok) throw new Error('planner-unavailable');
                const data = await response.json();
                const allowed = new Set(listTemplates({ courseId: chosen.courseId, lessonId: chosen.lessonId, level: chosen.level || 'all' })
                    .filter(template => !focusLessonIds.length || focusLessonIds.includes(template.lessonId)).map(template => template.id));
                if (data?.source !== 'ai-plan' || !Array.isArray(data.templateIds) || !data.templateIds.length || data.templateIds.length > chosen.count || new Set(data.templateIds).size !== data.templateIds.length || data.templateIds.some(id => typeof id !== 'string' || !allowed.has(id))) throw new Error('invalid-plan');
                preferredTemplateIds = data.templateIds; planSource = 'ai';
            } catch {
                planSource = 'fallback';
            } finally { clearTimeout(timeout); }
            if (token !== this.generationToken) return;
            this.generationAbort = null; this.isGenerating = false; el('quizCancelGeneration').hidden = true;
            el('btnInitQuiz').disabled = false;
        }
        if (token !== this.generationToken) return;
        try {
            const options = { courseId: chosen.courseId, lessonId: chosen.lessonId, count: chosen.count, level: chosen.level || 'all',
                seed: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, focusLessonIds, preferredTemplateIds };
            const exclusionWindows = [excludeIds, excludeIds.slice(-54), excludeIds.slice(-18), []];
            for (let index = 0; index < exclusionWindows.length; index++) {
                try { this.questions = createGeneratedQuiz({ ...options, excludeIds: exclusionWindows[index] }); break; }
                catch (error) {
                    if (!(error instanceof RangeError) || !error.message.includes('đã được luyện gần đây') || index === exclusionWindows.length - 1) throw error;
                }
            }
        } catch (error) {
            el('quizSetupError').textContent = error.message; el('quizSetupError').hidden = false;
            this.generationStatus('Hãy đổi phạm vi hoặc số câu rồi bắt đầu lại.', 'error'); return;
        }
        const recycled = this.questions.some(question => excludeIds.includes(question.id));
        this.generationStatus(planSource === 'ai' ? 'AI đã gợi ý dạng bài. Câu hỏi và đáp án được dựng bằng bộ sinh theo quy tắc.' : planSource === 'fallback' ? 'Đang dùng bộ sinh câu đã kiểm tra đáp án theo quy tắc. Bạn có thể tiếp tục luyện ngay.' : 'Đang dùng bộ sinh câu đã kiểm tra đáp án theo quy tắc.', planSource === 'ai' ? 'ai' : planSource === 'fallback' ? 'fallback' : 'ready');
        this.reviewReasons = new Map(this.questions.map(question => [question.id, focusLessonIds.includes(question.lessonId)
            ? 'Ưu tiên bài có câu trả lời gần nhất cần ôn lại. Câu mới giúp bạn vận dụng lại kỹ năng đó.'
            : 'Luyện thêm kỹ năng trong phạm vi đã chọn với số liệu hoặc tình huống thay đổi.']));
        if (recycled) this.generationStatus(`${el('quizGenerationStatus').textContent} Đã xoay vòng các câu đã luyện; mỗi lượt vẫn gồm các câu khác nhau.`, el('quizGenerationStatus').dataset.state);
        this.beginSession({ ...chosen, mode: 'generated', planSource, focusLessonIds, recycled });
    }
    beginSession(config) {
        this.config = { ...config }; this.responses = Array(this.questions.length).fill(null); this.activeIndex = 0; this.completed = false;
        this.attemptId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
        if (!['review', 'generated'].includes(config.mode)) this.reviewReasons.clear();
        this.renderer.showGame(this.scopeLabel()); this.renderQuestion();
    }
    startReview(courseId) {
        this.cancelGeneration();
        let plan;
        try { plan = this.review.plan(courseId); }
        catch (error) { el('quizSetupError').textContent = error.message; el('quizSetupError').hidden = false; return; }
        if (!plan.items.length) {
            this.returnToSetup();
            el('reviewDataNotice').textContent = this.renderer.reviewStatus(plan);
            return;
        }
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
            el('reviewDataNotice').textContent = 'Đã tạo bản JSON gồm các lượt ôn đã lưu của khóa này. Hãy giữ tệp để đối chiếu kết quả khi cần.';
        } catch {
            el('reviewDataNotice').textContent = 'Chưa tải được dữ liệu. Hãy kiểm tra quyền tải tệp và lưu trữ của trình duyệt.';
        }
    }
    scopeLabel() {
        const course = this.service.getCourses().find(c => c.id === this.config.courseId);
        const lesson = course.lessons.find(l => l.id === this.config.lessonId);
        return `${course.name} · ${this.config.mode === 'review' ? 'Ôn theo lỗi của tôi' : `${this.config.mode === 'generated' ? 'Luyện câu mới · ' : ''}${lesson ? lesson.title : 'Tất cả 6 bài'}`} · ${this.questions.length} câu`;
    }
    renderQuestion() {
        const question = this.questions[this.activeIndex];
        const lesson = this.service.getLessons(question.courseId).find(l => l.id === question.lessonId);
        this.renderer.question(question, lesson.title, this.activeIndex, this.questions.length, this.responses[this.activeIndex], this.responses.filter(r => r !== null).length, this.reviewReasons.get(question.id), this.config);
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
        if (this.completed || !this.questions.length || this.responses.some(r => r === null)) return;
        this.completed = true;
        const report = this.service.grade(this.questions, this.responses);
        const snapshot = { id: this.attemptId, courseId: this.config.courseId, lessonId: this.config.lessonId, correct: report.correct, total: report.total, percentage: report.percentage, createdAt: new Date().toISOString() };
        const saved = this.config.mode === 'quiz' ? this.service.saveResult(snapshot) : null;
        this.renderer.summary(report, this.scopeLabel(), this.questions, this.responses, this.config.courseId, saved, this.config);
        const evidenceSaved = this.review.recordCompletedAttempt({ completed: true, id: this.attemptId, courseId: this.config.courseId, mode: this.config.mode,
            answers: this.questions.map((question, index) => ({ questionId: question.id, choice: this.responses[index] })) });
        if (this.config.mode === 'review') el('quizStorageNotice').textContent = 'Xem lại đáp án và gợi ý cho lượt ôn tiếp theo bên dưới.';
        if (this.config.mode === 'generated') el('quizStorageNotice').textContent = 'Hồ sơ ôn theo lỗi theo dõi các lượt câu mới đã lưu. Xem trạng thái lưu và gợi ý bên dưới.';
        el('btnRestartQuiz').textContent = this.config.mode === 'review' ? 'Lập lượt ôn mới' : this.config.mode === 'generated' ? 'Luyện lượt câu mới tiếp theo' : 'Làm lại cùng phạm vi';
        this.renderer.reviewOutcome(this.review.plan(this.config.courseId), evidenceSaved);
    }
    returnToSetup() {
        this.cancelGeneration();
        this.questions = []; this.responses = []; this.activeIndex = 0;
        this.renderer.showIntro(); this.syncScope(); el('quizSetupTitle').focus();
    }
}
