import { decodeLabFile, labFileExtension, normalizeLabFiles } from './LabArtifacts.js?v=lab-files-v2';
import { getLabWorkflow } from './LabPlatformWorkflows.js?v=lab-files-v2';
import { LabFileViewer } from './LabFileViewer.js?v=lab-files-v2';

export const LAB_WORK_LIMITS = Object.freeze({ codeBytes: 32768, notes: 2000, projectUrl: 2048, fileName: 120 });
// Includes retired platforms so existing account records and backups stay readable.
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
export function normalizeLabWork(value, platformKey) {
    if (!plain(value) || ![1, 2].includes(value.version)
        || Object.keys(value).some(key => !fields.has(key) && !(value.version === 2 && key === 'files')))
        fail('Bản lưu bài thực hành không hợp lệ.');
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
    return { version: value.version, savedAt, code, notes, projectUrl, fileName,
        ...(value.version === 2 ? { files: normalizeLabFiles(value.files, platformKey) } : {}) };
}
export function normalizeLabWorkMap(value, courseId) {
    if (!plain(value) || !Object.hasOwn(LAB_COURSE_PLATFORMS, courseId)) fail('Danh sách bài thực hành không hợp lệ.');
    const result = {};
    for (const [key, work] of Object.entries(value)) {
        if (!LAB_COURSE_PLATFORMS[courseId].includes(key)) fail('Bài làm chứa nền tảng không thuộc khóa học.');
        result[key] = normalizeLabWork(work, key);
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
    constructor(host, { onSave, isCurrent, getSyncStatus, readEditorSource, readExperiment, fileStore } = {}) {
        Object.assign(this, { host, onSave, isCurrent: isCurrent || (() => false), getSyncStatus: getSyncStatus || (() => ({})), readEditorSource, readExperiment, fileStore });
        this.drafts = new Map(); this.files = []; this.fileOperation = 0; this.generation = 0; this.dirty = false; this.ready = false;
        this.remoteFiles = []; this.fileScopeEpoch = 0; this.remoteLimits = { fileBytes: 25 * 1024 * 1024, accountBytes: 250 * 1024 * 1024, filesPerLab: 50 };
        this.viewer = new LabFileViewer();
        this.build();
    }
    build() {
        this.scopeLabel = element('p', '', 'small');
        this.status = element('p', 'Đang mở bài làm…', 'small'); this.status.id = 'labWorkStatus'; this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
        this.signIn = element('div'); this.signIn.id = 'labWorkSignInNotice'; this.signIn.hidden = true;
        this.signIn.append(element('p', 'Đăng nhập để lưu bài thực hành vào tài khoản và mở lại trên thiết bị khác. Bạn vẫn có thể xem bài và dùng các mô hình thực hành.'));
        const signInLink = element('a', 'Đăng nhập để lưu bài', 'btn btn--primary'); signInLink.id = 'labWorkSignIn'; signInLink.href = 'account.html'; this.signIn.append(signInLink);
        this.fieldset = element('fieldset'); Object.assign(this.fieldset.style, { border: '0', padding: '0', minWidth: '0' });
        this.method = element('p', '', 'lab-work-method'); this.method.id = 'labWorkMethod';
        this.saveSteps = element('ol'); this.saveSteps.id = 'labWorkSaveSteps'; this.fieldset.append(this.method, this.saveSteps);
        const field = (label, control) => { const title = element('label', label); title.htmlFor = control.id; this.fieldset.append(title, control); return title; };
        this.notes = element('textarea'); this.notes.id = 'labWorkNotes'; this.notes.rows = 3; this.notes.maxLength = LAB_WORK_LIMITS.notes;
        this.notesLabel = field('Ghi chú để tiếp tục bài', this.notes);
        this.experiment = element('button', 'Nhận kết quả từ bàn thực hành'); this.experiment.id = 'labWorkExperiment'; this.experiment.type = 'button'; this.experiment.hidden = true; this.fieldset.append(this.experiment);
        this.url = element('input'); this.url.id = 'labWorkProjectUrl'; this.url.type = 'url'; this.url.maxLength = LAB_WORK_LIMITS.projectUrl; this.url.placeholder = 'https://wokwi.com/projects/…'; this.urlLabel = field('Liên kết dự án của bạn', this.url);
        this.privacy = element('p', 'ST-Robot lưu liên kết trong tài khoản của bạn. Quyền xem dự án ở nền tảng ngoài do bạn đặt; liên kết chia sẻ có thể công khai.', 'small'); this.privacy.hidden = true; this.fieldset.append(this.privacy);
        this.fileArea = element('div', undefined, 'lab-work-files');
        const fileLabel = element('label', 'Thêm tệp bài làm', 'portfolio-import');
        this.attachments = element('input'); this.attachments.id = 'labWorkFiles'; this.attachments.type = 'file'; this.attachments.multiple = true;
        fileLabel.htmlFor = this.attachments.id; fileLabel.append(this.attachments);
        this.fileList = element('ul'); this.fileList.id = 'labWorkFileList';
        this.fileLimits = element('p', '', 'small'); this.fileLimits.id = 'labWorkFileLimits';
        this.fileUsage = element('p', '', 'small'); this.fileUsage.id = 'labWorkFileUsage';
        this.fileStatus = element('p', '', 'small'); this.fileStatus.id = 'labWorkFileStatus'; this.fileStatus.setAttribute('role', 'status'); this.fileStatus.setAttribute('aria-live', 'polite');
        this.cancelUpload = element('button', 'Hủy tải tệp'); this.cancelUpload.type = 'button'; this.cancelUpload.id = 'labWorkCancelUpload'; this.cancelUpload.hidden = true;
        this.cancelUpload.addEventListener('click', () => this.uploadController?.abort());
        this.fileArea.append(fileLabel, this.fileLimits, element('p', 'Ảnh, PDF, tài liệu, video, mã nguồn và các tệp khác đều được nhận. Tệp được lưu vào tài khoản khi tải lên hoàn tất.', 'small'), this.fileUsage, this.fileStatus, this.cancelUpload, this.fileList); this.fieldset.append(this.fileArea);
        const details = this.sourceDetails = element('details'); details.id = 'labWorkSourceDetails'; details.append(element('summary', 'Bản sao mã nguồn'));
        this.code = element('textarea'); this.code.id = 'labWorkCode'; this.code.rows = 8; this.code.maxLength = LAB_WORK_LIMITS.codeBytes; this.code.spellcheck = false; this.code.style.fontFamily = 'monospace'; this.code.setAttribute('translate', 'no'); this.code.placeholder = 'Dán mã của bạn hoặc nhập tệp mã nguồn. Ô này giữ bản sao, không chạy mã trong editor ngoài.';
        const label = this.codeLabel = element('label', 'Mã của tôi / nội dung tệp (tối đa 32 KiB)'); label.htmlFor = this.code.id;
        const tools = element('div', undefined, 'lab-actions'); const importLabel = element('label', 'Nhập tệp mã', 'portfolio-import');
        this.file = element('input'); this.file.id = 'labWorkFile'; this.file.type = 'file'; importLabel.htmlFor = this.file.id; importLabel.append(this.file);
        const download = element('button', 'Tải bản mã đang nhập'); download.id = 'labWorkDownload'; download.type = 'button';
        this.capture = element('button', 'Lấy mã Python đang mở'); this.capture.id = 'labWorkCapture'; this.capture.type = 'button'; this.capture.hidden = true;
        this.fileName = element('p', '', 'small'); tools.append(importLabel, download, this.capture);
        details.append(label, this.code, tools, this.fileName, element('p', 'Sửa bản sao mã nguồn không đổi tệp đính kèm. Sau khi sửa trong editor, xuất và thêm lại tệp dự án để giữ phiên bản mới.', 'small')); this.fieldset.append(details);
        const actions = element('div', undefined, 'lab-actions');
        this.save = element('button', 'Lưu bài thực hành', 'btn--primary'); this.save.id = 'labWorkSave'; this.save.type = 'button';
        this.restore = element('button', 'Xem bản đã lưu'); this.restore.id = 'labWorkRestore'; this.restore.type = 'button'; actions.append(this.save, this.restore); this.fieldset.append(actions);
        const reopen = element('details'); reopen.id = 'labWorkReopen'; reopen.append(element('summary', 'Mở lại bài trên nền tảng này'));
        this.reopenSteps = element('ol'); reopen.append(this.reopenSteps); this.fieldset.append(reopen);
        this.host.replaceChildren(element('h2', '3. Lưu bài thực hành'), this.scopeLabel, this.signIn, this.fieldset, this.status);
        for (const input of [this.code, this.notes, this.url]) input.addEventListener('input', () => {
            if (!this.ready || !this.isCurrent(this.context)) return;
            this.dirty = true; this.privacy.hidden = !this.url.value.trim(); this.remember();
            this.status.textContent = this.corrupt ? 'Bản cũ được giữ nguyên. Bấm Lưu để chủ động thay thế.' : 'Đang lưu thay đổi…';
            clearTimeout(this.timer); if (!this.corrupt) this.timer = setTimeout(() => this.persist(), 500);
        });
        this.save.addEventListener('click', () => this.persist());
        this.restore.addEventListener('click', () => void this.openSavedFiles());
        this.file.addEventListener('change', () => void this.importFile()); download.addEventListener('click', () => this.download());
        this.attachments.addEventListener('change', () => void this.importAttachments());
        this.experiment.addEventListener('click', () => {
            if (!this.ready || !this.isCurrent(this.context)) return;
            const report = this.readExperiment?.(this.context);
            if (typeof report !== 'string' || !report.trim()) { this.status.textContent = 'Chạy một lượt trên bàn thực hành trước khi nhận kết quả.'; return; }
            this.notes.value = report.slice(0, LAB_WORK_LIMITS.notes); this.dirty = true; this.persist();
        });
        this.capture.addEventListener('click', () => {
            if (!this.ready || !this.isCurrent(this.context)) return;
            const code = this.readEditorSource?.();
            if (typeof code !== 'string') { this.status.textContent = 'Chờ trình soạn thảo Python sẵn sàng rồi thử lại.'; return; }
            this.code.value = code; this.currentFileName = 'main.py'; this.dirty = true; this.persist();
        });
    }
    values() {
        const version = this.files.length || this.saved?.version === 2 ? 2 : 1;
        return { version, savedAt: new Date().toISOString(), code: this.code.value, notes: this.notes.value,
            projectUrl: this.url.value.trim(), fileName: this.currentFileName || '',
            ...(version === 2 ? { files: this.files.map(file => ({ ...file })) } : {}) };
    }
    remember() { if (this.context && this.dirty) this.drafts.set(this.key, this.values()); }
    fill(work) {
        this.code.value = work?.code || ''; this.notes.value = work?.notes || ''; this.url.value = work?.projectUrl || ''; this.currentFileName = work?.fileName || '';
        this.files = (work?.files || []).map(file => ({ ...file })); this.renderFiles();
        this.fileName.textContent = this.currentFileName ? 'Tệp: ' + this.currentFileName : ''; this.privacy.hidden = !this.url.value; this.dirty = false;
    }
    setContext(context, record, ready) {
        const previousOwner = this.context?.ownerId;
        this.remember(); clearTimeout(this.timer); this.generation++; this.context = { ...context }; this.ready = Boolean(ready && context.ownerId);
        // A logout/account switch must not retain the previous owner's drafts in the visible panel.
        if (previousOwner !== context.ownerId) this.drafts.clear();
        this.key = [context.ownerId || '@guest', context.courseId, context.lessonId, context.platformKey].join('|'); this.saved = null; this.corrupt = false;
        try { if (this.ready && record?.labWork?.[context.platformKey]) this.saved = normalizeLabWork(record.labWork[context.platformKey], context.platformKey); } catch { this.corrupt = true; }
        const draft = this.ready ? this.drafts.get(this.key) : null; this.fill(draft || this.saved); this.dirty = !!draft;
        this.fieldset.disabled = !this.ready; this.fieldset.hidden = !this.ready; this.signIn.hidden = !ready || Boolean(context.ownerId);
        this.capture.hidden = context.platformKey !== 'python'; this.restore.disabled = false;
        const workflow = getLabWorkflow(context.platformKey);
        this.workflow = workflow; this.method.textContent = workflow.sourceLabel;
        for (const [host, steps] of [[this.saveSteps, workflow.saveSteps], [this.reopenSteps, workflow.reopenSteps]]) host.replaceChildren(...steps.map(text => element('li', text)));
        this.notesLabel.textContent = workflow.notesLabel; this.notes.placeholder = workflow.notesPlaceholder;
        this.codeLabel.textContent = workflow.codeLabel || 'Mã nguồn của bản lưu cũ';
        this.sourceDetails.hidden = !workflow.codeVisible && !this.code.value;
        this.fileArea.hidden = false;
        this.attachments.removeAttribute('accept'); this.attachments.value = '';
        this.file.accept = workflow.extensions.filter(extension => !['.zip', '.hex', '.png', '.sb3'].includes(extension)).join(',');
        this.url.hidden = this.urlLabel.hidden = !workflow.projectUrlVisible && !this.url.value;
        this.urlLabel.textContent = workflow.projectUrlLabel || 'Liên kết của bản lưu cũ';
        this.experiment.hidden = context.platformKey !== 'local' || typeof this.readExperiment !== 'function';
        this.scopeLabel.textContent = context.platformName + ' · ' + (!ready ? 'Đang kiểm tra tài khoản' : context.ownerId ? 'Lưu cho tài khoản: ' + (context.accountLabel || 'tài khoản đang đăng nhập') : 'Chưa đăng nhập');
        if (!ready) this.status.textContent = 'Bạn có thể đọc bài trong lúc chờ mở bài làm.';
        else if (!context.ownerId) this.status.textContent = 'Chưa lưu vào tài khoản. Đăng nhập để lưu và đồng bộ bài thực hành.';
        else if (this.corrupt) this.status.textContent = 'Bản đã lưu cần kiểm tra và được giữ nguyên. Bấm Lưu để chủ động thay thế sau khi giữ hồ sơ dự phòng.';
        else if (this.dirty) this.status.textContent = 'Bản nháp chưa lưu vẫn được giữ. Bấm Lưu để thử lại hoặc tải bản mã.';
        else this.updateStatus();
        if (this.remoteScope !== this.key || this.remoteOwnerReady !== this.ready) {
            this.listController?.abort(); this.uploadController?.abort(); this.downloadController?.abort(); this.viewer.close(); this.fileScopeEpoch++;
            this.remoteScope = this.key; this.remoteOwnerReady = this.ready; this.remoteFiles = []; this.uploading = false;
            this.attachments.disabled = false; this.cancelUpload.hidden = true; this.fileStatus.textContent = ''; this.fileUsage.textContent = '';
            this.renderFiles();
            if (this.ready) void this.refreshRemote();
        }
        this.renderFileLimits();
    }
    persist() {
        clearTimeout(this.timer); if (!this.ready || !this.context?.ownerId || !this.isCurrent(this.context)) return false;
        if (this.corrupt && !confirm('Thay thế bản lưu chưa đọc được bằng nội dung đang nhập? Hãy giữ hồ sơ dự phòng trước.')) return false;
        try {
            const work = normalizeLabWork(this.values(), this.context.platformKey);
            if (this.onSave?.(this.context, work) !== true) throw Error('Chưa lưu được bài. Bản nháp vẫn được giữ; bạn có thể tải bản mã trước khi rời trang.');
            this.saved = work; this.corrupt = false; this.dirty = false; this.drafts.delete(this.key); this.fileName.textContent = work.fileName ? 'Tệp: ' + work.fileName : ''; this.updateStatus(); return true;
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
        const generation = this.generation, operation = ++this.fileOperation;
        try {
            if (file.size > LAB_WORK_LIMITS.codeBytes || !this.file.accept.split(',').includes(labFileExtension(file.name))) throw Error('Chọn tệp mã phù hợp không quá 32 KiB. Tệp dự án lớn hơn có thể thêm ở mục Thêm tệp dự án.');
            const code = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
            if (generation !== this.generation || operation !== this.fileOperation || !this.isCurrent(this.context)) return;
            const work = normalizeLabWork({ ...this.values(), code, fileName: file.name }, this.context.platformKey);
            this.code.value = work.code; this.currentFileName = work.fileName; this.dirty = true; this.persist();
        } catch (error) { if (generation === this.generation && operation === this.fileOperation && this.isCurrent(this.context)) this.status.textContent = error.message; }
    }
    fileCurrent(epoch = this.fileScopeEpoch) {
        return this.ready && epoch === this.fileScopeEpoch && this.isCurrent(this.context);
    }
    formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' KB';
        return (bytes / (1024 * 1024)).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' MB';
    }
    renderFileLimits() {
        this.fileLimits.textContent = `Tối đa ${this.formatBytes(this.remoteLimits.fileBytes)}/tệp, ${this.formatBytes(this.remoteLimits.accountBytes)}/tài khoản; ${this.remoteLimits.filesPerLab} tệp cho bài thực hành đang chọn.`;
    }
    fileError(error) {
        if (error?.name === 'AbortError' || error?.code === 'REQUEST_ABORTED') return 'Đã hủy thao tác. Các tệp đã lưu được giữ nguyên.';
        if (error?.status === 401 || error?.status === 403) return 'Phiên đăng nhập hoặc quyền lưu tệp đã thay đổi. Đăng nhập lại để tiếp tục.';
        if (error?.status === 404) return 'Chưa mở được kho tệp. Tải lại trang rồi thử lại.';
        if (error?.status === 413) return /tài khoản|Mỗi bài|Mỗi tệp/.test(error.message || '') ? error.message : 'Tệp vượt quá dung lượng cho phép.';
        if (/account.*(?:quota|limit)|quota.*account/i.test(error?.message || '')) return 'Tài khoản đã đạt giới hạn dung lượng. Xóa tệp không cần dùng rồi tải lại.';
        if (/lab.*(?:quota|limit)|(?:50|500).*files/i.test(error?.message || '')) return 'Số tệp đã đạt giới hạn. Xóa tệp không cần dùng rồi tải lại.';
        return error?.message || 'Chưa lưu được tệp. Kiểm tra kết nối rồi thử lại.';
    }
    async refreshRemote() {
        if (!this.fileStore || !this.fileCurrent()) return false;
        this.listController?.abort();
        const controller = this.listController = new AbortController(), epoch = this.fileScopeEpoch, context = { ...this.context };
        try {
            const result = await this.fileStore.list(context, { signal: controller.signal });
            if (!this.fileCurrent(epoch) || controller.signal.aborted) return false;
            this.remoteFiles = result.files;
            if (result.limits) this.remoteLimits = { ...this.remoteLimits, ...result.limits };
            this.renderFileLimits(); this.renderFiles();
            this.fileUsage.textContent = result.usage ? `Đã dùng ${this.formatBytes(result.usage.usedBytes || 0)} / ${this.formatBytes(this.remoteLimits.accountBytes)} trong tài khoản.` : '';
            if (!this.uploading) this.fileStatus.textContent = '';
            return true;
        } catch (error) {
            if (this.fileCurrent(epoch) && !controller.signal.aborted) this.fileStatus.textContent = this.fileError(error);
            return false;
        }
    }
    async importAttachments() {
        const selected = [...(this.attachments.files || [])]; this.attachments.value = '';
        if (!selected.length || !this.fileCurrent() || this.uploading) return;
        const epoch = this.fileScopeEpoch, context = { ...this.context };
        if (!this.fileStore) { this.fileStatus.textContent = 'Chưa mở được kho tệp. Tải lại trang rồi thử lại.'; return; }
        if (selected.some(file => file.size > this.remoteLimits.fileBytes)) {
            this.fileStatus.textContent = `Mỗi tệp được lưu tối đa ${this.formatBytes(this.remoteLimits.fileBytes)}.`; return;
        }
        if (this.remoteFiles.length + selected.length > this.remoteLimits.filesPerLab) {
            this.fileStatus.textContent = `Mỗi bài thực hành lưu tối đa ${this.remoteLimits.filesPerLab} tệp. Xóa tệp không cần dùng rồi tải lại.`; return;
        }
        const controller = this.uploadController = new AbortController();
        this.uploading = true; this.attachments.disabled = true; this.cancelUpload.hidden = false;
        let completed = 0;
        try {
            for (const file of selected) {
                if (!this.fileCurrent(epoch) || controller.signal.aborted) break;
                this.fileStatus.textContent = `Đang tải ${file.name}…`;
                const metadata = await this.fileStore.upload(context, file, { signal: controller.signal, onProgress: ({ loaded, total }) => {
                    if (this.fileCurrent(epoch) && !controller.signal.aborted) this.fileStatus.textContent = `Đang tải ${file.name} · ${total ? Math.round(loaded / total * 100) : 100}%.`;
                } });
                if (!this.fileCurrent(epoch) || controller.signal.aborted) break;
                this.remoteFiles = [...this.remoteFiles.filter(value => value.id !== metadata.id), metadata]; completed++; this.renderFiles();
            }
            if (this.fileCurrent(epoch)) {
                await this.refreshRemote();
                if (this.fileCurrent(epoch)) this.fileStatus.textContent = controller.signal.aborted
                    ? `Đã hủy tải. ${completed} tệp đã tải xong được giữ trong tài khoản.`
                    : `Đã lưu ${completed} tệp vào tài khoản. Bấm Xem bản đã lưu để chọn tệp và xem lại.`;
            }
        } catch (error) {
            if (this.fileCurrent(epoch)) this.fileStatus.textContent = this.fileError(error) + (completed ? ` ${completed} tệp đã tải xong được giữ trong tài khoản.` : '');
        } finally {
            if (this.fileCurrent(epoch)) { this.uploading = false; this.attachments.disabled = false; this.cancelUpload.hidden = true; }
        }
    }
    viewerFiles() {
        return [...(this.saved?.files || []).map((file, index) => ({ id: 'legacy-' + index, name: file.name,
            sizeBytes: decodeLabFile(file.dataBase64).length, legacy: file })), ...this.remoteFiles];
    }
    async openSavedFiles(selectedId) {
        if (!this.fileCurrent()) return;
        const epoch = this.fileScopeEpoch, context = { ...this.context };
        await this.refreshRemote();
        if (!this.fileCurrent(epoch)) return;
        const files = this.viewerFiles(), saved = this.saved;
        this.viewer.open({ files, notes: saved?.notes, code: saved?.code, sourceName: saved?.fileName,
            projectUrl: saved?.projectUrl, savedAt: saved?.savedAt,
            isCurrent: () => this.fileCurrent(epoch), getBytes: async (file, options) => {
                if (!this.fileCurrent(epoch)) throw Error('Bài thực hành đã thay đổi.');
                if (file.legacy) return decodeLabFile(file.legacy.dataBase64);
                return this.fileStore.download(context, file, options);
            } });
        if (selectedId) {
            const index = files.findIndex(file => file.id === selectedId);
            if (index >= 0) void this.viewer.select(index);
        }
    }
    renderFiles() {
        const generation = this.generation, epoch = this.fileScopeEpoch;
        const legacy = this.files.map((file, index) => ({ id: 'legacy-' + index, name: file.name, sizeBytes: decodeLabFile(file.dataBase64).length, legacy: file }));
        this.fileList.replaceChildren(...[...legacy, ...this.remoteFiles].map(file => {
            const item = element('li', undefined, 'lab-work-file'); item.dataset.fileId = file.id;
            const label = element('span', file.name + ' · ' + this.formatBytes(file.sizeBytes));
            if (file.createdAt && Number.isFinite(Date.parse(file.createdAt))) label.append(element('small', ' · ' + new Date(file.createdAt).toLocaleString('vi-VN')));
            item.append(label);
            const view = element('button', 'Xem tệp'); view.type = 'button';
            view.addEventListener('click', () => { if (this.fileCurrent(epoch)) void this.openSavedFiles(file.id); });
            const download = element('button', 'Tải tệp'); download.type = 'button';
            download.addEventListener('click', async () => {
                if (!this.fileCurrent(epoch)) return;
                this.downloadController?.abort(); const controller = this.downloadController = new AbortController();
                try {
                    const bytes = file.legacy ? decodeLabFile(file.legacy.dataBase64) : await this.fileStore.download({ ...this.context }, file, { signal: controller.signal });
                    if (this.fileCurrent(epoch) && !controller.signal.aborted) this.downloadBytes(bytes, file.name);
                } catch (error) { if (this.fileCurrent(epoch) && !controller.signal.aborted) this.fileStatus.textContent = this.fileError(error); }
            });
            const remove = element('button', file.legacy ? 'Bỏ khỏi bản lưu' : 'Xóa tệp'); remove.type = 'button';
            remove.addEventListener('click', async () => {
                if (!this.fileCurrent(epoch)) return;
                if (file.legacy) {
                    if (generation !== this.generation) return;
                    this.fileOperation++; this.files = this.files.filter(value => value.name !== file.name); this.dirty = true; this.renderFiles(); this.persist(); return;
                }
                if (!confirm('Xóa tệp “' + file.name + '” khỏi tài khoản? Tệp khác và ghi chú được giữ nguyên.')) return;
                remove.disabled = true;
                try {
                    await this.fileStore.remove({ ...this.context }, file.id);
                    if (!this.fileCurrent(epoch)) return;
                    this.viewer.close(); this.remoteFiles = this.remoteFiles.filter(value => value.id !== file.id); this.renderFiles();
                    await this.refreshRemote();
                    if (this.fileCurrent(epoch)) this.fileStatus.textContent = 'Đã xóa tệp khỏi tài khoản.';
                } catch (error) { if (this.fileCurrent(epoch)) { remove.disabled = false; this.fileStatus.textContent = this.fileError(error); } }
            });
            item.append(view, download, remove); return item;
        }));
    }
    downloadBytes(bytes, name) {
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
        const link = element('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    download() {
        if (!this.ready || !this.isCurrent(this.context)) return;
        const name = this.currentFileName || [this.context.courseId, this.context.lessonId, this.context.platformKey].join('-') + (this.workflow?.defaultExtension || '.txt');
        const url = URL.createObjectURL(new Blob([this.code.value], { type: 'text/plain;charset=utf-8' })); const link = element('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    hasDraft() { return this.dirty || this.drafts.size > 0 || this.uploading; }
    destroy() { clearTimeout(this.timer); this.listController?.abort(); this.uploadController?.abort(); this.downloadController?.abort(); this.viewer.destroy(); this.fileScopeEpoch++; this.remoteFiles = []; this.generation++; this.ready = false; this.drafts.clear(); this.fill(null); this.saved = null; this.fieldset.disabled = true; this.fieldset.hidden = true; }
}
