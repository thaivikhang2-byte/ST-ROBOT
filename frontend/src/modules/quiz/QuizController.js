import { QuizService } from './QuizService.js?v=quiz-20261101-v2';
import { QuizRenderer } from './QuizRenderer.js?v=quiz-20261101-v2';
const el = id => document.getElementById(id);

export class QuizController {
    constructor() {
        this.service = new QuizService();
        this.renderer = new QuizRenderer();
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
        el('btnRestartQuiz').addEventListener('click', () => this.startQuiz(this.config));
        el('btnBackIntro').addEventListener('click', () => this.returnToSetup());
        el('quizExitBtn').addEventListener('click', () => el('quizExitDialog').showModal());
        el('quizContinueBtn').addEventListener('click', () => el('quizExitDialog').close());
        el('quizDiscardBtn').addEventListener('click', () => { el('quizExitDialog').close(); this.returnToSetup(); });
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
    }
    startQuiz(config = null) {
        const chosen = config || { courseId: el('quizCourseSelect').value, lessonId: el('quizLessonSelect').value, count: Number(el('quizQuestionCount').value) };
        try { this.questions = this.service.createQuiz(chosen); }
        catch (error) { el('quizSetupError').textContent = error.message; el('quizSetupError').hidden = false; return; }
        this.config = { ...chosen }; this.responses = Array(this.questions.length).fill(null); this.activeIndex = 0; this.completed = false;
        this.renderer.showGame(this.scopeLabel()); this.renderQuestion();
    }
    scopeLabel() {
        const course = this.service.getCourses().find(c => c.id === this.config.courseId);
        const lesson = course.lessons.find(l => l.id === this.config.lessonId);
        return `${course.name} · ${lesson ? lesson.title : 'Tất cả 6 bài'} · ${this.questions.length} câu`;
    }
    renderQuestion() {
        const question = this.questions[this.activeIndex];
        const lesson = this.service.getLessons(question.courseId).find(l => l.id === question.lessonId);
        this.renderer.question(question, lesson.title, this.activeIndex, this.questions.length, this.responses[this.activeIndex], this.responses.filter(r => r !== null).length);
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
        if (this.completed || this.responses.some(r => r === null)) return;
        this.completed = true;
        const report = this.service.grade(this.questions, this.responses);
        const snapshot = { id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, courseId: this.config.courseId, lessonId: this.config.lessonId, correct: report.correct, total: report.total, percentage: report.percentage, createdAt: new Date().toISOString() };
        const saved = this.service.saveResult(snapshot);
        this.renderer.summary(report, this.scopeLabel(), this.questions, this.responses, this.config.courseId, saved);
    }
    returnToSetup() {
        this.questions = []; this.responses = []; this.activeIndex = 0;
        this.renderer.showIntro(); this.syncScope(); el('quizSetupTitle').focus();
    }
}
