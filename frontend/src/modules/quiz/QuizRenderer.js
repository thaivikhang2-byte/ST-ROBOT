import { ROUTES } from '../../constants/routes.js';
const el = id => document.getElementById(id);
const node = (tag, text, className) => {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (className) item.className = className;
    return item;
};
const lessonHref = (course, lesson) => `${ROUTES.COURSE_LEARNING}?course=${encodeURIComponent(course)}&lesson=${encodeURIComponent(lesson)}`;

export class QuizRenderer {
    options(select, items) {
        select.replaceChildren(...items.map(item => {
            const option = node('option', item.title);
            option.value = String(item.id);
            return option;
        }));
    }
    view(name) {
        el('quizIntroArea').hidden = name !== 'setup';
        el('quizActiveGame').hidden = name !== 'questions';
        el('quizSummaryArea').hidden = name !== 'results';
        document.querySelectorAll('[data-quiz-step]').forEach(step => {
            if (step.dataset.quizStep === name) step.setAttribute('aria-current', 'step');
            else step.removeAttribute('aria-current');
        });
    }
    showIntro() { this.view('setup'); }
    showGame(scope) { this.view('questions'); el('quizSessionScope').textContent = scope; }
    setupSummary(course, lesson, count, difficulty) {
        const host = el('quizScopeSummary');
        host.textContent = course
            ? `${count} câu · ${difficulty}${lesson ? '' : ` · ${count / course.lessons.length} câu mỗi bài`}`
            : 'Chọn khóa học để bắt đầu.';
    }
    history(records) {
        const host = el('quizHistory');
        host.replaceChildren();
        if (!records) { host.append(node('p', 'Chọn khóa học để xem kết quả của bạn.')); return; }
        if (!records.length) { host.append(node('p', 'Hoàn thành một lượt để lưu kết quả tại đây.')); return; }
        const list = node('ul', undefined, 'quiz-history-list');
        const format = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
        records.slice(0, 3).forEach(record => {
            const item = node('li');
            const time = node('time', format.format(new Date(record.createdAt)));
            time.dateTime = record.createdAt;
            item.append(node('strong', `${record.correct}/${record.total} đúng · ${record.percentage}%`), time);
            list.append(item);
        });
        host.append(list);
    }
    reviewStatus(plan) {
        if (plan.status === 'blocked') return 'Trình duyệt đang chặn lưu hoặc đọc dữ liệu. Hãy bật quyền lưu trữ để dùng hồ sơ ôn theo lỗi. Bạn vẫn có thể làm bài.';
        if (!plan.hasEvidence) return 'Hoàn thành một lượt để nhận gợi ý ôn.';
        if (plan.items.length) return `Lượt ôn tiếp theo: ${plan.items.length} câu.`;
        if (plan.nextDueAt) {
            const date = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(plan.nextDueAt));
            return `Lịch ôn tiếp theo: ${date}.`;
        }
        return 'Chọn bài để tiếp tục luyện tập.';
    }
    reviewDashboard(plan, course) {
        const host = el('reviewEvidence');
        host.replaceChildren();
        el('btnAdaptiveReview').disabled = !plan?.items.length;
        el('btnExportReview').disabled = !plan?.hasEvidence;
        el('btnDeleteReview').disabled = !course;
        if (!plan || !course) { el('reviewPlanStatus').textContent = 'Chọn khóa học để xem gợi ý.'; return; }
        el('reviewPlanStatus').textContent = this.reviewStatus(plan);
        if (plan.status === 'corrupt') el('reviewPlanStatus').append(node('p', 'Một phần dữ liệu lưu không hợp lệ đã được bỏ qua. Gợi ý ôn sử dụng các lượt lưu hợp lệ.'));
        const list = node('ul', undefined, 'review-evidence-list');
        for (const row of plan.lessons) {
            const item = node('li'); item.dataset.lessonId = row.id;
            const link = node('a', row.title); link.href = lessonHref(course.id, row.id);
            item.append(link, node('p', `${row.distinct} câu khác nhau · ${row.correct}/${row.attempts} lần trả lời đúng trong các lượt đã lưu.`),
                node('p', `Kết quả gần nhất của từng câu đã luyện: ${row.latestCorrect} đúng, ${row.latestWrong} cần ôn lại.`),
                node('p', row.insufficient ? 'Hãy luyện đủ 3 câu khác nhau để theo dõi kết quả của bài.' : 'Đã có dữ liệu từ ít nhất 3 câu khác nhau. Tiếp tục luyện và theo dõi lịch ôn để củng cố kiến thức.', 'quiz-small'));
            list.append(item);
        }
        host.append(list);
    }
    reviewOutcome(plan, result) {
        el('reviewNextStatus').textContent = this.reviewStatus(plan);
        el('btnReviewNext').disabled = !plan.items.length;
        el('reviewSaveNotice').textContent = result.saved
            ? (result.replacedCorruptData ? 'Đã lưu lượt này; dữ liệu lỗi trước đó đã được bỏ qua.' : 'Đã lưu kết quả.')
            : 'Chưa lưu được hồ sơ ôn. Gợi ý dưới đây chỉ dựa trên dữ liệu đã lưu trước đó; bạn vẫn xem được đáp án lượt này.';
    }
    question(question, lessonTitle, index, total, response, answeredCount, reason = null) {
        const answered = response !== null;
        el('quizQuestionReason').hidden = !reason;
        el('quizQuestionReason').textContent = reason ? `Vì sao ôn câu này: ${reason}` : '';
        el('quizActiveGame').dataset.questionId = question.id;
        el('quizProgressText').textContent = `Câu ${index + 1} / ${total}`;
        el('quizAnsweredText').textContent = `Đã xác nhận ${answeredCount}/${total} câu`;
        el('quizProgress').max = total; el('quizProgress').value = answeredCount;
        el('quizQuestionLesson').textContent = `Bài: ${lessonTitle}`;
        el('targetQuestionPlaceholder').textContent = question.q;
        el('answerOptionsArea').replaceChildren(...question.opts.map((answer, optionIndex) => {
            const label = node('label', undefined, 'answer-btn');
            const input = document.createElement('input');
            input.type = 'radio'; input.name = 'answer'; input.value = String(optionIndex); input.required = true;
            input.checked = response === optionIndex; input.disabled = answered;
            const copy = node('span', answer, 'answer-copy');
            label.append(input, node('span', String.fromCharCode(65 + optionIndex) + '.', 'answer-letter'), copy);
            if (answered) {
                label.classList.add('is-locked');
                if (optionIndex === question.ans) { label.classList.add('answer-correct'); copy.append(node('span', response === optionIndex ? '✓ Bạn chọn đúng' : '✓ Đáp án đúng', 'answer-state')); }
                else if (optionIndex === response) { label.classList.add('answer-wrong'); copy.append(node('span', '✕ Đáp án bạn chọn', 'answer-state')); }
            }
            return label;
        }));
        el('confirmAnswerBtn').hidden = answered; el('confirmAnswerBtn').disabled = true;
        el('forwardBtn').disabled = !answered;
        el('forwardBtn').textContent = index + 1 === total ? 'Xem kết quả →' : 'Câu tiếp theo →';
        el('backQuestionBtn').disabled = index === 0;
        const feedback = el('feedbackBox');
        feedback.hidden = !answered; feedback.replaceChildren();
        if (answered) feedback.append(node('strong', response === question.ans ? 'Đúng.' : 'Chưa đúng.'), node('p', `Đáp án đúng: ${question.opts[question.ans]}`), node('p', question.exp));
        el('targetQuestionPlaceholder').focus();
    }
    summary(report, scope, questions, responses, courseId, config = null) {
        this.view('results');
        el('quizSummaryArea').dataset.difficulty = config?.difficulty || 'review';
        el('quizSummaryArea').dataset.planSource = config?.planSource || 'local';
        el('quizResultScope').textContent = scope;
        el('quizScorePercent').textContent = `${report.percentage}%`;
        el('totalScoreText').textContent = `Bạn trả lời đúng ${report.correct} / ${report.total} câu.`;
        const topics = el('quizResultTopics');
        const list = node('ul');
        for (const row of report.byLesson) {
            const item = node('li');
            const link = node('a', row.title); link.href = lessonHref(courseId, row.lessonId);
            item.append(link, node('strong', `${row.correct}/${row.total} đúng`)); list.append(item);
        }
        const toReview = report.byLesson.filter(row => row.correct < row.total).map(row => row.title);
        topics.replaceChildren(node('h3', 'Kết quả theo bài học'), list, node('p', toReview.length ? `Nên ôn lại: ${toReview.join('; ')}.` : 'Bạn đã trả lời đúng toàn bộ câu trong lượt này.'));
        el('quizStorageNotice').textContent = '';
        el('quizStorageNotice').hidden = true;
        let openedWrong = false;
        el('quizReviewList').replaceChildren(...questions.map((question, index) => {
            const right = responses[index] === question.ans;
            const row = report.byLesson.find(r => r.lessonId === question.lessonId);
            const detail = node('details', undefined, 'answer-review');
            detail.dataset.questionId = question.id; detail.dataset.correct = String(right);
            if (!right && !openedWrong) { detail.open = true; openedWrong = true; }
            const summary = node('summary');
            summary.append(node('span', `Câu ${index + 1} · ${row.title}`), node('span', right ? '✓ Đúng' : '✕ Chưa đúng', 'review-status'));
            const body = node('div', undefined, 'review-body');
            const link = node('a', 'Ôn lại bài này →', 'btn btn--sm'); link.href = lessonHref(courseId, question.lessonId);
            body.append(node('h4', question.q), node('p', `Bạn chọn: ${question.opts[responses[index]]}`), node('p', `Đáp án đúng: ${question.opts[question.ans]}`), node('p', question.exp, 'review-explanation'), link);
            detail.append(summary, body); return detail;
        }));
        el('quizResultTitle').focus();
    }
}
