import { QuizService } from './QuizService.js?v=copy-v4';
import { ReviewService } from './ReviewService.js?v=copy-v4';
import { QuizRenderer } from './QuizRenderer.js?v=copy-v4';
const el = id => document.getElementById(id);

export class QuizController {
    constructor() {
        this.service = new QuizService();
        this.renderer = new QuizRenderer();
        this.review = new ReviewService();
        this.reviewReasons = new Map(); this.attemptId = null; this.deleteCourseId = null;
        this.questions = []; this.responses = []; this.activeIndex = 0; this.config = null; this.completed = false;
    }
    init() {
        const courses = this.service.getCourses();
        this.renderer.options(el('quizCourseSelect'), [{ id: '', title: '— Chọn khóa học —' }, ...courses.map(c => ({ id: c.id, title: c.name }))]);
        const params = new URLSearchParams(location.search);
        if (courses.some(c => c.id === params.get('course'))) el('quizCourseSelect').value = params.get('course');
        this.syncScope(true, params.get('lesson'));
        el('quizCourseSelect').addEventListener('change', () => this.syncScope(true));
        el('quizLessonSelect').addEventListener('change', () => this.syncScope());
        el('quizQuestionCount').addEventListener('change', () => this.syncScope());
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
        const courseId = el('quizCourseSelect').value;
        const course = this.service.getCourses().find(c => c.id === courseId);
        const previousLesson = resetLesson ? requestedLesson || 'all' : el('quizLessonSelect').value;
        const previousCount = Number(el('quizQuestionCount').value);
        this.renderer.options(el('quizLessonSelect'), [{ id: 'all', title: course ? 'Tất cả 6 bài trong khóa' : 'Chọn khóa học trước' }, ...this.service.getLessons(courseId)]);
        el('quizLessonSelect').value = this.service.getLessons(courseId).some(l => l.id === previousLesson) ? previousLesson : 'all';
        const lessonId = el('quizLessonSelect').value;
        const counts = this.service.getAvailableCounts(courseId, lessonId);
        this.renderer.options(el('quizQuestionCount'), counts.map(count => ({ id: String(count), title: lessonId === 'all' ? `${count} câu · ${count / course.lessons.length} câu mỗi bài` : `${count} câu · trọn bài đã chọn` })));
        if (counts.includes(previousCount)) el('quizQuestionCount').value = String(previousCount);
        el('quizLessonSelect').disabled = !course;
        el('quizQuestionCount').disabled = !course || counts.length <= 1;
        el('btnInitQuiz').disabled = !course || !counts.length;
        el('quizSetupError').hidden = true;
        const lesson = course?.lessons.find(l => l.id === lessonId);
        this.renderer.setupSummary(course, lesson, Number(el('quizQuestionCount').value), this.service.getQuestions(courseId, lessonId).length);
        this.renderer.history(course ? this.service.getHistory(courseId, lessonId) : null);
        this.renderer.reviewDashboard(course ? this.review.plan(courseId) : null, course);
    }
    startQuiz(config = null) {
        const chosen = config || { courseId: el('quizCourseSelect').value, lessonId: el('quizLessonSelect').value, count: Number(el('quizQuestionCount').value) };
        try { this.questions = this.service.createQuiz(chosen); }
        catch (error) { el('quizSetupError').textContent = error.message; el('quizSetupError').hidden = false; return; }
        this.beginSession({ ...chosen, mode: 'quiz' });
    }
    beginSession(config) {
        this.config = { ...config }; this.responses = Array(this.questions.length).fill(null); this.activeIndex = 0; this.completed = false;
        this.attemptId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
        if (config.mode !== 'review') this.reviewReasons.clear();
        this.renderer.showGame(this.scopeLabel()); this.renderQuestion();
    }
    startReview(courseId) {
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
        return `${course.name} · ${this.config.mode === 'review' ? 'Ôn theo lỗi của tôi' : lesson ? lesson.title : 'Tất cả 6 bài'} · ${this.questions.length} câu`;
    }
    renderQuestion() {
        const question = this.questions[this.activeIndex];
        const lesson = this.service.getLessons(question.courseId).find(l => l.id === question.lessonId);
        this.renderer.question(question, lesson.title, this.activeIndex, this.questions.length, this.responses[this.activeIndex], this.responses.filter(r => r !== null).length, this.reviewReasons.get(question.id));
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
        const saved = this.config.mode === 'review' ? null : this.service.saveResult(snapshot);
        this.renderer.summary(report, this.scopeLabel(), this.questions, this.responses, this.config.courseId, saved);
        const evidenceSaved = this.review.recordCompletedAttempt({ completed: true, id: this.attemptId, courseId: this.config.courseId, mode: this.config.mode,
            answers: this.questions.map((question, index) => ({ questionId: question.id, choice: this.responses[index] })) });
        if (this.config.mode === 'review') el('quizStorageNotice').textContent = 'Xem lại đáp án và gợi ý cho lượt ôn tiếp theo bên dưới.';
        el('btnRestartQuiz').textContent = this.config.mode === 'review' ? 'Lập lượt ôn mới' : 'Làm lại cùng phạm vi';
        this.renderer.reviewOutcome(this.review.plan(this.config.courseId), evidenceSaved);
    }
    returnToSetup() {
        this.questions = []; this.responses = []; this.activeIndex = 0;
        this.renderer.showIntro(); this.syncScope(); el('quizSetupTitle').focus();
    }
}
