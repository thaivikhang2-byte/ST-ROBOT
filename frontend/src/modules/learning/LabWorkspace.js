export const LAB_WORK_LIMITS = Object.freeze({ codeBytes: 32768, notes: 2000, projectUrl: 2048, fileName: 120 });
export const LAB_COURSE_PLATFORMS = Object.freeze({
    arduino: ['circuit', 'avr', 'wokwi', 'phet', 'local'], microbit: ['python', 'scratch', 'arcade', 'local'],
    'vex-iq': ['gears', 'scratch', 'arcade', 'local'], 'lego-spike': ['gears', 'scratch', 'arcade', 'local'], 'vex-vr': ['gears', 'scratch', 'arcade', 'local'],
});
const encoder = new TextEncoder();
const fields = new Set(['version', 'savedAt', 'code', 'notes', 'projectUrl', 'fileName']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = message => { throw new Error(message); };
const bounded = (value, maximum, label) => {
    if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) fail(`${label} không hợp lệ hoặc quá dài.`);
    return value;
};
export function normalizeLabWork(value) {
    if (!plain(value) || value.version !== 1 || Object.keys(value).some(key => !fields.has(key))) fail('Bản lưu bài thực hành không hợp lệ.');
    const savedAt = bounded(value.savedAt, 64, 'Thời gian lưu');
    if (!/^\d{4}-\d{2}-\d{2}T/.test(savedAt) || !Number.isFinite(Date.parse(savedAt))) fail('Thời gian lưu không hợp lệ.');
    const code = bounded(value.code, LAB_WORK_LIMITS.codeBytes, 'Mã bài làm');
    if (encoder.encode(code).length > LAB_WORK_LIMITS.codeBytes) fail('Mã bài làm vượt 32 KiB. Hãy tải bản mã đang nhập hoặc lưu liên kết dự án.');
    const notes = bounded(value.notes, LAB_WORK_LIMITS.notes, 'Ghi chú');
    const projectUrl = bounded(value.projectUrl, LAB_WORK_LIMITS.projectUrl, 'Liên kết dự án');
    if (projectUrl) {
        let url;
        try { url = new URL(projectUrl); } catch { fail('Liên kết dự án cần là địa chỉ HTTPS đầy đủ.'); }
        if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) fail('Liên kết dự án cần dùng HTTPS, không kèm thông tin đăng nhập.');
    }
    const fileName = bounded(value.fileName, LAB_WORK_LIMITS.fileName, 'Tên tệp');
    if (fileName && (/[\/\\\u0000-\u001f\u007f]/.test(fileName) || fileName.includes('..') || ['__proto__', 'prototype', 'constructor'].includes(fileName))) fail('Tên tệp không hợp lệ.');
    return { version: 1, savedAt, code, notes, projectUrl, fileName };
}
export function normalizeLabWorkMap(value, courseId) {
    if (!plain(value) || !Object.hasOwn(LAB_COURSE_PLATFORMS, courseId)) fail('Danh sách bài thực hành không hợp lệ.');
    const result = {};
    for (const [key, work] of Object.entries(value)) {
        if (!LAB_COURSE_PLATFORMS[courseId].includes(key)) fail('Bài làm chứa nền tảng không thuộc khóa học.');
        result[key] = normalizeLabWork(work);
    }
    return result;
}
const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
};
/** Records are written by the host's owner-bound course writer, never an external iframe/account. */
export class LabWorkspacePanel {
    constructor(host, { onSave, isCurrent, getSyncStatus, readEditorSource } = {}) {
        Object.assign(this, { host, onSave, isCurrent: isCurrent || (() => false), getSyncStatus: getSyncStatus || (() => ({})), readEditorSource });
        this.drafts = new Map(); this.generation = 0; this.dirty = false; this.ready = false;
        this.build();
    }
    build() {
        this.scopeLabel = element('p', '', 'small');
        this.status = element('p', 'Đang mở bài làm…', 'small'); this.status.id = 'labWorkStatus'; this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
        this.signIn = element('div'); this.signIn.id = 'labWorkSignInNotice'; this.signIn.hidden = true;
        this.signIn.append(element('p', 'Đăng nhập để lưu bài thực hành vào tài khoản và mở lại trên thiết bị khác. Bạn vẫn có thể xem bài và dùng các mô hình thực hành.'));
        const signInLink = element('a', 'Đăng nhập để lưu bài', 'btn btn--primary'); signInLink.id = 'labWorkSignIn'; signInLink.href = 'account.html'; this.signIn.append(signInLink);
        this.fieldset = element('fieldset'); Object.assign(this.fieldset.style, { border: '0', padding: '0', minWidth: '0' });
        const field = (label, node) => { const title = element('label', label); title.htmlFor = node.id; this.fieldset.append(title, node); };
        this.notes = element('textarea'); this.notes.id = 'labWorkNotes'; this.notes.rows = 2; this.notes.maxLength = LAB_WORK_LIMITS.notes; this.notes.placeholder = 'Bạn đang làm đến đâu? Bước tiếp theo là gì?'; field('Ghi chú để tiếp tục bài', this.notes);
        this.url = element('input'); this.url.id = 'labWorkProjectUrl'; this.url.type = 'url'; this.url.maxLength = LAB_WORK_LIMITS.projectUrl; this.url.placeholder = 'https://…'; field('Liên kết dự án của bạn (nếu có)', this.url);
        this.privacy = element('p', 'ST-Robot lưu liên kết trong tài khoản của bạn. Quyền xem dự án ở nền tảng ngoài do bạn đặt; liên kết chia sẻ có thể công khai.', 'small'); this.privacy.hidden = true; this.fieldset.append(this.privacy);
        const details = element('details'); details.append(element('summary', 'Mã nguồn và tệp bài làm'));
        this.code = element('textarea'); this.code.id = 'labWorkCode'; this.code.rows = 8; this.code.maxLength = LAB_WORK_LIMITS.codeBytes; this.code.spellcheck = false; this.code.style.fontFamily = 'monospace'; this.code.setAttribute('translate', 'no'); this.code.placeholder = 'Dán mã của bạn hoặc nhập tệp mã nguồn. Ô này giữ bản sao, không chạy mã trong editor ngoài.';
        const label = element('label', 'Mã của tôi / nội dung tệp (tối đa 32 KiB)'); label.htmlFor = this.code.id;
        const tools = element('div', undefined, 'lab-actions'); const importLabel = element('label', 'Nhập tệp mã', 'portfolio-import');
        this.file = element('input'); this.file.id = 'labWorkFile'; this.file.type = 'file'; this.file.accept = '.py,.ino,.cpp,.c,.h,.js,.ts,.json,.xml,.txt,.html,.css,.md'; importLabel.htmlFor = this.file.id; importLabel.append(this.file);
        const download = element('button', 'Tải bản mã đang nhập'); download.id = 'labWorkDownload'; download.type = 'button';
        this.capture = element('button', 'Lấy mã Python đang mở'); this.capture.id = 'labWorkCapture'; this.capture.type = 'button'; this.capture.hidden = true;
        this.fileName = element('p', '', 'small'); tools.append(importLabel, download, this.capture);
        details.append(label, this.code, tools, this.fileName, element('p', 'Bản sao được lưu riêng trong hồ sơ ST-Robot. Editor ngoài vẫn lưu/mở dự án theo cách của nền tảng đó.', 'small')); this.fieldset.append(details);
        const actions = element('div', undefined, 'lab-actions');
        this.save = element('button', 'Lưu bài thực hành', 'btn--primary'); this.save.id = 'labWorkSave'; this.save.type = 'button';
        this.restore = element('button', 'Nạp bản đã lưu'); this.restore.id = 'labWorkRestore'; this.restore.type = 'button'; actions.append(this.save, this.restore); this.fieldset.append(actions);
        this.host.replaceChildren(element('h2', 'Bài thực hành của tôi'), this.scopeLabel, this.signIn, this.fieldset, this.status);
        for (const input of [this.code, this.notes, this.url]) input.addEventListener('input', () => {
            if (!this.ready || !this.isCurrent(this.context)) return;
            this.dirty = true; this.privacy.hidden = !this.url.value.trim(); this.remember();
            this.status.textContent = this.corrupt ? 'Bản cũ được giữ nguyên. Bấm Lưu để chủ động thay thế.' : 'Đang lưu thay đổi…';
            clearTimeout(this.timer); if (!this.corrupt) this.timer = setTimeout(() => this.persist(), 500);
        });
        this.save.addEventListener('click', () => this.persist());
        this.restore.addEventListener('click', () => {
            if (!this.ready || !this.isCurrent(this.context) || this.corrupt) return;
            if (this.dirty && !confirm('Bỏ thay đổi chưa lưu và nạp bản đã lưu? Hãy tải bản mã trước nếu cần giữ lại.')) return;
            clearTimeout(this.timer); this.drafts.delete(this.key); this.fill(this.saved); this.status.textContent = 'Đã nạp bản lưu vào ô bài làm. Editor ngoài được quản lý riêng.';
        });
        this.file.addEventListener('change', () => void this.importFile()); download.addEventListener('click', () => this.download());
        this.capture.addEventListener('click', () => {
            if (!this.ready || !this.isCurrent(this.context)) return;
            const code = this.readEditorSource?.();
            if (typeof code !== 'string') { this.status.textContent = 'Chờ trình soạn thảo Python sẵn sàng rồi thử lại.'; return; }
            this.code.value = code; this.currentFileName = 'main.py'; this.dirty = true; this.persist();
        });
    }
    values() { return { version: 1, savedAt: new Date().toISOString(), code: this.code.value, notes: this.notes.value, projectUrl: this.url.value.trim(), fileName: this.currentFileName || '' }; }
    remember() { if (this.context && this.dirty) this.drafts.set(this.key, this.values()); }
    fill(work) {
        this.code.value = work?.code || ''; this.notes.value = work?.notes || ''; this.url.value = work?.projectUrl || ''; this.currentFileName = work?.fileName || '';
        this.fileName.textContent = this.currentFileName ? 'Tệp: ' + this.currentFileName : ''; this.privacy.hidden = !this.url.value; this.dirty = false;
    }
    setContext(context, record, ready) {
        const previousOwner = this.context?.ownerId;
        this.remember(); clearTimeout(this.timer); this.generation++; this.context = { ...context }; this.ready = Boolean(ready && context.ownerId);
        // A logout/account switch must not retain the previous owner's drafts in the visible panel.
        if (previousOwner !== context.ownerId) this.drafts.clear();
        this.key = [context.ownerId || '@guest', context.courseId, context.lessonId, context.platformKey].join('|'); this.saved = null; this.corrupt = false;
        try { if (this.ready && record?.labWork?.[context.platformKey]) this.saved = normalizeLabWork(record.labWork[context.platformKey]); } catch { this.corrupt = true; }
        const draft = this.ready ? this.drafts.get(this.key) : null; this.fill(draft || this.saved); this.dirty = !!draft;
        this.fieldset.disabled = !this.ready; this.fieldset.hidden = !this.ready; this.signIn.hidden = !ready || Boolean(context.ownerId);
        this.capture.hidden = context.platformKey !== 'python'; this.restore.disabled = this.corrupt;
        this.scopeLabel.textContent = context.platformName + ' · ' + (!ready ? 'Đang kiểm tra tài khoản' : context.ownerId ? 'Lưu cho tài khoản: ' + (context.accountLabel || 'tài khoản đang đăng nhập') : 'Chưa đăng nhập');
        if (!ready) this.status.textContent = 'Bạn có thể đọc bài trong lúc chờ mở bài làm.';
        else if (!context.ownerId) this.status.textContent = 'Chưa lưu vào tài khoản. Đăng nhập để lưu và đồng bộ bài thực hành.';
        else if (this.corrupt) this.status.textContent = 'Bản đã lưu cần kiểm tra và được giữ nguyên. Bấm Lưu để chủ động thay thế sau khi giữ hồ sơ dự phòng.';
        else if (this.dirty) this.status.textContent = 'Bản nháp chưa lưu vẫn được giữ. Bấm Lưu để thử lại hoặc tải bản mã.';
        else this.updateStatus();
    }
    persist() {
        clearTimeout(this.timer); if (!this.ready || !this.context?.ownerId || !this.isCurrent(this.context)) return false;
        if (this.corrupt && !confirm('Thay thế bản lưu chưa đọc được bằng nội dung đang nhập? Hãy giữ hồ sơ dự phòng trước.')) return false;
        try {
            const work = normalizeLabWork(this.values());
            if (this.onSave?.(this.context, work) !== true) throw Error('Chưa lưu được bài. Bản nháp vẫn được giữ; bạn có thể tải bản mã trước khi rời trang.');
            this.saved = work; this.corrupt = false; this.dirty = false; this.restore.disabled = false; this.drafts.delete(this.key); this.fileName.textContent = work.fileName ? 'Tệp: ' + work.fileName : ''; this.updateStatus(); return true;
        } catch (error) { this.dirty = true; this.remember(); this.status.textContent = error?.message || 'Chưa lưu được bài; bản nháp vẫn được giữ.'; return false; }
    }
    updateStatus() {
        if (!this.ready || !this.context?.ownerId || this.dirty || this.corrupt) return;
        if (!this.saved) { this.status.textContent = 'Ghi chú, liên kết và mã sẽ được lưu vào tài khoản đang đăng nhập, riêng cho nền tảng này.'; return; }
        const time = new Date(this.saved.savedAt).toLocaleString('vi-VN'), sync = this.getSyncStatus();
        this.status.textContent = sync?.status === 'synced' ? `Đã đồng bộ bài làm vào tài khoản · ${time}.` : `Đã giữ bản nháp của tài khoản trên thiết bị · ${time}. ${sync?.message || 'Đang chờ đồng bộ với tài khoản.'}`;
    }
    async importFile() {
        const file = this.file.files?.[0]; this.file.value = ''; if (!file || !this.ready || !this.isCurrent(this.context)) return;
        const generation = this.generation;
        try {
            if (file.size > LAB_WORK_LIMITS.codeBytes || !/\.(?:py|ino|cpp|c|h|js|ts|json|xml|txt|html|css|md)$/i.test(file.name)) throw Error('Chọn tệp mã văn bản không quá 32 KiB. Dự án lớn hoặc tệp nén hãy giữ ở nền tảng gốc và lưu liên kết.');
            const code = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
            if (generation !== this.generation || !this.isCurrent(this.context)) return;
            const work = normalizeLabWork({ ...this.values(), code, fileName: file.name });
            this.code.value = work.code; this.currentFileName = work.fileName; this.dirty = true; this.persist();
        } catch (error) { if (generation === this.generation && this.isCurrent(this.context)) this.status.textContent = error.message; }
    }
    download() {
        if (!this.ready || !this.isCurrent(this.context)) return;
        const name = this.currentFileName || [this.context.courseId, this.context.lessonId, this.context.platformKey].join('-') + '.txt';
        const url = URL.createObjectURL(new Blob([this.code.value], { type: 'text/plain;charset=utf-8' })); const link = element('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    hasDraft() { return this.dirty || this.drafts.size > 0; }
    destroy() { clearTimeout(this.timer); this.generation++; this.ready = false; this.drafts.clear(); this.fill(null); this.saved = null; this.fieldset.disabled = true; this.fieldset.hidden = true; }
}
