import { AssessmentService } from './AssessmentService.js?v=copy-v4';
import { ASSESSMENT_LESSONS } from '../../data/assessment.js?v=copy-v4';
import { ROUTES } from '../../constants/routes.js';

const el = id => document.getElementById(id);
const node = (tag, text, className) => {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (className) item.className = className;
    return item;
};
const groupLabel = group => group === 'fixed' ? 'Học theo thứ tự cố định' : 'Ôn tập theo lỗi';
const stageLabel = stage => stage === 'pre' ? 'Trước học' : 'Sau học';
const percent = value => value === null ? '—' : `${value.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;
const points = value => value === null ? '—' : `${value > 0 ? '+' : ''}${value.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} điểm %`;

export class AssessmentController {
    constructor() { this.service = new AssessmentService(); this.currentCode = ''; this.activeStage = null; this.deleteTarget = null; }
    init() {
        el('assessmentCreateForm').addEventListener('submit', event => {
            event.preventDefault(); this.run(() => {
                const participant = this.service.createParticipant({ code: el('assessmentCode').value, group: el('assessmentGroup').value, order: el('assessmentOrder').value });
                this.open(participant.code); this.notice('Đã tạo mã. Chọn “Làm bài trước học” để bắt đầu.');
            });
        });
        el('assessmentOpenForm').addEventListener('submit', event => { event.preventDefault(); this.run(() => this.open(el('assessmentSavedCode').value)); });
        el('assessmentNewParticipant').addEventListener('click', () => {
            this.currentCode = ''; this.activeStage = null; this.updateUrl();
            el('assessmentCreateForm').reset(); this.render(); el('assessmentCode').focus();
            this.notice('Nhập mã của người tiếp theo. Kết quả đã lưu vẫn được giữ nguyên.');
        });
        el('assessmentSavedCode').addEventListener('change', () => { el('assessmentOpenBtn').disabled = !el('assessmentSavedCode').value; });
        el('assessmentAnswerForm').addEventListener('change', event => {
            if (!event.target.matches('input[data-question-index]')) return;
            const index = Number(event.target.dataset.questionIndex), choice = Number(event.target.value);
            try {
                this.service.answer(this.currentCode, this.activeStage, index, choice);
                this.progress(); this.notice('Đã lưu câu trả lời trên trình duyệt này.');
            } catch (error) { this.render(); this.notice(error.message, true); }
        });
        el('assessmentAnswerForm').addEventListener('submit', event => {
            event.preventDefault(); this.run(() => {
                const stage = this.activeStage;
                this.service.submitStage(this.currentCode, stage); this.activeStage = null; this.render();
                this.notice(stage === 'pre' ? 'Đã lưu bài trước học. Tiếp tục học theo phân công, rồi quay lại làm lượt sau học.' : 'Đã lưu đủ hai lượt. Xem kết quả bên dưới hoặc tải dữ liệu.');
                el('assessmentParticipantTitle').focus();
            });
        });
        el('assessmentExportCsv').addEventListener('click', () => this.run(() => this.download(this.service.exportCsv(), 'text/csv;charset=utf-8', 'strobot-danh-gia.csv')));
        el('assessmentExportJson').addEventListener('click', () => this.run(() => this.download(this.service.exportJson(), 'application/json', 'strobot-danh-gia-backup.json')));
        el('assessmentDeleteParticipant').addEventListener('click', () => this.confirmDelete(this.currentCode));
        el('assessmentDeleteAll').addEventListener('click', () => this.confirmDelete('*'));
        el('assessmentCancelDelete').addEventListener('click', () => el('assessmentDeleteDialog').close());
        el('assessmentConfirmDelete').addEventListener('click', () => this.run(() => {
            if (this.deleteTarget === '*') this.service.clearAll();
            else this.service.deleteParticipant(this.deleteTarget);
            if (this.deleteTarget === '*' || this.deleteTarget === this.currentCode) { this.currentCode = ''; this.activeStage = null; this.updateUrl(); }
            el('assessmentDeleteDialog').close(); this.render(); this.notice('Đã xóa dữ liệu đánh giá được chọn trên trình duyệt này.');
        }));
        window.addEventListener('storage', event => { if (event.key === null || event.key === 'strobot.assessment.v1') { this.render(); this.notice('Dữ liệu vừa thay đổi ở một thẻ khác. Trang đã tải lại trạng thái được lưu.'); } });
        const requested = new URLSearchParams(location.search).get('participant');
        if (requested && this.service.getParticipant(requested)) this.currentCode = this.service.normalizeCode(requested);
        this.render();
    }
    run(fn) { try { fn(); } catch (error) { this.notice(error.message || 'Hãy tải lại trang rồi thử thao tác này lần nữa.', true); } }
    notice(message, error = false) { el('assessmentNotice').textContent = message; el('assessmentNotice').dataset.error = String(error); }
    updateUrl() {
        const url = new URL(location.href);
        if (this.currentCode) url.searchParams.set('participant', this.currentCode);
        else url.searchParams.delete('participant');
        history.replaceState(null, '', url);
    }
    open(code) {
        const participant = this.service.getParticipant(code);
        if (!participant) throw new Error('Kiểm tra lại mã đã chọn hoặc tạo mã mới trên thiết bị này.');
        this.currentCode = participant.code; this.activeStage = null; this.updateUrl(); this.render(); el('assessmentParticipantTitle').focus();
    }
    start(stage) {
        this.run(() => {
            this.service.startStage(this.currentCode, stage); this.activeStage = stage; this.render();
            el('assessmentGameTitle').focus(); this.notice('Câu trả lời được lưu ngay khi chọn. Kiểm tra đủ 12 câu rồi nộp bài.');
        });
    }
    render() {
        const participants = this.service.listParticipants();
        const problem = this.service.problem;
        const selected = el('assessmentSavedCode').value;
        el('assessmentSavedCode').replaceChildren(node('option', participants.length ? '— Chọn mã đã lưu —' : 'Tạo mã ở trên để bắt đầu'));
        el('assessmentSavedCode').firstElementChild.value = '';
        for (const participant of participants) { const option = node('option', participant.code); option.value = participant.code; el('assessmentSavedCode').append(option); }
        el('assessmentSavedCode').value = participants.some(p => p.code === this.currentCode) ? this.currentCode : selected;
        el('assessmentOpenBtn').disabled = !el('assessmentSavedCode').value;
        const participant = participants.find(p => p.code === this.currentCode);
        el('assessmentSetup').hidden = Boolean(participant);
        el('assessmentParticipant').hidden = !participant;
        el('assessmentGame').hidden = true;
        if (participant) this.renderParticipant(participant);
        this.renderReport();
        if (problem) this.notice(problem, true);
    }
    renderParticipant(participant) {
        el('assessmentParticipantTitle').textContent = `Mã ${participant.code} · Arduino Uno`;
        el('assessmentParticipantMeta').textContent = `${groupLabel(participant.group)} · Đề ${participant.order[0]} trước, đề ${participant.order[1]} sau. Phân công được giữ nguyên cho cả hai lượt.`;
        el('assessmentStages').replaceChildren(...['pre', 'post'].map(stage => {
            const record = participant.stages[stage];
            return node('li', `${stageLabel(stage)} · đề ${participant.order[stage === 'pre' ? 0 : 1]}: ${record?.completedAt ? 'Đã nộp' : record ? 'Đang làm — có thể tiếp tục' : 'Chờ làm bài'}`);
        }));
        const next = el('assessmentNextStep'); next.replaceChildren();
        el('assessmentIndividualResult').replaceChildren();
        const ongoing = ['pre', 'post'].find(stage => participant.stages[stage] && !participant.stages[stage].completedAt);
        if (ongoing) { this.activeStage = ongoing; this.renderStage(participant, ongoing); }
        else if (!participant.stages.pre?.completedAt) {
            const button = node('button', 'Làm bài trước học', 'btn btn--primary'); button.id = 'assessmentStartPre'; button.type = 'button'; button.addEventListener('click', () => this.start('pre')); next.append(button);
        } else if (!participant.stages.post?.completedAt) {
            next.append(node('p', 'Tiếp tục học theo phân công, rồi quay lại làm bài sau học đúng lịch. Dùng mã này trên cùng trình duyệt để ghép kết quả.'));
            const link = node('a', participant.group === 'adaptive' ? 'Đến phần ôn tập theo lỗi' : 'Mở bài đầu khóa Arduino', 'btn');
            link.href = participant.group === 'adaptive' ? `${ROUTES.QUIZ}?course=arduino` : `${ROUTES.COURSE_LEARNING}?course=arduino&lesson=led`;
            const button = node('button', 'Làm bài sau học', 'btn btn--primary'); button.id = 'assessmentStartPost'; button.type = 'button'; button.addEventListener('click', () => this.start('post')); next.append(link, button);
        } else { this.activeStage = null; this.renderResult(participant); }
    }
    renderStage(participant, stage) {
        const record = participant.stages[stage];
        const questions = this.service.questions(participant.code, stage);
        el('assessmentGame').hidden = false;
        el('assessmentGameTitle').textContent = `${stageLabel(stage)} · đề ${record.form} · ${participant.code}`;
        el('assessmentQuestions').replaceChildren(...questions.map((question, index) => {
            const fieldset = node('fieldset'); fieldset.dataset.questionId = question.id;
            const lesson = ASSESSMENT_LESSONS.find(l => l.id === question.lessonId);
            fieldset.append(node('legend', `${index + 1}. ${question.q}`));
            const topic = node('p', lesson.title, 'assessment-muted'); fieldset.append(topic);
            question.opts.forEach((option, choice) => {
                const label = node('label', undefined, 'assessment-option');
                const input = document.createElement('input'); input.type = 'radio'; input.name = `assessment-${index}`; input.value = String(choice); input.dataset.questionIndex = String(index); input.required = true; input.checked = record.answers[index] === choice;
                label.append(input, node('span', `${String.fromCharCode(65 + choice)}. ${option}`)); fieldset.append(label);
            });
            return fieldset;
        }));
        this.progress();
    }
    progress() {
        const participant = this.service.getParticipant(this.currentCode);
        const record = participant?.stages[this.activeStage];
        if (!record) return;
        const answered = record.answers.filter(choice => choice !== null).length;
        el('assessmentProgress').textContent = `Đã lưu ${answered}/12 câu. Có thể đóng trang rồi mở lại đúng mã để tiếp tục.`;
        el('assessmentSubmitBtn').disabled = answered !== 12;
        el('assessmentSubmitBtn').textContent = `Nộp bài ${this.activeStage === 'pre' ? 'trước' : 'sau'} học`;
    }
    renderResult(participant) {
        const result = this.service.participantResult(participant.code);
        const host = el('assessmentIndividualResult');
        const box = node('div', undefined, 'assessment-result');
        box.append(node('h3', 'Kết quả hai lượt'), node('p', `Trước học: ${result.pre.correct}/12 (${percent(result.pre.percentage)}). Sau học: ${result.post.correct}/12 (${percent(result.post.percentage)}).`), node('strong', `Thay đổi: ${points(result.gain)}.`), node('p', 'Dùng bảng theo bài để chọn kiến thức cần củng cố. Đối chiếu kỹ năng thực hành với rubric của từng bài học.'));
        const table = node('table', undefined, 'assessment-table');
        table.append(node('caption', 'Đối chiếu theo bài · mỗi lượt 2 câu/bài'));
        const head = document.createElement('thead'), tr = node('tr'); ['Bài học', 'Trước học', 'Sau học'].forEach(title => { const th = node('th', title); th.scope = 'col'; tr.append(th); }); head.append(tr); table.append(head);
        const body = document.createElement('tbody');
        result.pre.byLesson.forEach((lesson, index) => { const row = node('tr'); row.append(node('td', lesson.title), node('td', `${lesson.correct}/2`), node('td', `${result.post.byLesson[index].correct}/2`)); body.append(row); }); table.append(body);
        const wrap = node('div', undefined, 'assessment-table-wrap'); wrap.append(table); box.append(wrap);
        for (const stage of ['pre', 'post']) {
            const detail = node('details'); detail.append(node('summary', `Xem đáp án bài ${stage === 'pre' ? 'trước' : 'sau'} học`));
            this.service.questions(participant.code, stage).forEach((q, index) => {
                const item = node('div'); const selection = participant.stages[stage].answers[index];
                item.append(node('h4', `${index + 1}. ${q.q}`), node('p', `Bạn chọn: ${q.opts[selection]}. ${selection === q.ans ? 'Đúng.' : 'Chưa đúng.'}`), node('p', `Đáp án đúng: ${q.opts[q.ans]}`), node('p', q.exp)); detail.append(item);
            }); box.append(detail);
        }
        host.append(box);
    }
    renderReport() {
        const report = this.service.report(), host = el('assessmentReportContent'); host.replaceChildren();
        const status = node('p', `${report.participants} mã đã lưu · ${report.paired} cặp trước–sau đầy đủ · ${report.unpaired} mã chờ hoàn thành lượt.`); status.id = 'assessmentPairedCount'; host.append(status);
        const table = node('table', undefined, 'assessment-table'); table.append(node('caption', 'Trung bình tính từ các mã đủ hai lượt; thay đổi tính bằng điểm phần trăm. Dấu — là nhóm đang chờ kết quả.'));
        const head = node('thead'), tr = node('tr'); ['Nhóm', 'Số cặp', 'TB trước', 'TB sau', 'TB thay đổi', 'Thứ tự AB / BA'].forEach(title => { const th = node('th', title); th.scope = 'col'; tr.append(th); }); head.append(tr); table.append(head);
        const body = node('tbody');
        report.groups.forEach(group => { const row = node('tr'); row.dataset.group = group.group; row.append(node('td', groupLabel(group.group)), node('td', String(group.n)), node('td', percent(group.preMean)), node('td', percent(group.postMean)), node('td', points(group.gainMean)), node('td', `${group.orders.AB} / ${group.orders.BA}`)); body.append(row); }); table.append(body);
        const wrap = node('div', undefined, 'assessment-table-wrap'); wrap.append(table); host.append(wrap);
        host.append(node('h3', 'Cách đọc kết quả'), node('p', 'Hai đề có cùng phân bố nội dung. Trước khi so sánh các nhóm, kiểm tra độ khó hai đề và đối chiếu mức đầu vào, thời lượng học, cách phân nhóm cùng số học sinh hoàn thành. Bảng phản ánh kết quả kiến thức của đợt học; dùng rubric riêng để đánh giá thực hành.'), node('p', 'Giữ hai đề cho các buổi kiểm tra có giám sát. Dùng ngân hàng ôn tập riêng trong thời gian học và công bố lời giải sau khi học sinh hoàn thành cả hai lượt.'));
    }
    confirmDelete(target) {
        this.deleteTarget = target;
        el('assessmentDeleteDescription').textContent = target === '*' ? 'Sẽ xóa toàn bộ mã và câu trả lời đánh giá trên trình duyệt này.' : `Sẽ xóa mã ${target} cùng cả hai lượt đánh giá của mã đó.`;
        el('assessmentDeleteDialog').showModal();
    }
    download(content, type, filename) {
        const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.notice('Đã tạo tệp tải xuống. Kiểm tra tệp trong thư mục tải của thiết bị.');
    }
}
