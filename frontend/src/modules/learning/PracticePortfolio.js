// Local learning records are learner reports, including when the fields are complete.
// These helpers never read storage, mutate an existing record, or verify a claim.
export const limits = Object.freeze({
    backupBytes: 1024 * 1024,
    lessons: 100,
    note: 15000,
    prediction: 2000,
    observation: 3000,
    explanation: 3000,
    transfer: 2000,
    projectUrl: 2048,
    summary: 2000,
    actions: 40,
    action: 200,
});

const SOURCES = new Set(['local-model', 'external', 'hardware']);
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const TEXT_FIELDS = ['note', 'prediction', 'observation', 'explanation', 'transfer'];
const hasOwn = (object, key) => Object.hasOwn(object, key);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const fail = message => { throw new Error(message); };

function safeId(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(value) && !UNSAFE_KEYS.has(value);
}

function text(value, field, maximum = limits[field]) {
    if (typeof value !== 'string' || value.length > maximum || /\u0000/.test(value)) {
        fail(`Trường ${field} cần là văn bản không quá ${maximum} ký tự.`);
    }
    return value;
}

function courseLessons(course) {
    if (!isObject(course) || !safeId(course.id) || !Array.isArray(course.lessons)
        || !course.lessons.length || course.lessons.length > limits.lessons) fail('Khóa học dùng để kiểm tra bản sao không hợp lệ.');
    const lessons = new Map();
    for (const lesson of course.lessons) {
        if (!isObject(lesson) || !safeId(lesson.id) || lessons.has(lesson.id)
            || !Array.isArray(lesson.opts) || !lesson.opts.length || lesson.opts.length > 100) {
            fail('Danh sách bài học dùng để kiểm tra bản sao không hợp lệ.');
        }
        lessons.set(lesson.id, lesson);
    }
    return lessons;
}

function modelEvidence(value, lessonId) {
    if (!isObject(value) || value.kind !== 'local-model' || value.lessonId !== lessonId) {
        fail('Minh chứng mô hình cần thuộc đúng bài học và có loại local-model.');
    }
    if (!Array.isArray(value.actions) || value.actions.length > limits.actions) {
        fail(`Minh chứng mô hình chỉ nhận tối đa ${limits.actions} thao tác.`);
    }
    const result = {
        kind: 'local-model',
        lessonId,
        summary: text(value.summary, 'summary'),
        actions: value.actions.map(action => text(action, 'action')),
    };
    // Older evidence can be kept as a draft, but cannot satisfy assessment without this snapshot.
    if (hasOwn(value, 'prediction')) result.prediction = text(value.prediction, 'prediction');
    return result;
}

function projectUrl(value) {
    const bounded = text(value, 'projectUrl');
    if (bounded === '') return '';
    let url;
    try { url = new URL(bounded); } catch { fail('Liên kết dự án cần là địa chỉ HTTPS đầy đủ.'); }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
        fail('Liên kết dự án cần dùng HTTPS và không chứa thông tin đăng nhập.');
    }
    return bounded;
}

function normalizeRecord(value, lesson, imported) {
    if (!isObject(value)) fail(`Nhật ký bài ${lesson.id} không hợp lệ.`);
    for (const key of Object.keys(value)) if (UNSAFE_KEYS.has(key)) fail('Bản sao chứa khóa dữ liệu không an toàn.');
    const result = { note: '', choice: null, done: false };
    for (const field of TEXT_FIELDS) if (hasOwn(value, field)) result[field] = text(value[field], field);
    if (hasOwn(value, 'choice')) {
        if (value.choice !== null && (!Number.isInteger(value.choice) || value.choice < 0 || value.choice >= lesson.opts.length)) {
            fail(`Đáp án đã lưu của bài ${lesson.id} nằm ngoài danh sách lựa chọn.`);
        }
        result.choice = value.choice;
    }
    if (hasOwn(value, 'done')) {
        if (typeof value.done !== 'boolean') fail(`Trạng thái hoàn thành của bài ${lesson.id} cần là đúng hoặc sai.`);
        result.done = value.done;
    }
    if (hasOwn(value, 'source')) {
        if (value.source !== '' && !SOURCES.has(value.source)) fail('Nguồn thực hành không hợp lệ.');
        result.source = value.source;
    }
    if (hasOwn(value, 'projectUrl')) result.projectUrl = projectUrl(value.projectUrl);
    if (hasOwn(value, 'completedAt')) result.completedAt = exportedAt(value.completedAt);
    if (hasOwn(value, 'modelEvidence') && value.modelEvidence !== null) result.modelEvidence = modelEvidence(value.modelEvidence, lesson.id);
    // Importing a checked box must never turn it into independently verified learning.
    if (result.done) result.completionSource = imported ? 'imported-self-report' : 'self-report';
    return result;
}

function normalizeRecords(records, lessons, imported) {
    if (!isObject(records)) fail('Bản sao cần có danh sách nhật ký bài học.');
    const keys = Object.keys(records);
    if (keys.length > lessons.size) fail('Bản sao chứa quá nhiều bài học.');
    const result = {};
    for (const lessonId of keys) {
        if (!safeId(lessonId) || !lessons.has(lessonId)) fail(`Bài học trong bản sao không thuộc khóa học: ${lessonId}.`);
        result[lessonId] = normalizeRecord(records[lessonId], lessons.get(lessonId), imported);
    }
    return result;
}

function exportedAt(value) {
    const date = text(value, 'exportedAt', 64);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(date) || !Number.isFinite(Date.parse(date))) fail('Thời gian xuất bản sao không hợp lệ.');
    return date;
}

/** Validate the entire JSON backup before the caller can replace or merge any state. */
export function parseCourseBackup(json, course) {
    const lessons = courseLessons(course);
    if (typeof json !== 'string' || json.length > limits.backupBytes
        || new TextEncoder().encode(json).length > limits.backupBytes) fail('Tệp nhật ký cần là JSON không quá 1 MiB.');
    let backup;
    try {
        backup = JSON.parse(json, (key, value) => {
            if (UNSAFE_KEYS.has(key)) fail('Bản sao chứa khóa dữ liệu không an toàn.');
            return value;
        });
    } catch { fail('Tệp nhật ký không phải JSON hợp lệ hoặc chứa khóa dữ liệu không an toàn.'); }
    if (!isObject(backup) || backup.course !== course.id) fail('Bản sao không thuộc khóa học đang mở.');
    if (hasOwn(backup, 'schemaVersion') && backup.schemaVersion !== 1 && backup.schemaVersion !== 2) {
        fail('Phiên bản bản sao nhật ký chưa được hỗ trợ.');
    }
    const result = { schemaVersion: 2, course: course.id, records: normalizeRecords(backup.records, lessons, true) };
    if (hasOwn(backup, 'exportedAt')) result.exportedAt = exportedAt(backup.exportedAt);
    return result;
}

/** Return a whitelisted JSON-ready backup without changing the source records. */
export function createCourseBackup(course, records, options = {}) {
    const lessons = courseLessons(course);
    const result = {
        schemaVersion: 2,
        course: course.id,
        records: normalizeRecords(records, lessons, false),
        exportedAt: exportedAt(options.exportedAt ?? new Date().toISOString()),
    };
    if (new TextEncoder().encode(JSON.stringify(result)).length > limits.backupBytes) fail('Nhật ký vượt quá giới hạn 1 MiB.');
    return result;
}

/** Presence checks support learner self-assessment; they do not grade free text or verify a project. */
export function assessPracticeRecord(record, { lesson, course } = {}) {
    const missing = [];
    if (!isObject(lesson) || !safeId(lesson.id) || !Array.isArray(lesson.opts)
        || !Number.isInteger(lesson.answer) || lesson.answer < 0 || lesson.answer >= lesson.opts.length
        || (course && (!Array.isArray(course.lessons) || !course.lessons.some(item => item.id === lesson.id)))) {
        return { ready: false, missing: ['Cần chọn một bài học hợp lệ.'], verified: false };
    }
    const value = isObject(record) ? record : {};
    const prompts = {
        prediction: 'Ghi dự đoán trước khi chạy với đầu vào cụ thể.',
        observation: 'Ghi đầu vào đã thử và kết quả đã quan sát.',
        explanation: 'Giải thích vì sao kết quả liên quan đến quy tắc của bài.',
        transfer: 'Đổi một đầu vào rồi ghi kết quả chạy lại và giải thích.',
    };
    for (const [field, prompt] of Object.entries(prompts)) {
        if (typeof value[field] !== 'string' || !value[field].trim() || value[field].length > limits[field] || /\u0000/.test(value[field])) missing.push(prompt);
    }
    if (value.choice !== lesson.answer) missing.push('Trả lời đúng câu kiểm tra của bài.');
    if (!SOURCES.has(value.source)) missing.push('Chọn nơi bạn đã thực hành.');
    if (hasOwn(value, 'projectUrl')) {
        try { projectUrl(value.projectUrl); } catch { missing.push('Liên kết dự án tùy chọn cần là địa chỉ HTTPS đầy đủ, không chứa thông tin đăng nhập.'); }
    }
    if (value.source === 'local-model') {
        let evidence;
        try { evidence = modelEvidence(value.modelEvidence, lesson.id); } catch { /* Report the missing evidence below. */ }
        if (!evidence || !evidence.summary.trim() || !evidence.actions.length || evidence.actions.some(action => !action.trim())) {
            missing.push('Chạy mô hình của bài với ít nhất một thao tác và lưu kết quả quan sát.');
        }
        if (!evidence || typeof value.prediction !== 'string' || !value.prediction.trim() || evidence.prediction !== value.prediction) {
            missing.push('Lưu dự đoán hiện tại trước khi chạy mô hình, rồi chạy lại.');
        }
    }
    return { ready: missing.length === 0, missing, verified: false };
}
