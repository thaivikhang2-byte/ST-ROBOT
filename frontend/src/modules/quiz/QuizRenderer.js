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
    setupSummary(course, lesson, count, available) {
        const host = el('quizScopeSummary');
        host.replaceChildren();
        if (!course) { host.textContent = 'Chưa chọn khóa học. Câu hỏi sẽ chỉ lấy từ nội dung bạn chọn.'; return; }
        host.append(node('strong', `${course.name} · ${lesson ? lesson.title : 'Tất cả 6 bài'}`));
        host.append(node('p', lesson ? `${count} câu hỏi bám sát bài này.` : `${count} câu, chia đều cho 6 bài trong khóa. Ngân hàng có ${available} câu để thay đổi đề giữa các lượt.`));
    }
    history(records) {
        const host = el('quizHistory');
        host.replaceChildren();
        if (!records) { host.append(node('p', 'Chọn khóa học để xem kết quả của bạn.')); return; }
        if (!records.length) { host.append(node('p', 'Chưa có kết quả trong phạm vi này.')); return; }
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
    question(question, lessonTitle, index, total, response, answeredCount) {
        const answered = response !== null;
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
    summary(report, scope, questions, responses, courseId, saved) {
        this.view('results');
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
        topics.replaceChildren(node('h3', 'Kết quả theo bài học'), list, node('p', toReview.length ? `Nên ôn lại: ${toReview.join('; ')}.` : 'Bạn đã trả lời đúng toàn bộ câu hỏi trong lượt này. Có thể làm một lượt khác để ôn thêm câu trong cùng phạm vi.'));
        el('quizStorageNotice').textContent = saved ? 'Đã lưu kết quả trên trình duyệt này.' : 'Chưa lưu được kết quả. Bạn vẫn có thể xem toàn bộ đáp án của lượt này bên dưới.';
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
