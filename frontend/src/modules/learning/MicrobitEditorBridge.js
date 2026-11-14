import { getLearnerStorage } from '../../services/LearnerSyncService.js';
// Official Python Editor controller protocol: python.microbit.org/src/fs/host.ts.
// The editor sends changes after a one-second debounce; it has no flush API.
export const MICROBIT_EDITOR_ORIGIN = 'https://python.microbit.org';
export const MICROBIT_EDITOR_STORAGE_PREFIX = 'strobot.microbit.editor.v1.';
const LESSON_IDS = new Set(['matrix', 'buttons', 'light', 'counter', 'radio', 'project']);
const MAX_FILE_BYTES = 256 * 1024;
const MAX_PROJECT_BYTES = 512 * 1024;
const MAX_RECORD_LENGTH = 750000;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const isRecord = value => value !== null && typeof value === 'object'
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function encodeSource(source) {
    const bytes = encoder.encode(source);
    if (bytes.length > MAX_FILE_BYTES) throw new Error('Mã Python vượt quá dung lượng của bài học.');
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function decodeFile(encoded) {
    if (typeof encoded !== 'string' || encoded.length > Math.ceil(MAX_FILE_BYTES / 3) * 4
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
        throw new Error('Tệp trong dự án có định dạng không hợp lệ.');
    }
    const binary = atob(encoded);
    if (binary.length > MAX_FILE_BYTES || btoa(binary) !== encoded) throw new Error('Tệp trong dự án vượt giới hạn hoặc bị lỗi.');
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

// Only the documented files/projectName fields cross into storage or the iframe.
export function normalizeMicrobitProject(project) {
    if (!isRecord(project) || !isRecord(project.files)) throw new Error('Dự án Python không hợp lệ.');
    const names = Object.keys(project.files);
    if (names.length < 1 || names.length > 16 || !Object.hasOwn(project.files, 'main.py')) {
        throw new Error('Dự án cần có main.py và tối đa 16 tệp.');
    }
    const files = Object.create(null);
    let total = 0;
    for (const name of names) {
        if (!name || name.length > 80 || name.includes('..') || /[\/\\\u0000-\u001f\u007f]/.test(name)
            || ['.', '__proto__', 'prototype', 'constructor'].includes(name)) {
            throw new Error('Tên tệp trong dự án không hợp lệ.');
        }
        const bytes = decodeFile(project.files[name]);
        total += bytes.length;
        if (total > MAX_PROJECT_BYTES) throw new Error('Dự án vượt quá dung lượng của bài học.');
        if (name === 'main.py') decoder.decode(bytes);
        files[name] = project.files[name];
    }
    const result = { files };
    // The official getPythonProject() includes projectName: undefined for unnamed projects.
    if (Object.hasOwn(project, 'projectName') && project.projectName !== undefined) {
        if (typeof project.projectName !== 'string' || project.projectName.length > 80
            || /[\u0000-\u001f\u007f]/.test(project.projectName)) throw new Error('Tên dự án không hợp lệ.');
        result.projectName = project.projectName;
    }
    return result;
}

export class MicrobitEditorBridge {
    constructor(options = {}) {
        this._window = options.window ?? globalThis.window;
        try { this._storage = Object.hasOwn(options, 'storage') ? options.storage : getLearnerStorage(); }
        catch { this._storage = null; }
        this._listener = event => this._receive(event);
        this._frame = null;
        this._project = null;
    }

    attach(frame, { courseId, lessonId, code, title = '', onStatus = () => {} }) {
        if (courseId !== 'microbit' || !LESSON_IDS.has(lessonId)) throw new Error('Bài học micro:bit không hợp lệ.');
        if (typeof code !== 'string') throw new TypeError('Mã mẫu Python cần là chuỗi văn bản.');
        if (!frame?.contentWindow || !this._window?.addEventListener) throw new Error('Cần gắn iframe vào trang trước khi kết nối.');
        const starter = normalizeMicrobitProject({ files: { 'main.py': encodeSource(code) }, projectName: String(title).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 80) });
        this.destroy();
        this._frame = frame;
        this._key = `${MICROBIT_EDITOR_STORAGE_PREFIX}${lessonId}`;
        this._lessonId = lessonId;
        this._onStatus = onStatus;
        this._starterCode = code;
        this._initialProject = starter;
        this._project = null;
        this._savedProject = null;
        this._synced = false;
        this._ready = false;
        this._corrupt = false;
        this._storageFailed = false;
        this._readFailed = false;
        this._readSavedProject();
        this._window.addEventListener('message', this._listener);
        this._status('Đang mở trình soạn thảo Python…', 'loading');
        this._loadingTimer = setTimeout(() => {
            if (this._frame && !this._ready) this._status('Trình soạn thảo đang tải lâu hơn dự kiến. Kiểm tra kết nối rồi dùng “Tải lại khung” để thử lại.', 'connection-error');
        }, 30000);
        this._loadingTimer.unref?.();
        return this;
    }

    _readSavedProject() {
        let raw;
        try {
            if (!this._storage) throw new Error('Storage unavailable');
            raw = this._storage.getItem(this._key);
        } catch { this._storageFailed = true; this._readFailed = true; return; }
        if (raw === null) return;
        try {
            if (typeof raw !== 'string' || raw.length > MAX_RECORD_LENGTH) throw new Error('Invalid record');
            const record = JSON.parse(raw);
            if (!isRecord(record) || record.version !== 1 || record.courseId !== 'microbit'
                || record.lessonId !== this._lessonId || !Number.isSafeInteger(record.savedAt) || record.savedAt < 0) throw new Error('Invalid record');
            this._savedProject = normalizeMicrobitProject(record.project);
            this._initialProject = this._savedProject;
        } catch { this._corrupt = true; }
    }

    _receive(event) {
        if (!this._frame || this._frame.isConnected === false || event.origin !== MICROBIT_EDITOR_ORIGIN
            || event.source !== this._frame.contentWindow) return;
        const data = event.data;
        if (!isRecord(data) || data.type !== 'pyeditor') return;
        if (data.action === 'workspacesync') {
            // Re-sending after startup causes an unsupported action in the editor.
            if (this._synced) return;
            try {
                this._frame.contentWindow.postMessage({ type: 'pyeditor', action: 'workspacesync', projects: [this._savedProject ?? this._starterCode] }, MICROBIT_EDITOR_ORIGIN);
                this._synced = true;
            } catch { this._status('Kết nối trình soạn thảo bị gián đoạn. Hãy mở lại phòng lab.', 'connection-error'); }
            return;
        }
        if (!this._synced) return;
        if (data.action === 'workspaceloaded') {
            if (this._ready) return;
            this._ready = true;
            clearTimeout(this._loadingTimer);
            this._project = this._initialProject;
            this._reportReady();
            return;
        }
        if (data.action !== 'workspacesave' || !this._ready) return;
        let project;
        try { project = normalizeMicrobitProject(data.project); }
        catch { this._status('Dự án gửi về có tệp không hợp lệ. Hãy tải dự án từ trình soạn thảo để giữ bài làm.', 'invalid-project'); return; }
        this._project = project;
        // Keep damaged records available for recovery until the learner explicitly resets.
        if (this._corrupt || this._readFailed) { this._reportReady(); return; }
        try {
            if (!this._storage) throw new Error('Storage unavailable');
            this._storage.setItem(this._key, JSON.stringify({ version: 1, courseId: 'microbit', lessonId: this._lessonId, savedAt: Date.now(), project }));
            this._storageFailed = false;
            this._status('Đã lưu bài trên trình duyệt này. Hãy chờ thông báo này sau mỗi lần sửa trước khi chuyển bài.', 'saved');
        } catch {
            this._storageFailed = true;
            this._reportReady();
        }
    }

    _reportReady() {
        if (this._corrupt) {
            this._status('Bản lưu cũ cần kiểm tra và đang được giữ nguyên. Bạn có thể sửa mã mẫu; hãy tải mã trước khi rời bài hoặc khôi phục mã mẫu để tạo bản lưu mới.', 'corrupt');
        } else if (this._storageFailed) {
            this._status('Trình duyệt chưa lưu được bài. Bạn vẫn có thể lập trình; hãy tải mã trước khi rời bài.', 'storage-error');
        } else {
            this._status('Sẵn sàng chỉnh sửa và chạy Python. Sau khi sửa, chờ thông báo “Đã lưu bài” trước khi chuyển bài.', 'ready');
        }
    }

    _status(message, state) {
        if (typeof this._onStatus === 'function') this._onStatus(message, state);
    }

    // This is the most recently received source, not a synchronous flush of the editor.
    getSource() {
        return this._project ? decoder.decode(decodeFile(this._project.files['main.py'])) : null;
    }

    // Caller must confirm this destructive action, then recreate the iframe on success.
    // Destroying the bridge prevents late saves from restoring the removed project.
    clearSavedProject() {
        if (!this._frame) return false;
        try {
            if (!this._storage) throw new Error('Storage unavailable');
            this._storage.removeItem(this._key);
        } catch {
            this._status('Trình duyệt chưa xóa được bản lưu. Hãy tải mã và thử lại trước khi khôi phục mã mẫu.', 'storage-error');
            return false;
        }
        this.destroy();
        return true;
    }

    destroy() {
        clearTimeout(this._loadingTimer);
        if (this._frame) this._window.removeEventListener('message', this._listener);
        this._frame = null;
        this._ready = false;
    }
}
