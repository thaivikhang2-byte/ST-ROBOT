import { accountService } from './AccountService.js';

// Guest records retain their original keys. An authenticated workspace is one
// atomic, account-specific envelope; a failed write cannot advance its revision.
export const LEARNER_WORKSPACE_PREFIX = 'strobot.account.workspace.v1.';
export const LEARNER_KEYS = Object.freeze([
    'strobot.original.course.v3', 'strobot.quiz.history.v1', 'strobot.review.evidence.v1',
    'strobot.learning.level.v1',
    ...['matrix', 'buttons', 'light', 'counter', 'radio', 'project'].map(id => `strobot.microbit.editor.v1.${id}`)
]);
const KEY_SET = new Set(LEARNER_KEYS);
// Preserve an assessment section already owned by this account on the server,
// while never reading/importing the shared browser assessment storage key.
const REMOTE_KEY_SET = new Set([...LEARNER_KEYS, 'strobot.assessment.v1']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const empty = () => ({ version: 1, revision: 0, values: {}, dirty: false, conflict: false, updatedAt: null });
const nativeStorage = () => { try { return globalThis.window?.localStorage ?? null; } catch { return null; } };
const sameValues = (left, right) => {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key => right[key] === left[key]);
};
const COURSE_KEY = 'strobot.original.course.v3';
const ABSENT = Symbol('absent');
const equalTree = (left, right) => {
    if (left === right) return true;
    if (Array.isArray(left) && Array.isArray(right))
        return left.length === right.length && left.every((item, index) => equalTree(item, right[index]));
    if (!plain(left) || !plain(right)) return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length
        && keys.every(key => Object.hasOwn(right, key) && equalTree(left[key], right[key]));
};
function mergeCourseEdit(baseline, edit, latest) {
    const parse = raw => raw === null ? ABSENT : JSON.parse(raw);
    const merge = (base, local, remote, path = []) => {
        if (equalTree(local, base)) return remote;
        if (equalTree(remote, base) || equalTree(local, remote)) return local;
        // Resume location is a preference, not a journal field. The latest
        // deliberate navigation may replace it without blocking other lessons.
        if (path.length === 1 && path[0] === 'last') return local;
        if (plain(local) && plain(remote) && (base === ABSENT || plain(base))) {
            const result = Object.create(null);
            for (const key of new Set([...Object.keys(local), ...Object.keys(remote), ...(base === ABSENT ? [] : Object.keys(base))])) {
                if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsafe course record');
                const value = merge(base !== ABSENT && Object.hasOwn(base, key) ? base[key] : ABSENT,
                    Object.hasOwn(local, key) ? local[key] : ABSENT,
                    Object.hasOwn(remote, key) ? remote[key] : ABSENT, [...path, key]);
                if (value !== ABSENT) result[key] = value;
            }
            return result;
        }
        throw new Error('Overlapping course edit');
    };
    return JSON.stringify(merge(parse(baseline), parse(edit), parse(latest)));
}
function cleanValues(values) {
    if (!plain(values)) throw new Error('Dữ liệu đồng bộ không hợp lệ.');
    const result = {};
    for (const [key, value] of Object.entries(values)) {
        if (!REMOTE_KEY_SET.has(key) || typeof value !== 'string') throw new Error('Dữ liệu đồng bộ chứa mục không được hỗ trợ.');
        result[key] = value;
    }
    return result;
}
function validOwner(user) {
    return typeof user?.id === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(user.id) ? user.id : null;
}
function verified(user) { return user?.isEmailVerified === true || user?.is_email_verified === true; }

export class LearnerSyncService {
    constructor({ account = accountService, storage = nativeStorage(), events = globalThis.document,
        window = globalThis.window, debounceMs = 900, retryMs = 30000 } = {}) {
        this.account = account;
        this.storage = storage;
        this.events = events;
        this.window = window;
        this.debounceMs = debounceMs;
        this.retryMs = retryMs;
        this.user = null;
        this.ownerId = null;
        this.epoch = 0;
        this._tabDrafts = new Map();
        this.status = { status: 'guest', message: 'Tiến độ đang lưu trên trình duyệt. Đăng nhập để đồng bộ theo tài khoản.', canImport: false, conflict: false };
        this._unsubscribe = this.account.subscribe?.(user => {
            if (!this._started) return;
            // Refreshing the same user's confirmed profile must not create a
            // second writer while an offline-queued PUT is resuming.
            if (validOwner(user) === this.ownerId) {
                const newlyVerified = verified(user) && !verified(this.user);
                this.user = user;
                if (newlyVerified) void this.sync();
                return;
            }
            void this._activate(user);
        });
        this._online = () => { void this.sync(); };
        this.window?.addEventListener?.('online', this._online);
        this._actions = {
            'strobot:sync-now': () => { void this.sync(); },
            'strobot:sync-import-local': () => { void this.importGuest(); },
            'strobot:sync-export': () => this.downloadDraft(),
            'strobot:sync-use-server': () => { void this.useServerCopy(); },
            'strobot:sync-keep-local': () => { void this.keepLocalCopy(); }
        };
        for (const [name, action] of Object.entries(this._actions)) this.events?.addEventListener?.(name, action);
    }
    ready() {
        if (!this._readyPromise) this._readyPromise = (async () => {
            const user = await this.account.ready();
            this._started = true;
            await this._activate(user);
            return this.ownerId;
        })();
        return this._readyPromise;
    }
    _emit(name, detail) {
        if (this.events?.dispatchEvent && typeof globalThis.CustomEvent === 'function')
            this.events.dispatchEvent(new CustomEvent(name, { detail }));
    }
    _status(status, message, extras = {}) {
        if (this.hasTabDrafts()) {
            status = 'tab-conflict';
            message = 'Có mục được sửa đồng thời ở tab khác. Bản nháp của tab này chưa ghi đè dữ liệu; hãy tải hồ sơ hoặc chọn dùng bản đang lưu trong bài học.';
            extras = { ...extras, tabConflict: true };
        }
        this.status = { status, message, canImport: Boolean(this.ownerId && this.guestValuesCount()),
            conflict: status === 'conflict', ...extras };
        this._emit('strobot:sync-status', this.status);
    }
    _key(ownerId) { return `${LEARNER_WORKSPACE_PREFIX}${ownerId}`; }
    _read(ownerId) {
        const raw = this.storage?.getItem(this._key(ownerId));
        if (!raw) return empty();
        let value;
        try { value = JSON.parse(raw); }
        catch { throw Object.assign(new Error('Bản lưu tài khoản trên thiết bị bị lỗi.'), { code: 'LOCAL_DATA_CORRUPT' }); }
        if (!plain(value) || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0)
            throw Object.assign(new Error('Bản lưu tài khoản trên thiết bị bị lỗi. Hãy tải bản sao trước khi khôi phục.'), { code: 'LOCAL_DATA_CORRUPT' });
        try {
            return { version: 1, revision: value.revision, values: cleanValues(value.values), dirty: value.dirty === true,
                conflict: value.conflict === true, updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null };
        } catch { throw Object.assign(new Error('Bản lưu tài khoản trên thiết bị bị lỗi.'), { code: 'LOCAL_DATA_CORRUPT' }); }
    }
    _write(ownerId, bundle) {
        if (!this.storage) throw new Error('Trình duyệt không cho phép lưu dữ liệu.');
        this.storage.setItem(this._key(ownerId), JSON.stringify(bundle));
    }
    _draftKey(ownerId) { return ownerId || '@guest'; }
    hasTabDrafts(ownerId = this.ownerId) { return !!this._tabDrafts.get(this._draftKey(ownerId))?.size; }
    _rememberTabDraft(ownerId, key, value) {
        const owner = this._draftKey(ownerId);
        if (!this._tabDrafts.has(owner)) this._tabDrafts.set(owner, new Map());
        this._tabDrafts.get(owner).set(key, value);
        if (ownerId === this.ownerId) this._status('tab-conflict', '');
    }
    discardTabDraft(key, expectedOwnerId = this.ownerId) {
        if (expectedOwnerId !== this.ownerId) return;
        this._tabDrafts.get(this._draftKey(expectedOwnerId))?.delete(key);
        if (!this.hasTabDrafts()) this._status(this.ownerId ? 'pending' : 'guest',
            this.ownerId ? 'Đã bỏ bản nháp của tab này theo lựa chọn của bạn; bản đang lưu được giữ nguyên.' : 'Đã bỏ bản nháp của tab này; bản đang lưu trên thiết bị được giữ nguyên.');
    }
    // The owner is captured when a page/controller starts. A stale controller
    // must never begin writing to the next user's workspace after sign-out.
    scopedStorage(ownerId = this.ownerId) {
        if (!this.storage) return null;
        // Keep the consumer's baseline, not the merged storage value: its
        // in-memory page can still omit fields written by a different tab.
        let courseBaseline = ownerId ? this._read(ownerId).values[COURSE_KEY] ?? null : this.storage.getItem(COURSE_KEY);
        return {
            ownerId,
            getItem: key => {
                if (!KEY_SET.has(key)) return null;
                const value = ownerId ? this._read(ownerId).values[key] ?? null : this.storage.getItem(key);
                if (key === COURSE_KEY) courseBaseline = value;
                return value;
            },
            setItem: (key, value) => {
                if (!KEY_SET.has(key)) throw new Error('Mục lưu trữ không được hỗ trợ.');
                const raw = String(value), bundle = ownerId ? this._read(ownerId) : null;
                const latest = ownerId ? bundle.values[key] ?? null : this.storage.getItem(key);
                let merged = raw;
                if (key === COURSE_KEY && latest !== courseBaseline && latest !== raw) {
                    try { merged = mergeCourseEdit(courseBaseline, raw, latest); }
                    catch {
                        this._rememberTabDraft(ownerId, key, raw);
                        throw Object.assign(new Error('Mục này đã được sửa ở tab khác. Bản nháp vẫn ở tab này; hãy tải hồ sơ trước khi chọn bản muốn giữ.'), { code: 'TAB_EDIT_CONFLICT' });
                    }
                }
                if (!ownerId) {
                    this.storage.setItem(key, merged);
                    if (key === COURSE_KEY) courseBaseline = raw;
                    const recovered = this._tabDrafts.get(this._draftKey(ownerId))?.delete(key);
                    if (recovered && ownerId === this.ownerId) this._status('guest', 'Đã lưu trên trình duyệt này.');
                    return;
                }
                if (latest === merged) {
                    if (key === COURSE_KEY) courseBaseline = raw;
                    const recovered = this._tabDrafts.get(this._draftKey(ownerId))?.delete(key);
                    if (recovered && ownerId === this.ownerId) this._status(bundle.dirty ? 'pending' : 'synced',
                        bundle.dirty ? 'Đã lưu trên thiết bị; đang chờ đồng bộ.' : 'Đã đồng bộ tiến độ với tài khoản.');
                    return;
                }
                bundle.values[key] = merged;
                bundle.dirty = true;
                this._write(ownerId, bundle);
                if (key === COURSE_KEY) courseBaseline = raw;
                this._tabDrafts.get(this._draftKey(ownerId))?.delete(key);
                this._changed(ownerId, bundle);
            },
            removeItem: key => {
                if (!KEY_SET.has(key)) return;
                if (!ownerId) {
                    this.storage.removeItem(key);
                    if (key === COURSE_KEY) courseBaseline = null;
                    this._tabDrafts.get(this._draftKey(ownerId))?.delete(key);
                    return;
                }
                const bundle = this._read(ownerId);
                if (!Object.hasOwn(bundle.values, key)) return;
                delete bundle.values[key];
                bundle.dirty = true;
                this._write(ownerId, bundle);
                if (key === COURSE_KEY) courseBaseline = null;
                this._tabDrafts.get(this._draftKey(ownerId))?.delete(key);
                this._changed(ownerId, bundle);
            }
        };
    }
    _changed(ownerId, bundle) {
        if (ownerId !== this.ownerId) return;
        if (bundle.conflict) this._status('conflict', 'Có dữ liệu mới từ thiết bị khác. Bản nháp trên thiết bị vẫn được giữ; mở Tài khoản để chọn bản muốn dùng.');
        else if (!verified(this.user)) this._status('verification', 'Đã lưu trên thiết bị. Xác minh email để đồng bộ với tài khoản.');
        else {
            this._status('pending', 'Đã lưu trên thiết bị; đang chờ đồng bộ.');
            clearTimeout(this._timer);
            this._timer = setTimeout(() => { void this.sync(); }, this.debounceMs);
            this._timer.unref?.();
        }
    }
    async _activate(user) {
        const previous = this.ownerId;
        this.user = user;
        this.ownerId = validOwner(user);
        const epoch = ++this.epoch;
        clearTimeout(this._timer);
        // Requests already in flight are ignored when their owner changes.
        this._flight = null;
        if (previous !== this.ownerId) this._emit('strobot:learner-scope-changed', { previousUserId: previous, userId: this.ownerId });
        if (!this.ownerId) {
            this._status('guest', 'Tiến độ đang lưu trên trình duyệt. Đăng nhập để đồng bộ theo tài khoản.');
            return;
        }
        const ownerId = this.ownerId;
        try {
            this._read(ownerId); // Detect corrupt local data before making any remote change.
            const remote = await this.account.request('/v1/learner-state', { timeoutMs: 8000 });
            if (epoch !== this.epoch) return;
            this._validateRemote(remote);
            const local = this._read(ownerId);
            if (local.dirty && local.revision !== remote.revision) {
                local.conflict = true;
                this._write(ownerId, local);
                this._status('conflict', 'Có dữ liệu mới từ thiết bị khác. Bản nháp trên thiết bị vẫn được giữ; mở Tài khoản để chọn bản muốn dùng.');
                return;
            }
            if (local.dirty) {
                this._changed(ownerId, local);
                if (verified(user)) await this.sync();
            } else {
                this._install(ownerId, remote);
                this._status(verified(user) ? 'synced' : 'verification', verified(user)
                    ? 'Đã đồng bộ tiến độ với tài khoản.' : 'Xác minh email để lưu tiến độ lên tài khoản.');
            }
        } catch (error) {
            if (epoch === this.epoch) this._failed(error);
        }
    }
    _validateRemote(remote) {
        try {
            if (!plain(remote) || !Number.isSafeInteger(remote.revision) || remote.revision < 0)
                throw new Error('Phản hồi đồng bộ không hợp lệ.');
            cleanValues(remote.values);
        } catch { throw Object.assign(new Error('Phản hồi đồng bộ không hợp lệ.'), { code: 'INVALID_SYNC_RESPONSE' }); }
    }
    _install(ownerId, remote) {
        this._write(ownerId, { version: 1, revision: remote.revision, values: cleanValues(remote.values),
            updatedAt: remote.updatedAt, dirty: false, conflict: false });
    }
    _failed(error) {
        if (error?.code === 'LOCAL_DATA_CORRUPT') this._status('error', 'Bản lưu tài khoản trên thiết bị bị lỗi. Dữ liệu chưa bị ghi đè; hãy tải bản sao trước khi khôi phục.', { conflict: true });
        else if (error?.code === 'INVALID_SYNC_RESPONSE') this._status('error', 'Máy chủ trả về dữ liệu đồng bộ chưa hợp lệ. Bản lưu trên thiết bị chưa bị thay đổi.');
        else if (error?.status === 403) this._status('verification', 'Đã lưu trên thiết bị. Xác minh email hoặc kiểm tra quyền tài khoản để đồng bộ.');
        else if (error?.status === 413 || error?.status === 400 || error?.status === 422)
            this._status('error', 'Bản nháp vẫn trên thiết bị nhưng máy chủ chưa nhận được định dạng hoặc dung lượng này. Hãy tải bản sao và kiểm tra lại.');
        else {
            this._status('offline', 'Đã giữ bản lưu trên thiết bị; chưa kết nối được máy chủ. Sẽ thử đồng bộ khi có mạng.');
            clearTimeout(this._timer);
            this._timer = setTimeout(() => { void this.sync(); }, this.retryMs);
            this._timer.unref?.();
        }
    }
    async sync() {
        if (!this.ownerId) return this.status;
        if (!verified(this.user)) {
            this._status('verification', 'Đã lưu trên thiết bị. Xác minh email để đồng bộ với tài khoản.');
            return this.status;
        }
        if (this._flight) return this._flight;
        const ownerId = this.ownerId, epoch = this.epoch;
        const run = async () => {
            try {
                const sent = this._read(ownerId);
                if (sent.conflict) {
                    this._status('conflict', 'Bản nháp chưa ghi đè dữ liệu trên máy chủ. Mở Tài khoản để chọn cách giải quyết.');
                    return this.status;
                }
                if (!sent.dirty) {
                    // A manual refresh also receives work saved on another device.
                    const remote = await this.account.request('/v1/learner-state', { timeoutMs: 8000 });
                    if (epoch !== this.epoch) return this.status;
                    this._validateRemote(remote);
                    const current = this._read(ownerId);
                    if (current.dirty) return this.status;
                    const changed = !sameValues(current.values, remote.values);
                    this._install(ownerId, remote);
                    this._status('synced', 'Đã đồng bộ tiến độ với tài khoản.');
                    if (changed) this._emit('strobot:learner-data-updated', { userId: ownerId });
                    return this.status;
                }
                this._status('syncing', 'Đang đồng bộ tiến độ…');
                const remote = await this.account.request('/v1/learner-state', {
                    method: 'PUT', body: { revision: sent.revision, values: sent.values }, timeoutMs: 12000
                });
                if (epoch !== this.epoch) return this.status;
                this._validateRemote(remote);
                const current = this._read(ownerId);
                const changedWhileSaving = !sameValues(current.values, sent.values);
                this._write(ownerId, { ...current, revision: remote.revision, updatedAt: remote.updatedAt,
                    dirty: changedWhileSaving, conflict: false });
                if (changedWhileSaving) this._changed(ownerId, { ...current, conflict: false });
                else this._status('synced', 'Đã đồng bộ tiến độ với tài khoản.');
            } catch (error) {
                if (epoch !== this.epoch) return this.status;
                if (error?.status === 409) {
                    const current = this._read(ownerId);
                    current.conflict = true;
                    this._write(ownerId, current);
                    this._status('conflict', 'Có dữ liệu mới từ thiết bị khác. Bản nháp trên thiết bị vẫn được giữ; mở Tài khoản để chọn bản muốn dùng.');
                } else this._failed(error);
            }
            return this.status;
        };
        const flight = run();
        this._flight = flight;
        try { return await flight; }
        finally {
            if (this._flight === flight) {
                this._flight = null;
                if (epoch === this.epoch && this.status.status === 'pending') {
                    clearTimeout(this._timer);
                    this._timer = setTimeout(() => { void this.sync(); }, this.debounceMs);
                    this._timer.unref?.();
                }
            }
        }
    }
    guestValuesCount() {
        try { return LEARNER_KEYS.filter(key => this.storage?.getItem(key) !== null && this.storage?.getItem(key) !== undefined).length; }
        catch { return 0; }
    }
    async importGuest() {
        if (!this.ownerId) return;
        try {
            const bundle = this._read(this.ownerId);
            let copied = 0, skipped = 0;
            for (const key of LEARNER_KEYS) {
                const raw = this.storage?.getItem(key);
                if (raw === null || raw === undefined) continue;
                if (Object.hasOwn(bundle.values, key)) { skipped++; continue; }
                bundle.values[key] = raw;
                copied++;
            }
            if (copied) {
                bundle.dirty = true;
                this._write(this.ownerId, bundle);
                this._changed(this.ownerId, bundle);
                this._emit('strobot:learner-data-updated', { userId: this.ownerId });
            }
            this._status(bundle.conflict ? 'conflict' : 'pending', `Đã nhập ${copied} mục còn trống; giữ nguyên ${skipped} mục đã có trong tài khoản. Bản khách trên trình duyệt vẫn được giữ.`);
            if (copied && verified(this.user) && !bundle.conflict) await this.sync();
        } catch (error) { this._failed(error); }
    }
    exportDraft() {
        if (!this.ownerId) return { type: 'strobot-learner-draft', version: 1, values: Object.fromEntries(LEARNER_KEYS.flatMap(key => {
            const value = this.storage?.getItem(key);
            return typeof value === 'string' ? [[key, value]] : [];
        })), tabDraftValues: Object.fromEntries(this._tabDrafts.get('@guest') || []) };
        try { return { type: 'strobot-learner-draft', version: 1, ownerId: this.ownerId, ...this._read(this.ownerId),
            tabDraftValues: Object.fromEntries(this._tabDrafts.get(this._draftKey(this.ownerId)) || []) }; }
        catch {
            return { type: 'strobot-learner-draft', version: 1, ownerId: this.ownerId,
                recoveryEnvelope: this.storage?.getItem(this._key(this.ownerId)) ?? null };
        }
    }
    downloadDraft() {
        try {
            const blob = new Blob([JSON.stringify(this.exportDraft(), null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob), link = this.events.createElement('a');
            link.href = url; link.download = 'strobot-ban-nhap-hoc-tap.json'; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch { this._status('error', 'Chưa tải được bản nháp. Dữ liệu trên thiết bị chưa bị thay đổi.'); }
    }
    // These methods are called only by explicit, confirmed account-page actions.
    async useServerCopy() {
        if (!this.ownerId) return;
        const ownerId = this.ownerId, epoch = this.epoch;
        try {
            const remote = await this.account.request('/v1/learner-state', { timeoutMs: 8000 });
            if (epoch !== this.epoch) return;
            this._validateRemote(remote);
            this._install(ownerId, remote);
            this._status('synced', 'Đã dùng bản lưu trên máy chủ theo lựa chọn của bạn.');
            this._emit('strobot:learner-data-updated', { userId: ownerId });
        } catch (error) { if (epoch === this.epoch) this._failed(error); }
    }
    async keepLocalCopy() {
        if (!this.ownerId || !verified(this.user)) return;
        const ownerId = this.ownerId, epoch = this.epoch;
        try {
            const remote = await this.account.request('/v1/learner-state', { timeoutMs: 8000 });
            if (epoch !== this.epoch) return;
            this._validateRemote(remote);
            const current = this._read(ownerId);
            this._write(ownerId, { ...current, revision: remote.revision, dirty: true, conflict: false });
            await this.sync();
        } catch (error) { if (epoch === this.epoch) this._failed(error); }
    }
    async recordActivity(action, courseId, lessonId, expectedOwnerId = this.ownerId) {
        if (!this.ownerId || expectedOwnerId !== this.ownerId || !verified(this.user)) return false;
        try {
            await this.account.request('/v1/learner-state/activity', { method: 'POST',
                body: { action, ...(courseId ? { courseId } : {}), ...(lessonId ? { lessonId } : {}) }, timeoutMs: 5000 });
            return true;
        } catch { return false; } // Progress itself remains in the durable queued snapshot.
    }
    destroy() {
        clearTimeout(this._timer);
        this._unsubscribe?.();
        this.window?.removeEventListener?.('online', this._online);
        for (const [name, action] of Object.entries(this._actions)) this.events?.removeEventListener?.(name, action);
    }
}

export const learnerSync = new LearnerSyncService();
export const getLearnerStorage = () => learnerSync.scopedStorage();
