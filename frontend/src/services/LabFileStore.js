import { accountService } from './AccountService.js';

// File bytes travel only through the authenticated file API. They never become
// part of localStorage or the learner snapshot loaded by ordinary page changes.
export const LAB_ATTACHMENT_LIMITS = Object.freeze({
    fileBytes: 25 * 1024 * 1024,
    accountBytes: 250 * 1024 * 1024,
    filesPerLab: 50,
    filesPerAccount: 500,
    chunkBytes: 1024 * 1024,
});

const uuid = value => typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (message, code = 'LAB_FILE_INVALID') => Object.assign(new Error(message), { code });
const aborted = () => failure('Đã dừng thao tác với tệp.', 'REQUEST_ABORTED');
const safeName = name => typeof name === 'string' && name.length > 0 && name.length <= 180
    && name.trim() === name && !/[\/\\\u0000-\u001f\u007f]/.test(name)
    && !['.', '..', '__proto__', 'prototype', 'constructor'].includes(name);

export function validateLabAttachment(file, limits = LAB_ATTACHMENT_LIMITS) {
    if (!file || !safeName(file.name) || !Number.isSafeInteger(file.size) || file.size < 0
        || typeof file.slice !== 'function') throw failure('Chọn tệp có tên hợp lệ, tối đa 180 ký tự.');
    if (file.size > limits.fileBytes) throw failure('Mỗi tệp được lưu tối đa 25 MB.', 'LAB_FILE_TOO_LARGE');
    return file;
}

function encode(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(binary);
}

function decode(value, expectedBytes) {
    if (typeof value !== 'string' || value.length !== Math.ceil(expectedBytes / 3) * 4
        || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
        throw failure('Tệp tải về chưa đầy đủ. Hãy thử lại.', 'LAB_FILE_RESPONSE_INVALID');
    let binary;
    try { binary = atob(value); } catch { throw failure('Tệp tải về không hợp lệ.', 'LAB_FILE_RESPONSE_INVALID'); }
    if (binary.length !== expectedBytes || btoa(binary) !== value)
        throw failure('Tệp tải về không hợp lệ.', 'LAB_FILE_RESPONSE_INVALID');
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function metadata(value) {
    if (!plain(value) || !uuid(value.id) || !safeName(value.name)
        || !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 0
        || value.sizeBytes > LAB_ATTACHMENT_LIMITS.fileBytes)
        throw failure('Thông tin tệp từ máy chủ chưa hợp lệ.', 'LAB_FILE_RESPONSE_INVALID');
    return { id: value.id, name: value.name, sizeBytes: value.sizeBytes,
        ...(typeof value.createdAt === 'string' ? { createdAt: value.createdAt } : {}),
        ...(typeof value.mimeType === 'string' && value.mimeType.length <= 150 ? { mimeType: value.mimeType } : {}) };
}

function scope(value) {
    if (!plain(value) || typeof value.ownerId !== 'string' || !value.ownerId
        || !['courseId', 'lessonId', 'platformKey'].every(key => typeof value[key] === 'string'
            && /^[a-z0-9-]{1,40}$/.test(value[key])))
        throw failure('Mở đúng bài và đăng nhập trước khi lưu tệp.', 'LAB_FILE_SCOPE_INVALID');
    return Object.fromEntries(['ownerId', 'courseId', 'lessonId', 'platformKey'].map(key => [key, value[key]]));
}

function progress(callback, loaded, total) {
    try { callback?.({ loaded, total }); } catch { /* Display callbacks cannot change a completed upload. */ }
}

async function chunks(count, task, controller) {
    let next = 0, firstError;
    const worker = async () => {
        while (next < count && !controller.signal.aborted) {
            const index = next++;
            try { await task(index); }
            catch (error) { firstError ||= error; controller.abort(); return; }
        }
    };
    // Drain both workers before cleanup, including the request already in flight.
    await Promise.allSettled(Array.from({ length: Math.min(2, count) }, worker));
    if (firstError) throw firstError;
    if (controller.signal.aborted) throw aborted();
}

export class LabFileStore {
    constructor({ account = accountService } = {}) { this.account = account; }

    check(context, signal) {
        if (signal?.aborted) throw aborted();
        if (!context.ownerId || this.account.user?.id !== context.ownerId)
            throw failure('Phiên đăng nhập đã thay đổi. Mở lại bài của tài khoản đang dùng.', 'SESSION_CHANGED');
    }

    async call(context, path, options = {}, signal) {
        this.check(context, signal);
        const result = await this.account.request(path, { ...options, signal, timeoutMs: 60000 });
        this.check(context, signal);
        return result;
    }

    async list(context, { signal } = {}) {
        const current = scope(context);
        const query = new URLSearchParams(Object.fromEntries(['courseId', 'lessonId', 'platformKey'].map(key => [key, current[key]])));
        const result = await this.call(current, '/v1/lab-files?' + query, {}, signal);
        if (!plain(result) || !Array.isArray(result.files) || result.files.length > LAB_ATTACHMENT_LIMITS.filesPerLab)
            throw failure('Danh sách tệp từ máy chủ chưa hợp lệ.', 'LAB_FILE_RESPONSE_INVALID');
        const files = result.files.map(metadata);
        if (new Set(files.map(file => file.id)).size !== files.length)
            throw failure('Danh sách tệp bị trùng. Hãy tải lại.', 'LAB_FILE_RESPONSE_INVALID');
        const limits = { ...LAB_ATTACHMENT_LIMITS };
        for (const key of Object.keys(limits)) {
            const number = result.limits?.[key];
            if (number !== undefined && (!Number.isSafeInteger(number) || number < 1 || number > limits[key]))
                throw failure('Giới hạn lưu tệp từ máy chủ chưa hợp lệ.', 'LAB_FILE_RESPONSE_INVALID');
            if (number !== undefined) limits[key] = number;
        }
        if (limits.chunkBytes !== LAB_ATTACHMENT_LIMITS.chunkBytes)
            throw failure('Phiên bản lưu tệp chưa tương thích. Hãy tải lại trang.', 'LAB_FILE_RESPONSE_INVALID');
        const usage = {};
        for (const key of ['usedBytes', 'reservedBytes']) {
            const number = result.usage?.[key] ?? 0;
            if (!Number.isSafeInteger(number) || number < 0 || number > limits.accountBytes)
                throw failure('Dung lượng tài khoản từ máy chủ chưa hợp lệ.', 'LAB_FILE_RESPONSE_INVALID');
            usage[key] = number;
        }
        return { files, limits, usage };
    }

    async upload(context, file, { signal, onProgress } = {}) {
        const current = scope(context);
        this.check(current, signal);
        validateLabAttachment(file);
        const controller = new AbortController(), abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        let id;
        try {
            const clientUploadId = globalThis.crypto?.randomUUID?.();
            if (!uuid(clientUploadId)) throw failure('Trình duyệt chưa hỗ trợ lưu tệp an toàn. Hãy cập nhật trình duyệt.');
            const initialized = await this.call(current, '/v1/lab-files/uploads', { method: 'POST', body: {
                courseId: current.courseId, lessonId: current.lessonId, platformKey: current.platformKey,
                name: file.name, sizeBytes: file.size, clientUploadId,
            } }, controller.signal);
            if (!uuid(initialized?.id)) throw failure('Máy chủ chưa tạo được bản lưu tệp.', 'LAB_FILE_RESPONSE_INVALID');
            id = initialized.id;
            const chunkBytes = LAB_ATTACHMENT_LIMITS.chunkBytes, count = Math.ceil(file.size / chunkBytes);
            if (initialized.chunkBytes !== chunkBytes || initialized.chunkCount !== count)
                throw failure('Phiên bản lưu tệp chưa tương thích. Hãy tải lại trang.', 'LAB_FILE_RESPONSE_INVALID');
            let loaded = 0;
            progress(onProgress, 0, file.size);
            await chunks(count, async index => {
                this.check(current, controller.signal);
                const start = index * chunkBytes, end = Math.min(file.size, start + chunkBytes);
                const part = new Uint8Array(await file.slice(start, end).arrayBuffer());
                this.check(current, controller.signal);
                if (part.byteLength !== end - start) throw failure('Chưa đọc đủ dữ liệu tệp. Hãy chọn lại tệp.');
                await this.call(current, `/v1/lab-files/${id}/chunks/${index}`, {
                    method: 'PUT', body: { dataBase64: encode(part) },
                }, controller.signal);
                loaded += part.byteLength;
                progress(onProgress, loaded, file.size);
            }, controller);
            const result = metadata(await this.call(current, `/v1/lab-files/${id}/complete`, { method: 'POST' }, controller.signal));
            if (result.id !== id || result.name !== file.name || result.sizeBytes !== file.size)
                throw failure('Thông tin tệp vừa lưu không khớp. Hãy tải lại danh sách.', 'LAB_FILE_RESPONSE_INVALID');
            progress(onProgress, file.size, file.size);
            return result;
        } catch (error) {
            controller.abort();
            // Cancellation may leave a reservation, but never sends old-account
            // cleanup with a new account token. The server also expires uploads.
            if (id && this.account.user?.id === current.ownerId) {
                try { await this.call(current, `/v1/lab-files/${id}`, { method: 'DELETE' }); } catch { /* Server expiry is the final cleanup. */ }
            }
            throw error;
        } finally { signal?.removeEventListener('abort', abort); }
    }

    async download(context, file, { signal, onProgress } = {}) {
        const current = scope(context), selected = metadata(file);
        this.check(current, signal);
        const controller = new AbortController(), abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        try {
            const result = new Uint8Array(selected.sizeBytes), chunkBytes = LAB_ATTACHMENT_LIMITS.chunkBytes;
            let loaded = 0;
            progress(onProgress, loaded, selected.sizeBytes);
            await chunks(Math.ceil(selected.sizeBytes / chunkBytes), async index => {
                const data = await this.call(current, `/v1/lab-files/${selected.id}/chunks/${index}`, {}, controller.signal);
                if (!plain(data) || data.index !== index)
                    throw failure('Thứ tự dữ liệu tệp chưa hợp lệ. Hãy thử lại.', 'LAB_FILE_RESPONSE_INVALID');
                const expected = Math.min(chunkBytes, selected.sizeBytes - index * chunkBytes);
                const bytes = decode(data.dataBase64, expected);
                this.check(current, controller.signal);
                result.set(bytes, index * chunkBytes); loaded += bytes.length;
                progress(onProgress, loaded, selected.sizeBytes);
            }, controller);
            this.check(current, signal);
            return result;
        } finally { controller.abort(); signal?.removeEventListener('abort', abort); }
    }

    async remove(context, id, { signal } = {}) {
        const current = scope(context);
        if (!uuid(id)) throw failure('Tệp đã chọn không hợp lệ.');
        return this.call(current, `/v1/lab-files/${id}`, { method: 'DELETE' }, signal);
    }
}
