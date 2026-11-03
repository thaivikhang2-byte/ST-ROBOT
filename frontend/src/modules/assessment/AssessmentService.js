import { ASSESSMENT_VERSION, ASSESSMENT_FORMS, ASSESSMENT_LESSONS } from '../../data/assessment.js?v=study-20261103-v1';

export const ASSESSMENT_STORAGE_KEY = 'strobot.assessment.v1';
export const ASSESSMENT_MAX_PARTICIPANTS = 200;
const clone = value => JSON.parse(JSON.stringify(value));
const isTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const codePattern = /^[A-Z0-9][A-Z0-9_-]{2,23}$/;
const stageNames = ['pre', 'post'];
const formFor = (participant, stage) => participant.order[stage === 'pre' ? 0 : 1];
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const csvCell = value => {
    let text = value === null || value === undefined ? '' : String(value);
    // Quoting alone does not prevent a spreadsheet from evaluating a formula.
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
};

export class AssessmentService {
    constructor({ storage, now = () => Date.now() } = {}) {
        this.now = now;
        this.problem = '';
        if (storage !== undefined) this.storage = storage;
        else { try { this.storage = globalThis.localStorage; } catch { this.storage = null; } }
    }
    timestamp() {
        const time = this.now();
        if (!Number.isFinite(time)) throw new Error('Đồng hồ thiết bị không hợp lệ. Kiểm tra lại trước khi làm bài.');
        return new Date(time).toISOString();
    }
    normalizeCode(code) { return typeof code === 'string' ? code.trim().toUpperCase() : ''; }
    validParticipant(p) {
        if (!p || typeof p.code !== 'string' || !codePattern.test(p.code) || !['fixed', 'adaptive'].includes(p.group) || !['AB', 'BA'].includes(p.order) || !isTime(p.createdAt) || !p.stages || typeof p.stages !== 'object' || Array.isArray(p.stages)) return false;
        if (Object.keys(p.stages).some(key => !stageNames.includes(key))) return false;
        for (const stage of stageNames) {
            const record = p.stages[stage];
            if (!record) continue;
            const form = ASSESSMENT_FORMS[formFor(p, stage)];
            if (record.form !== formFor(p, stage) || !isTime(record.startedAt) || !(record.completedAt === null || isTime(record.completedAt)) || !Array.isArray(record.answers) || record.answers.length !== form.length || !Array.isArray(record.answeredAt) || record.answeredAt.length !== form.length) return false;
            for (let index = 0; index < form.length; index++) {
                const choice = record.answers[index];
                if (choice === null) { if (record.answeredAt[index] !== null) return false; }
                else if (!Number.isInteger(choice) || choice < 0 || choice >= form[index].opts.length || !isTime(record.answeredAt[index])) return false;
            }
            if (record.completedAt && record.answers.includes(null)) return false;
        }
        return !p.stages.post || Boolean(p.stages.pre?.completedAt);
    }
    readState() {
        this.problem = '';
        if (!this.storage) { this.problem = 'Trình duyệt không cho lưu dữ liệu. Hãy bật bộ nhớ trang trước khi đánh giá.'; return { version: ASSESSMENT_VERSION, participants: [] }; }
        try {
            const raw = this.storage.getItem(ASSESSMENT_STORAGE_KEY);
            if (raw === null) return { version: ASSESSMENT_VERSION, participants: [] };
            if (raw.length > 2000000) throw new Error('Too large');
            const state = JSON.parse(raw);
            if (state?.version !== ASSESSMENT_VERSION || !Array.isArray(state.participants) || state.participants.length > ASSESSMENT_MAX_PARTICIPANTS || !state.participants.every(p => this.validParticipant(p)) || new Set(state.participants.map(p => p.code)).size !== state.participants.length) throw new Error('Invalid data');
            return state;
        } catch {
            this.problem = 'Chưa đọc được dữ liệu đánh giá đã lưu. Tải bản sao JSON để giữ dữ liệu trước khi xóa và bắt đầu lại.';
            return { version: ASSESSMENT_VERSION, participants: [] };
        }
    }
    writeState(state) {
        if (this.problem) throw new Error(this.problem);
        try { this.storage.setItem(ASSESSMENT_STORAGE_KEY, JSON.stringify(state)); }
        catch { throw new Error('Không lưu được thay đổi. Bộ nhớ có thể đã đầy hoặc bị chặn. Câu trả lời vừa chọn chưa được lưu; hãy tải bản sao dữ liệu và thử lại.'); }
    }
    listParticipants() { return clone(this.readState().participants); }
    getParticipant(code) { return this.listParticipants().find(p => p.code === this.normalizeCode(code)) || null; }
    createParticipant({ code, group, order }) {
        const state = this.readState();
        if (this.problem) throw new Error(this.problem);
        code = this.normalizeCode(code);
        if (!codePattern.test(code)) throw new Error('Mã cần 3–24 ký tự: chữ Latin, số, dấu gạch ngang hoặc gạch dưới. Không dùng họ tên hay thông tin liên hệ.');
        if (!['fixed', 'adaptive'].includes(group) || !['AB', 'BA'].includes(order)) throw new Error('Chọn nhóm học và thứ tự đề do người phụ trách phân công.');
        if (state.participants.some(p => p.code === code)) throw new Error('Mã này đã có trên thiết bị. Chọn “Mở mã đã lưu” để tiếp tục.');
        if (state.participants.length >= ASSESSMENT_MAX_PARTICIPANTS) throw new Error('Thiết bị đã lưu đủ 200 mã. Xuất dữ liệu trước khi xóa các mã không còn dùng.');
        const participant = { code, group, order, createdAt: this.timestamp(), stages: {} };
        state.participants.push(participant); this.writeState(state); return clone(participant);
    }
    mutate(code, callback) {
        const state = this.readState();
        if (this.problem) throw new Error(this.problem);
        const participant = state.participants.find(p => p.code === this.normalizeCode(code));
        if (!participant) throw new Error('Không tìm thấy mã trên trình duyệt này.');
        callback(participant); this.writeState(state); return clone(participant);
    }
    startStage(code, stage) {
        if (!stageNames.includes(stage)) throw new Error('Lượt đánh giá không hợp lệ.');
        return this.mutate(code, participant => {
            if (stage === 'post' && !participant.stages.pre?.completedAt) throw new Error('Cần nộp bài trước học trước khi làm bài sau học.');
            if (participant.stages[stage]) return;
            const form = formFor(participant, stage);
            participant.stages[stage] = { form, startedAt: this.timestamp(), completedAt: null, answers: ASSESSMENT_FORMS[form].map(() => null), answeredAt: ASSESSMENT_FORMS[form].map(() => null) };
        });
    }
    answer(code, stage, index, choice) {
        if (!stageNames.includes(stage)) throw new Error('Lượt đánh giá không hợp lệ.');
        return this.mutate(code, participant => {
            const record = participant.stages[stage];
            if (!record || record.completedAt) throw new Error('Lượt này chưa bắt đầu hoặc đã nộp; không thể sửa câu trả lời.');
            const question = ASSESSMENT_FORMS[record.form][index];
            if (!Number.isInteger(index) || !question || !Number.isInteger(choice) || choice < 0 || choice >= question.opts.length) throw new Error('Đáp án không hợp lệ.');
            record.answers[index] = choice; record.answeredAt[index] = this.timestamp();
        });
    }
    submitStage(code, stage) {
        if (!stageNames.includes(stage)) throw new Error('Lượt đánh giá không hợp lệ.');
        return this.mutate(code, participant => {
            const record = participant.stages[stage];
            if (!record) throw new Error('Chưa bắt đầu lượt đánh giá này.');
            if (record.completedAt) return; // Repeated submissions never change the original result.
            if (record.answers.includes(null)) throw new Error('Cần trả lời đủ 12 câu trước khi nộp bài.');
            record.completedAt = this.timestamp();
        });
    }
    questions(code, stage) {
        const participant = this.getParticipant(code);
        const record = participant?.stages[stage];
        if (!record) return [];
        // The view receives neither answer keys nor explanations before the pair is complete.
        const showAnswers = Boolean(participant.stages.post?.completedAt);
        return ASSESSMENT_FORMS[record.form].map(q => showAnswers ? clone(q) : { id: q.id, lessonId: q.lessonId, q: q.q, opts: [...q.opts] });
    }
    score(participant, stage) {
        const record = participant.stages[stage];
        if (!record?.completedAt) return null;
        const questions = ASSESSMENT_FORMS[record.form];
        const correct = questions.reduce((sum, q, index) => sum + Number(record.answers[index] === q.ans), 0);
        const byLesson = ASSESSMENT_LESSONS.map(lesson => ({ ...lesson, correct: questions.reduce((sum, q, index) => sum + Number(q.lessonId === lesson.id && record.answers[index] === q.ans), 0), total: questions.filter(q => q.lessonId === lesson.id).length }));
        const start = Date.parse(record.startedAt), end = Date.parse(record.completedAt);
        const timingValid = end >= start && end - start <= 86400000 && record.answeredAt.every(time => Date.parse(time) >= start && Date.parse(time) <= end);
        return { correct, total: questions.length, percentage: correct / questions.length * 100, byLesson, durationMs: timingValid ? end - start : null, timingValid };
    }
    participantResult(code) {
        const participant = this.getParticipant(code);
        if (!participant?.stages.post?.completedAt) return null;
        const pre = this.score(participant, 'pre'), post = this.score(participant, 'post');
        return { code: participant.code, group: participant.group, order: participant.order, pre, post, gain: post.percentage - pre.percentage };
    }
    report() {
        const participants = this.listParticipants();
        const pairs = participants.filter(p => p.stages.post?.completedAt).map(p => {
            const pre = this.score(p, 'pre'), post = this.score(p, 'post');
            return { code: p.code, group: p.group, order: p.order, pre, post, gain: post.percentage - pre.percentage };
        });
        const groups = ['fixed', 'adaptive'].map(group => {
            const rows = pairs.filter(p => p.group === group);
            return { group, n: rows.length, preMean: mean(rows.map(p => p.pre.percentage)), postMean: mean(rows.map(p => p.post.percentage)), gainMean: mean(rows.map(p => p.gain)), validTimingPairs: rows.filter(p => p.pre.timingValid && p.post.timingValid).length, orders: { AB: rows.filter(p => p.order === 'AB').length, BA: rows.filter(p => p.order === 'BA').length } };
        });
        return { participants: participants.length, paired: pairs.length, unpaired: participants.length - pairs.length, pairs, groups };
    }
    exportCsv() {
        const participants = this.listParticipants();
        if (this.problem) throw new Error(this.problem);
        const headers = ['bank_version', 'participant_code', 'group', 'order', 'stage', 'form', 'stage_status', 'question_id', 'lesson_id', 'selected_option_1based', 'correct_if_pair_complete', 'stage_started_at_utc', 'answered_at_utc', 'stage_completed_at_utc', 'duration_ms', 'timing_valid'];
        const rows = [headers];
        for (const p of participants) for (const stage of stageNames) {
            const record = p.stages[stage];
            if (!record) {
                // Preserve enrollment and missing-stage counts, including students who never began.
                rows.push([ASSESSMENT_VERSION, p.code, p.group, p.order, stage, formFor(p, stage), 'not_started', '', '', '', '', '', '', '', '', '']);
                continue;
            }
            const paired = Boolean(p.stages.post?.completedAt);
            const score = this.score(p, stage);
            ASSESSMENT_FORMS[record.form].forEach((q, index) => rows.push([ASSESSMENT_VERSION, p.code, p.group, p.order, stage, record.form, record.completedAt ? 'completed' : 'in_progress', q.id, q.lessonId, record.answers[index] === null ? '' : record.answers[index] + 1, paired ? Number(record.answers[index] === q.ans) : '', record.startedAt, record.answeredAt[index], record.completedAt, score?.durationMs, score ? Number(score.timingValid) : '']));
        }
        return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
    }
    exportJson() {
        // Preserve even unreadable data for recovery instead of silently discarding it.
        try { return this.storage?.getItem(ASSESSMENT_STORAGE_KEY) || JSON.stringify({ version: ASSESSMENT_VERSION, participants: [] }, null, 2); }
        catch { throw new Error('Trình duyệt không cho đọc bản sao dữ liệu.'); }
    }
    deleteParticipant(code) {
        const state = this.readState();
        if (this.problem) throw new Error(this.problem);
        state.participants = state.participants.filter(p => p.code !== this.normalizeCode(code)); this.writeState(state);
    }
    clearAll() {
        if (!this.storage) throw new Error('Không truy cập được bộ nhớ trình duyệt.');
        try { this.storage.removeItem(ASSESSMENT_STORAGE_KEY); this.problem = ''; }
        catch { throw new Error('Chưa xóa được dữ liệu trên trình duyệt.'); }
    }
}
