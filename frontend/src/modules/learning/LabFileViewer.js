const TEXT_PREVIEW_BYTES = 512 * 1024;
const MAX_LOADED_BYTES = 64 * 1024 * 1024;
let viewerId = 0;

const formatSize = bytes => {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    return bytes < 1024 * 1024
        ? `${(bytes / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} KiB`
        : `${(bytes / (1024 * 1024)).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} MiB`;
};
const startsWith = (bytes, signature) => signature.every((byte, index) => bytes[index] === byte);

/** Only sniff raster formats. A renamed SVG/HTML file never becomes an image document. */
export function labImageType(bytes) {
    if (!(bytes instanceof Uint8Array)) return null;
    if (startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
    if (startsWith(bytes, [255, 216, 255])) return 'image/jpeg';
    if (startsWith(bytes, [71, 73, 70, 56, 55, 97]) || startsWith(bytes, [71, 73, 70, 56, 57, 97])) return 'image/gif';
    if (bytes.length >= 12 && startsWith(bytes, [82, 73, 70, 70])
        && startsWith(bytes.subarray(8), [87, 69, 66, 80])) return 'image/webp';
    if (bytes.length >= 26 && startsWith(bytes, [66, 77])) return 'image/bmp';
    return null;
}

/** A viewer holds only the selected file in memory, never a persistent account cache. */
export class LabFileViewer {
    constructor(host = document.body) {
        this.host = host;
        this.document = host.ownerDocument;
        this.generation = 0;
        this.selection = 0;
        this.urls = new Set();
        this.downloadTimers = new Set();
        this.files = [];
        this.bytes = null;
        this.build();
    }
    element(tag, text, className) {
        const node = this.document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (className) node.className = className;
        return node;
    }
    build() {
        const id = `lab-file-viewer-${++viewerId}`;
        this.dialog = this.element('dialog', undefined, 'lab-file-viewer');
        this.dialog.dataset.labFileViewer = '';
        this.dialog.setAttribute('aria-labelledby', id);
        const header = this.element('header', undefined, 'lab-file-viewer-head');
        const title = this.element('h2', 'Bài thực hành đã lưu'); title.id = id;
        this.closeButton = this.element('button', 'Đóng'); this.closeButton.type = 'button';
        this.closeButton.setAttribute('aria-label', 'Đóng danh sách tệp đã lưu');
        header.append(title, this.closeButton);
        this.status = this.element('p', '', 'small lab-file-viewer-status');
        this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
        const body = this.element('div', undefined, 'lab-file-viewer-body');
        this.list = this.element('ul', undefined, 'lab-file-viewer-list');
        this.list.setAttribute('aria-label', 'Chọn tệp đã lưu');
        const content = this.element('section', undefined, 'lab-file-viewer-content');
        this.name = this.element('h3', 'Chọn một tệp để xem'); this.name.tabIndex = -1;
        this.preview = this.element('div', undefined, 'lab-file-viewer-preview');
        this.preview.setAttribute('aria-label', 'Nội dung tệp đã chọn');
        const actions = this.element('div', undefined, 'lab-actions');
        this.downloadButton = this.element('button', 'Tải tệp', 'btn--primary'); this.downloadButton.type = 'button';
        this.downloadButton.disabled = true;
        this.retryButton = this.element('button', 'Thử mở lại'); this.retryButton.type = 'button'; this.retryButton.hidden = true;
        actions.append(this.downloadButton, this.retryButton); content.append(this.name, this.preview, actions);
        this.savedRecord = this.element('details', undefined, 'lab-file-viewer-record');
        this.savedRecord.append(this.element('summary', 'Ghi chú và bản mã đã lưu'));
        this.recordBody = this.element('div'); this.savedRecord.append(this.recordBody); this.savedRecord.hidden = true;
        body.append(this.list, content); this.dialog.append(header, this.status, this.savedRecord, body); this.host.append(this.dialog);
        this.closeButton.addEventListener('click', () => this.close());
        this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
        this.dialog.addEventListener('close', () => { if (!this.dialog.open) this.clear(); });
        this.downloadButton.addEventListener('click', () => this.download());
        this.retryButton.addEventListener('click', () => void this.select(this.selectedIndex));
    }
    /** files are metadata only; getBytes is called for the explicitly selected file. */
    open({ files = [], getBytes, isCurrent = () => true, notes, code, sourceName, projectUrl, savedAt } = {}) {
        this.clear();
        if (!Array.isArray(files) || (files.length && typeof getBytes !== 'function')) throw new TypeError('Cần danh sách tệp và cách tải nội dung.');
        this.getBytes = getBytes; this.isCurrent = isCurrent;
        if (!this.current()) { this.close(); return; }
        this.files = files.map(file => ({ ...file }));
        this.renderRecord({ notes, code, sourceName, projectUrl, savedAt });
        this.selectedIndex = -1;
        this.list.replaceChildren(...this.files.map((file, index) => {
            const item = this.element('li');
            const button = this.element('button', undefined, 'lab-file-viewer-choice'); button.type = 'button';
            button.setAttribute('aria-pressed', 'false');
            button.append(this.element('span', String(file.name || 'Tệp không có tên')), this.element('small', formatSize(file.sizeBytes)));
            button.addEventListener('click', () => void this.select(index)); item.append(button); return item;
        }));
        this.name.textContent = this.files.length ? 'Chọn một tệp để xem' : 'Chưa có tệp đã lưu';
        this.status.textContent = this.files.length ? `${this.files.length} tệp. Chọn tệp trong danh sách để xem lại hoặc tải xuống.` : 'Chưa có tệp đính kèm.';
        if (!this.dialog.open) this.dialog.showModal();
        (this.list.querySelector('button') || this.closeButton).focus();
    }
    renderRecord({ notes, code, sourceName, projectUrl, savedAt }) {
        this.recordBody.replaceChildren(); this.savedRecord.open = false;
        const date = new Date(savedAt);
        if (savedAt && Number.isFinite(date.getTime())) this.recordBody.append(this.element('p', 'Lưu lúc: ' + date.toLocaleString('vi-VN'), 'small'));
        if (typeof notes === 'string' && notes) this.recordBody.append(this.element('h3', 'Ghi chú đã lưu'), this.element('p', notes, 'lab-file-viewer-notes'));
        if (typeof code === 'string' && code) this.recordBody.append(this.element('h3', typeof sourceName === 'string' && sourceName ? 'Bản mã: ' + sourceName : 'Bản mã đã lưu'), this.element('pre', code));
        if (typeof projectUrl === 'string' && projectUrl) {
            let url;
            try { url = new URL(projectUrl); } catch { /* Invalid legacy URLs are never clickable. */ }
            if (url?.protocol === 'https:' && url.hostname && !url.username && !url.password) {
                const link = this.element('a', 'Mở dự án đã lưu ↗'); link.href = url.href;
                link.target = '_blank'; link.rel = 'noopener noreferrer'; this.recordBody.append(link);
            }
        }
        this.savedRecord.hidden = this.recordBody.childElementCount === 0;
        if (!this.files.length && !this.savedRecord.hidden) this.savedRecord.open = true;
    }
    current() {
        try { return this.isCurrent?.() === true; } catch { return false; }
    }
    valid(generation, selection) {
        if (generation !== this.generation || selection !== this.selection || !this.dialog.open) return false;
        if (!this.current()) { this.close(); return false; }
        return true;
    }
    releasePreview() {
        this.loadController?.abort(); this.loadController = null;
        this.preview.replaceChildren();
        this.bytes = null;
        if (this.previewUrl) { URL.revokeObjectURL(this.previewUrl); this.urls.delete(this.previewUrl); this.previewUrl = null; }
    }
    async select(index) {
        if (!this.current()) { this.close(); return; }
        const file = this.files[index]; if (!file || !this.dialog.open) return;
        const generation = this.generation, selection = ++this.selection;
        this.selectedIndex = index; this.releasePreview();
        this.name.textContent = String(file.name || 'Tệp không có tên');
        this.downloadButton.disabled = true; this.retryButton.hidden = true;
        this.list.querySelectorAll('button').forEach((button, itemIndex) => button.setAttribute('aria-pressed', String(itemIndex === index)));
        this.status.textContent = 'Đang mở tệp…';
        const controller = new AbortController(); this.loadController = controller;
        try {
            const loaded = await this.getBytes(file, { signal: controller.signal });
            if (!this.valid(generation, selection)) return;
            const bytes = loaded instanceof Uint8Array ? loaded : loaded instanceof ArrayBuffer ? new Uint8Array(loaded) : null;
            if (!bytes || bytes.byteLength > MAX_LOADED_BYTES) throw new Error('Không đọc được nội dung tệp.');
            this.bytes = bytes;
            this.renderPreview(file, bytes);
            this.downloadButton.disabled = false;
            this.status.textContent = `${String(file.name || 'Tệp đã chọn')} · ${formatSize(bytes.length)}`;
        } catch {
            if (!this.valid(generation, selection)) return;
            this.status.textContent = 'Chưa mở được tệp. Kiểm tra kết nối rồi thử lại.';
            this.retryButton.hidden = false;
        } finally {
            if (this.loadController === controller) this.loadController = null;
        }
    }
    blobUrl(bytes, type) {
        const url = URL.createObjectURL(new Blob([bytes], { type }));
        this.urls.add(url); return url;
    }
    renderPreview(file, bytes) {
        const imageType = labImageType(bytes);
        if (imageType) {
            const image = this.element('img'); image.alt = String(file.name || 'Ảnh bài thực hành');
            this.previewUrl = this.blobUrl(bytes, imageType); image.src = this.previewUrl;
            image.addEventListener('error', () => {
                if (this.preview.contains(image)) this.preview.replaceChildren(this.element('p', 'Trình duyệt chưa đọc được ảnh này. Bạn có thể tải tệp để mở trên máy.'));
            }, { once: true });
            this.preview.append(image); return;
        }
        if (startsWith(bytes, [37, 80, 68, 70, 45])) {
            const iframe = this.element('iframe'); iframe.title = `Xem PDF: ${String(file.name || 'Bài thực hành')}`;
            iframe.setAttribute('sandbox', ''); iframe.setAttribute('referrerpolicy', 'no-referrer');
            this.previewUrl = this.blobUrl(bytes, 'application/pdf'); iframe.src = this.previewUrl;
            this.preview.append(iframe, this.element('p', 'Nếu trình duyệt không hiện PDF, dùng Tải tệp để mở trên máy.', 'small')); return;
        }
        if (bytes.byteLength <= TEXT_PREVIEW_BYTES) {
            let text;
            try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* Native binary formats remain downloadable. */ }
            if (text !== undefined && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
                this.preview.append(this.element('pre', text || '(Tệp trống)')); return;
            }
        }
        this.preview.append(this.element('p', 'Tệp này được giữ nguyên định dạng. Chọn Tải tệp để mở bằng ứng dụng phù hợp trên máy.'));
    }
    download() {
        if (!this.current()) { this.close(); return; }
        const file = this.files[this.selectedIndex];
        if (!file || !this.bytes || !this.dialog.open) return;
        const url = this.blobUrl(this.bytes, 'application/octet-stream');
        const link = this.element('a'); link.href = url; link.download = String(file.name || 'bai-thuc-hanh'); link.click();
        const timer = setTimeout(() => { URL.revokeObjectURL(url); this.urls.delete(url); this.downloadTimers.delete(timer); }, 30000);
        this.downloadTimers.add(timer);
    }
    clear() {
        this.generation++; this.selection++;
        this.releasePreview();
        for (const timer of this.downloadTimers) clearTimeout(timer);
        this.downloadTimers.clear();
        for (const url of this.urls) URL.revokeObjectURL(url);
        this.urls.clear(); this.files = []; this.selectedIndex = -1; this.getBytes = null; this.isCurrent = null;
        this.list.replaceChildren(); this.name.textContent = ''; this.status.textContent = '';
        this.recordBody.replaceChildren(); this.savedRecord.hidden = true; this.savedRecord.open = false;
        this.downloadButton.disabled = true; this.retryButton.hidden = true;
    }
    close() { this.clear(); if (this.dialog.open) this.dialog.close(); }
    destroy() { this.close(); this.dialog.remove(); }
}
