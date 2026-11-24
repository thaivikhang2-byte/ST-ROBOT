import { resolveBackendUrl } from '../config/backend.config.js';

export const ACCOUNT_SESSION_KEY = 'strobot.account.session.v1';
export const ACCOUNT_CONNECTION_KEY = 'strobot.account.connection.v1';
export const ACCOUNT_CONNECTION_EVENT = 'strobot:account-connection';
export const ACCOUNT_LOGOUT_CHANNEL = 'strobot.account.logout.v1';

const CONNECTION_HINT_MAX_AGE = 5 * 60 * 1000;
const LOGOUT_SIGNAL_MAX_AGE = 5 * 60 * 1000;
const logoutFields = new Set(['version', 'type', 'baseUrl', 'ownerId', 'issuedAt']);
const sessionTime = () => {
    const clock = globalThis.performance;
    return clock && Number.isFinite(clock.timeOrigin) && typeof clock.now === 'function'
        ? clock.timeOrigin + clock.now() : Date.now();
};

// Browsers isolate this channel to the current origin. Node/injected clients stay local.
// The storage fallback contains only a short-lived logout signal, never account credentials.
const browserLogoutChannel = () => {
    const view = globalThis.window;
    if (!view?.document || !view.location) return null;
    try {
        if (typeof view.BroadcastChannel === 'function') return new view.BroadcastChannel(ACCOUNT_LOGOUT_CHANNEL);
    } catch { /* Storage events also support browsers without a usable channel. */ }
    try {
        const storage = view.localStorage, listeners = new Set();
        if (!storage || typeof view.addEventListener !== 'function') return null;
        view.addEventListener('storage', event => {
            if (event.storageArea !== storage || event.key !== ACCOUNT_LOGOUT_CHANNEL || !event.newValue) return;
            try {
                const data = JSON.parse(event.newValue);
                for (const listener of listeners) listener({ data });
            } catch { /* Ignore unrelated or malformed same-origin storage events. */ }
        });
        return {
            addEventListener: (type, listener) => { if (type === 'message') listeners.add(listener); },
            postMessage: data => {
                storage.setItem(ACCOUNT_LOGOUT_CHANNEL, JSON.stringify(data));
                storage.removeItem(ACCOUNT_LOGOUT_CHANNEL);
            },
        };
    } catch { return null; }
};

const abortedRequest = () => new AccountError('Kết nối đã bị hủy. Vui lòng thử lại.', 0, 'REQUEST_ABORTED');
const changedSession = () => new AccountError('Phiên đăng nhập đã thay đổi.', 401, 'SESSION_CHANGED');
const connectionFailure = () => new AccountError('Chưa kết nối được máy chủ. Vui lòng thử lại sau.', 0, 'NETWORK_ERROR');
const duration = (value, fallback, maximum) => Number.isFinite(value) && value > 0 ? Math.min(value, maximum) : fallback;
const timingMs = value => Number.isFinite(value) ? Math.min(86400000, Math.max(0, Math.round(value))) : 0;
const timingStatus = value => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
const timingRequestId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
const timingError = (error, cancelled) => {
    if (cancelled) return 'CANCELLED';
    if (error?.code === 'REQUEST_ABORTED') return 'TIMEOUT';
    if (['NETWORK_ERROR', 'BACKEND_UNAVAILABLE', 'BACKEND_NOT_CONFIGURED', 'INVALID_RESPONSE', 'SESSION_CHANGED'].includes(error?.code)) return error.code;
    if (error?.status === 400) return 'INVALID_REQUEST';
    if (error?.status === 401) return 'UNAUTHORIZED';
    if (error?.status === 403) return 'FORBIDDEN';
    if (error?.status === 409) return 'CONFLICT';
    if (error?.status === 429) return 'RATE_LIMITED';
    return error?.status >= 500 ? 'SERVER_ERROR' : 'REQUEST_FAILED';
};

export class AccountError extends Error {
    constructor(message, status = 0, code = 'ACCOUNT_ERROR') {
        super(message);
        this.name = 'AccountError';
        this.status = status;
        this.code = code;
    }
}

const browserStorage = () => {
    try { return globalThis.sessionStorage; } catch { return undefined; }
};

export class AccountService {
    constructor({ baseUrl = resolveBackendUrl(), fetchImpl = globalThis.fetch?.bind(globalThis), storage = browserStorage(), warmup = typeof globalThis.window !== 'undefined', logoutChannelFactory = browserLogoutChannel, now = sessionTime } = {}) {
        this.baseUrl = baseUrl;
        this.fetchImpl = fetchImpl;
        this.storage = storage;
        this._user = null;
        this._accessToken = '';
        this._refreshToken = '';
        this._readyPromise = null;
        this._refreshPromise = null;
        this._generation = 0;
        this._authIntent = 0;
        this._now = now;
        this._authStartedAt = 0;
        this._listeners = new Set();
        this._loginTiming = null;
        this._loginTimingListeners = new Set();
        // Browser requests wait for a sleeping server before starting their normal API timeout.
        // Injected clients can opt in with `warmup: true` or provide shorter durations for tests.
        const timing = warmup && typeof warmup === 'object' ? warmup : {};
        this._warmup = warmup ? {
            timeoutMs: duration(timing.timeoutMs, 90000, 90000),
            requestTimeoutMs: duration(timing.requestTimeoutMs, 15000, 90000),
            retryDelayMs: duration(timing.retryDelayMs, 1000, 10000),
            ttlMs: duration(timing.ttlMs, 300000, 900000),
        } : null;
        this._connectionUntil = 0;
        this._connectionFlight = null;
        this._connectionStartedAt = 0;
        this._connectionRevision = 0;
        this.connectionStatus = 'idle';
        this.sessionError = null;
        this.sessionOffline = false;
        this._cachedUser = null;
        try {
            const saved = JSON.parse(storage?.getItem(ACCOUNT_SESSION_KEY) || 'null');
            // A token from a different configured server must never be sent to this server.
            if (saved?.version === 1 && saved.baseUrl === baseUrl && typeof saved.refreshToken === 'string') {
                this._refreshToken = saved.refreshToken;
                const cached = saved.profile;
                if (cached && typeof cached.id === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(cached.id) && typeof cached.email === 'string')
                    this._cachedUser = { id: cached.id, email: cached.email.slice(0, 255), firstName: String(cached.firstName || '').slice(0, 100), lastName: String(cached.lastName || '').slice(0, 100), isEmailVerified: cached.isEmailVerified === true, roles: [], permissions: [] };
            }
        } catch { /* Invalid or disabled storage is equivalent to no persisted session. */ }
        if (this._warmup) {
            try {
                const hint = JSON.parse(storage?.getItem(ACCOUNT_CONNECTION_KEY) || 'null');
                const now = Date.now(), maximum = Math.min(this._warmup.ttlMs, CONNECTION_HINT_MAX_AGE);
                if (hint?.version === 1 && hint.baseUrl === baseUrl && Number.isSafeInteger(hint.checkedAt)
                    && hint.checkedAt >= 0 && hint.checkedAt <= now && now - hint.checkedAt < maximum)
                    this._connectionUntil = hint.checkedAt + maximum;
            } catch { /* A missing readiness hint only adds one safe health request. */ }
        }
        try {
            this._logoutChannel = logoutChannelFactory?.();
            this._logoutChannel?.addEventListener('message', event => this._receiveLogout(event.data));
            this._logoutChannel?.unref?.();
        } catch { /* Disabled cross-tab messaging does not prevent a local sign-out. */ }
    }

    get user() { return this._user; }
    get profile() { return this._user; }
    get configured() { return !!this.baseUrl; }
    // Opaque revision for consumers that perform state changes after awaiting an API call.
    get sessionVersion() { return `${this._generation}:${this._authIntent}`; }
    get connectionElapsedMs() {
        return this.connectionStatus === 'connecting' ? Math.max(0, Date.now() - this._connectionStartedAt) : 0;
    }
    get connectionTimeoutMs() { return this._warmup?.timeoutMs ?? 0; }
    get loginTiming() {
        const trace = this._loginTiming;
        if (!trace) return null;
        const now = trace.endedAt ?? this._timingNow();
        const totalMs = timingMs(now - trace.startedAt);
        const connectionMs = timingMs((trace.authenticationAt ?? now) - trace.startedAt);
        const authenticationMs = trace.authenticationMs ?? (trace.authenticationAt === null ? 0 : timingMs(now - trace.authenticationAt));
        return Object.freeze({ clientBuild: 'timing-v1', operation: 'login', outcome: trace.outcome,
            stage: trace.outcome === 'pending' ? trace.authenticationAt === null ? 'connection' : 'authentication' : 'complete',
            connectionMs, authenticationMs, clientMs: Math.max(0, totalMs - connectionMs - authenticationMs), totalMs,
            httpStatus: trace.httpStatus, errorCode: trace.errorCode,
            ...(trace.requestId ? { requestId: trace.requestId } : {}) });
    }
    getLoginTimingReport() { return this.loginTiming; }
    subscribeLoginTiming(listener) {
        if (typeof listener !== 'function') return () => {};
        this._loginTimingListeners.add(listener);
        return () => this._loginTimingListeners.delete(listener);
    }
    _timingNow() {
        try { const value = this._now(); if (Number.isFinite(value)) return value; } catch { /* Diagnostics cannot break authentication. */ }
        return Date.now();
    }
    _publishLoginTiming() {
        const report = this.getLoginTimingReport();
        for (const listener of this._loginTimingListeners) {
            try { listener(report); } catch { /* A diagnostic listener has no authority over login. */ }
        }
    }
    _beginLoginTiming(intent) {
        const trace = { intent, startedAt: this._timingNow(), authenticationAt: null, authenticationMs: null,
            endedAt: null, outcome: 'pending', httpStatus: null, errorCode: null, requestId: null };
        this._loginTiming = trace;
        this._publishLoginTiming();
        return trace;
    }
    _updateLoginTiming(trace, event) {
        if (this._loginTiming !== trace || trace.intent !== this._authIntent || trace.outcome !== 'pending') return;
        if (event.type === 'start') trace.authenticationAt = this._timingNow();
        else {
            trace.authenticationMs = timingMs(event.durationMs);
            trace.httpStatus = timingStatus(event.httpStatus);
            trace.requestId = timingRequestId(event.requestId);
            trace.timedOut = event.timedOut === true;
        }
        this._publishLoginTiming();
    }
    _finishLoginTiming(trace, error, cancelled = false, superseded = false) {
        if (!trace || this._loginTiming !== trace || trace.outcome !== 'pending' || (!superseded && trace.intent !== this._authIntent)) return;
        trace.endedAt = this._timingNow();
        trace.outcome = error ? cancelled ? 'cancelled' : 'failed' : 'succeeded';
        trace.errorCode = error ? cancelled ? 'CANCELLED' : trace.timedOut ? 'TIMEOUT' : timingError(error, false) : null;
        this._publishLoginTiming();
    }

    subscribe(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }
    onAuthChange(listener) { return this.subscribe(listener); }

    _receiveLogout(data) {
        const now = this._now();
        if (!data || typeof data !== 'object' || Array.isArray(data)
            || Object.keys(data).length !== logoutFields.size || Object.keys(data).some(key => !logoutFields.has(key))
            || data.version !== 1 || data.type !== 'logout' || data.baseUrl !== this.baseUrl
            || typeof data.ownerId !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(data.ownerId)
            || !Number.isFinite(data.issuedAt) || data.issuedAt < 0 || data.issuedAt > now + 30000
            || now - data.issuedAt > LOGOUT_SIGNAL_MAX_AGE
            || data.issuedAt < this._authStartedAt) return;
        const ownerId = this._user?.id || this._cachedUser?.id;
        if (data.ownerId !== ownerId) return;
        // Only clear this tab. Do not rebroadcast or replay any logout/refresh POST.
        ++this._authIntent;
        this._clear();
    }

    _broadcastLogout(ownerId, issuedAt) {
        if (typeof ownerId !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(ownerId)) return;
        try { this._logoutChannel?.postMessage({ version: 1, type: 'logout', baseUrl: this.baseUrl, ownerId, issuedAt }); }
        catch { /* Browser privacy settings can disable either messaging transport. */ }
    }

    _connection(status) {
        if (this.connectionStatus === status) return;
        this.connectionStatus = status;
        this._connectionStartedAt = status === 'connecting' ? Date.now() : 0;
        if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function')
            globalThis.dispatchEvent(new CustomEvent(ACCOUNT_CONNECTION_EVENT, { detail: { status } }));
    }

    _rememberConnection() {
        if (!this._warmup) return;
        const checkedAt = Date.now();
        this._connectionUntil = checkedAt + this._warmup.ttlMs;
        this._connectionRevision++;
        try {
            // This short-lived server hint contains no identity, token, permission or provider key.
            this.storage?.setItem(ACCOUNT_CONNECTION_KEY, JSON.stringify({ version: 1, baseUrl: this.baseUrl, checkedAt }));
        } catch { /* Readiness remains cached in memory when session storage is unavailable. */ }
        this._connection('ready');
    }

    _forgetConnection(revision = this._connectionRevision) {
        // An old failed request cannot erase evidence from a newer successful response.
        if (!this._warmup || revision !== this._connectionRevision) return;
        this._connectionUntil = 0;
        try { this.storage?.removeItem(ACCOUNT_CONNECTION_KEY); } catch { /* Storage can be disabled. */ }
    }

    prepareConnection({ signal } = {}) {
        this._checkPath('/v1/auth/options');
        return this._ensureConnection(signal);
    }

    _waitWithSignal(promise, signal, onAbort) {
        if (!signal) return promise;
        return new Promise((resolve, reject) => {
            const abort = () => { cleanup(); onAbort?.(); reject(abortedRequest()); };
            const cleanup = () => signal.removeEventListener('abort', abort);
            if (signal.aborted) abort();
            else signal.addEventListener('abort', abort, { once: true });
            promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
        });
    }

    async _healthAttempt(signal, timeoutMs) {
        const controller = new AbortController();
        const abort = () => controller.abort();
        const timer = setTimeout(abort, timeoutMs);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) controller.abort();
        try {
            // This fixed endpoint never receives cookies, bearer tokens or request bodies.
            return await this._waitWithSignal((async () => {
                const response = await this.fetchImpl(this.baseUrl + '/system/health/live', {
                    method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error',
                    headers: { Accept: 'application/json' }, signal: controller.signal,
                });
                if ([502, 503, 504].includes(response.status)) throw connectionFailure();
                // Health authorization/configuration errors must never invalidate an account session.
                if (!response.ok) throw new AccountError('Máy chủ tài khoản chưa sẵn sàng. Vui lòng thử lại sau.', 0, 'BACKEND_UNAVAILABLE');
                const payload = await response.json().catch(() => null);
                if (payload?.success !== true || payload?.data?.status !== 'ok')
                    throw new AccountError('Máy chủ trả về dữ liệu không hợp lệ.', 0, 'BACKEND_UNAVAILABLE');
            })(), controller.signal);
        } catch (error) {
            if (signal.aborted) throw abortedRequest();
            if (error instanceof AccountError && error.code !== 'REQUEST_ABORTED') throw error;
            throw connectionFailure();
        } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
        }
    }

    async _warmConnection(flight) {
        if (flight.controller.signal.aborted) throw abortedRequest();
        const deadline = Date.now() + this._warmup.timeoutMs;
        this._connection('connecting');
        try {
            while (Date.now() < deadline) {
                if (flight.controller.signal.aborted) throw abortedRequest();
                try {
                    await this._healthAttempt(flight.controller.signal, Math.min(this._warmup.requestTimeoutMs, deadline - Date.now()));
                    if (this._connectionFlight === flight) this._rememberConnection();
                    return;
                } catch (error) {
                    if (error.code !== 'NETWORK_ERROR') throw error;
                    const delay = Math.min(this._warmup.retryDelayMs, deadline - Date.now());
                    if (delay <= 0) throw connectionFailure();
                    let timer;
                    try {
                        await this._waitWithSignal(new Promise(resolve => { timer = setTimeout(resolve, delay); }), flight.controller.signal);
                    } finally { clearTimeout(timer); }
                }
            }
            throw connectionFailure();
        } catch (error) {
            if (this._connectionFlight === flight) {
                this._forgetConnection();
                this._connection(error.code === 'REQUEST_ABORTED' ? 'idle' : 'error');
            }
            throw error;
        }
    }

    _ensureConnection(signal) {
        if (signal?.aborted) return Promise.reject(abortedRequest());
        if (!this._warmup || Date.now() < this._connectionUntil) return Promise.resolve();
        let flight = this._connectionFlight;
        if (!flight) {
            flight = { controller: new AbortController(), waiters: 0 };
            this._connectionFlight = flight;
            // Initialize the shared promise before notifying connection listeners, which may
            // themselves start another account request.
            flight.promise = Promise.resolve().then(() => this._warmConnection(flight)).finally(() => {
                if (this._connectionFlight === flight) this._connectionFlight = null;
            });
        }
        flight.waiters++;
        const leave = () => {
            if (--flight.waiters === 0 && this._connectionFlight === flight) {
                this._connectionFlight = null;
                flight.controller.abort();
                this._connection('idle');
            }
        };
        let left = false;
        const leaveOnce = () => { if (!left) { left = true; leave(); } };
        return this._waitWithSignal(flight.promise, signal, leaveOnce).finally(leaveOnce);
    }

    _notify() {
        for (const listener of this._listeners) {
            try { listener(this._user); } catch (error) { console.error('Account state listener failed', error?.name || 'Error'); }
        }
    }

    _tokens(tokens) {
        if (!tokens || typeof tokens.accessToken !== 'string' || typeof tokens.refreshToken !== 'string')
            throw new AccountError('Máy chủ trả về phiên đăng nhập không hợp lệ.', 0, 'INVALID_RESPONSE');
        this._accessToken = tokens.accessToken;
        this._refreshToken = tokens.refreshToken;
        this._persist();
    }

    _persist() {
        const user = this._user || this._cachedUser;
        const profile = user ? { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, isEmailVerified: user.isEmailVerified === true } : null;
        try {
            this.storage?.setItem(ACCOUNT_SESSION_KEY, JSON.stringify({ version: 1, baseUrl: this.baseUrl, refreshToken: this._refreshToken, profile }));
        } catch { /* Login still works in memory if browser storage is disabled. */ }
    }

    _clear() {
        if (this._loginTiming?.outcome === 'pending' && this._loginTiming.intent !== this._authIntent)
            this._finishLoginTiming(this._loginTiming, { code: 'SESSION_CHANGED' }, true, true);
        this._generation++;
        this._accessToken = '';
        this._refreshToken = '';
        this._user = null;
        this._cachedUser = null;
        this.sessionOffline = false;
        this._readyPromise = Promise.resolve(null);
        try { this.storage?.removeItem(ACCOUNT_SESSION_KEY); } catch { /* Storage can be disabled. */ }
        this._notify();
    }

    ready() {
        if (!this._readyPromise) this._readyPromise = (async () => {
            if (!this.configured || !this._refreshToken) return null;
            const generation = this._generation;
            try {
                const refreshed = await this._refresh();
                if (generation !== this._generation) return this._user;
                const user = refreshed || await this.request('/v1/auth/me');
                if (generation !== this._generation) return this._user;
                const changed = this._user !== user || this.sessionOffline;
                this._user = user;
                this.sessionError = null;
                this.sessionOffline = false;
                this._persist();
                if (changed) this._notify();
                return user;
            } catch (error) {
                if (generation !== this._generation || error.code === 'SESSION_CHANGED') return this._user;
                this.sessionError = error;
                if (error.status === 401) this._clear();
                else if (this._cachedUser && ['NETWORK_ERROR', 'REQUEST_ABORTED', 'BACKEND_UNAVAILABLE'].includes(error.code)) {
                    // A cached identity scopes offline work only. The server still authorizes every API call.
                    this._user = this._cachedUser;
                    this._accessToken = '';
                    this.sessionOffline = true;
                    this._notify();
                    return this._user;
                }
                return null;
            }
        })();
        return this._readyPromise;
    }

    _checkPath(path) {
        if (!this.configured) throw new AccountError('Máy chủ tài khoản chưa được cấu hình. Bạn vẫn có thể học và lưu trên thiết bị.', 0, 'BACKEND_NOT_CONFIGURED');
        // Only this configured API may receive the bearer token.
        if (!/^\/v1\/[a-zA-Z0-9/_?=&%.:+-]*$/.test(path) || path.includes('..'))
            throw new AccountError('Đường dẫn API không hợp lệ.', 0, 'INVALID_API_PATH');
        if (!this.fetchImpl) throw new AccountError('Trình duyệt không hỗ trợ kết nối máy chủ.', 0, 'NETWORK_ERROR');
    }

    async _send(path, { method = 'GET', body, auth = true, headers = {}, timeoutMs = 20000, signal, sessionGuard, onTiming } = {}) {
        this._checkPath(path);
        if (sessionGuard && !sessionGuard()) throw changedSession();
        await this._ensureConnection(signal);
        // A delayed connection must not attach a new account's token to an old account's body.
        if (sessionGuard && !sessionGuard()) throw changedSession();
        if (signal?.aborted) throw abortedRequest();
        const readinessRevision = this._connectionRevision;
        const controller = new AbortController();
        const abort = () => controller.abort();
        if (signal?.aborted) controller.abort();
        else signal?.addEventListener('abort', abort, { once: true });
        let watchdogFired = false;
        const timer = setTimeout(() => { watchdogFired = true; controller.abort(); }, timeoutMs);
        const timingStartedAt = this._timingNow();
        let httpStatus = null, requestId = null;
        const emitTiming = event => { try { onTiming?.(event); } catch { /* Timing cannot change a request result. */ } };
        emitTiming({ type: 'start' });
        try {
            const response = await this.fetchImpl(this.baseUrl + path, {
                method, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
                headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
                    ...headers, ...(auth && this._accessToken ? { Authorization: `Bearer ${this._accessToken}` } : {}) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
            const payload = await response.json().catch(() => null);
            httpStatus = timingStatus(response.status);
            requestId = timingRequestId(payload?.meta?.requestId);
            if (controller.signal.aborted) throw abortedRequest();
            if (!response.ok || payload?.success === false) {
                if (response.status >= 500) this._forgetConnection(readinessRevision);
                const failure = new AccountError(typeof payload?.message === 'string' ? payload.message : 'Không thể thực hiện yêu cầu. Vui lòng thử lại.', response.status, payload?.error?.code || 'HTTP_ERROR');
                if (requestId) failure.requestId = requestId;
                throw failure;
            }
            if (!payload || payload.success !== true || !Object.hasOwn(payload, 'data')) {
                this._forgetConnection(readinessRevision);
                throw new AccountError('Máy chủ trả về dữ liệu không hợp lệ.', response.status, 'INVALID_RESPONSE');
            }
            this._rememberConnection();
            return payload.data;
        } catch (error) {
            if (error instanceof AccountError) {
                if (error.code === 'REQUEST_ABORTED') this._forgetConnection(readinessRevision);
                throw error;
            }
            this._forgetConnection(readinessRevision);
            if (!controller.signal.aborted && this._warmup && readinessRevision === this._connectionRevision)
                this._connection('error');
            throw new AccountError(controller.signal.aborted ? 'Kết nối quá thời gian hoặc đã bị hủy. Vui lòng thử lại.' : 'Không kết nối được máy chủ. Kiểm tra mạng và thử lại.', 0, controller.signal.aborted ? 'REQUEST_ABORTED' : 'NETWORK_ERROR');
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            emitTiming({ type: 'end', durationMs: this._timingNow() - timingStartedAt, httpStatus, requestId, timedOut: watchdogFired });
        }
    }

    _refresh() {
        if (this._refreshPromise) return this._refreshPromise;
        const token = this._refreshToken, generation = this._generation;
        const ownerId = this._user?.id || this._cachedUser?.id;
        if (!token) return Promise.reject(new AccountError('Vui lòng đăng nhập để tiếp tục.', 401, 'UNAUTHORIZED'));
        this._refreshPromise = this._send('/v1/auth/refresh', { method: 'POST', body: { refreshToken: token }, auth: false, sessionGuard: () => generation === this._generation })
            .then(async data => {
                if (generation !== this._generation) throw new AccountError('Phiên đăng nhập đã thay đổi.', 401, 'SESSION_CHANGED');
                const refreshed = data?.user;
                if (refreshed != null && (typeof refreshed !== 'object'
                    || typeof refreshed.id !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(refreshed.id)
                    || typeof refreshed.email !== 'string' || (ownerId && refreshed.id !== ownerId)))
                    throw new AccountError('Máy chủ trả về hồ sơ phiên không hợp lệ.', 0, 'INVALID_RESPONSE');
                this._tokens(data.tokens);
                if (refreshed) {
                    this._user = refreshed;
                    this.sessionOffline = false;
                    this.sessionError = null;
                    this._persist();
                    this._notify();
                    return refreshed;
                }
                if (this.sessionOffline) {
                    const user = await this._send('/v1/auth/me');
                    if (generation !== this._generation) throw new AccountError('Phiên đăng nhập đã thay đổi.', 401, 'SESSION_CHANGED');
                    this._user = user;
                    this.sessionOffline = false;
                    this.sessionError = null;
                    this._persist();
                    this._notify();
                    return user;
                }
            }).catch(error => {
                if (error.status === 401 && generation === this._generation) this._clear();
                throw error;
            }).finally(() => { this._refreshPromise = null; });
        return this._refreshPromise;
    }

    async request(path, options = {}) {
        this._checkPath(path);
        const auth = options.auth !== false;
        const generation = this._generation;
        if (auth && (!this._accessToken || this.sessionOffline)) {
            await this._ensureConnection(options.signal);
            if (generation !== this._generation) throw changedSession();
            if (options.signal?.aborted) throw abortedRequest();
            // Rotation remains single-flight even if one waiting consumer cancels.
            await this._waitWithSignal(this._refresh(), options.signal);
        }
        if (auth && generation !== this._generation) throw changedSession();
        const token = this._accessToken;
        const send = () => this._send(path, { ...options, sessionGuard: auth ? () => generation === this._generation : undefined });
        const current = value => {
            if (auth && generation !== this._generation) throw new AccountError('Phiên đăng nhập đã thay đổi.', 401, 'SESSION_CHANGED');
            return value;
        };
        try { return current(await send()); }
        catch (error) {
            if (options.signal?.aborted) throw abortedRequest();
            if (!auth || error.status !== 401 || !this._refreshToken || generation !== this._generation) throw error;
            // Another request may already have rotated the token before this 401 arrived.
            if (token === this._accessToken) await this._waitWithSignal(this._refresh(), options.signal);
            return current(await send());
        }
    }

    async _authenticate(path, credentials, { signal } = {}) {
        const intent = ++this._authIntent;
        this._authStartedAt = this._now();
        const trace = path === '/v1/auth/login' ? this._beginLoginTiming(intent) : null;
        if (!trace && this._loginTiming?.outcome === 'pending') this._finishLoginTiming(this._loginTiming, { code: 'SESSION_CHANGED' }, true, true);
        try {
            const data = await this._send(path, { method: 'POST', body: credentials, auth: false, signal, sessionGuard: () => intent === this._authIntent,
                ...(trace ? { onTiming: event => this._updateLoginTiming(trace, event) } : {}) });
            if (intent !== this._authIntent) throw new AccountError('Phiên đăng nhập đã thay đổi.', 401, 'SESSION_CHANGED');
            if (!data?.user?.id) throw new AccountError('Máy chủ trả về tài khoản không hợp lệ.', 0, 'INVALID_RESPONSE');
            this._generation++;
            this._tokens(data.tokens);
            this._user = data.user;
            this.sessionError = null;
            this.sessionOffline = false;
            this._persist();
            this._readyPromise = Promise.resolve(data.user);
            this._notify();
            this._finishLoginTiming(trace);
            return data.user;
        } catch (error) {
            this._finishLoginTiming(trace, error, Boolean(signal?.aborted));
            throw error;
        }
    }
    signIn(credentials, options) { return this._authenticate('/v1/auth/login', credentials, options); }
    login(credentials, options) { return this.signIn(credentials, options); }
    register(credentials, options) { return this._authenticate('/v1/auth/register', credentials, options); }

    async reloadProfile() {
        const generation = this._generation;
        const user = await this.request('/v1/auth/me');
        if (generation !== this._generation) throw new AccountError('Phiên đăng nhập đã thay đổi.', 401, 'SESSION_CHANGED');
        this._user = user;
        this.sessionOffline = false;
        this.sessionError = null;
        this._persist();
        this._notify();
        return user;
    }

    async signOut({ all = false } = {}) {
        ++this._authIntent;
        const ownerId = this._user?.id || this._cachedUser?.id, issuedAt = this._now();
        const accessToken = this._accessToken, refreshToken = this._refreshToken;
        // Clear immediately. A later logout response must never clear a newer login.
        this._clear();
        this._broadcastLogout(ownerId, issuedAt);
        if (!accessToken && !refreshToken) return { remoteRevoked: false };
        let token = accessToken;
        const path = all ? '/v1/auth/logout-all' : '/v1/auth/logout-current';
        const revoke = () => this._send(path, { method: 'POST', auth: false, headers: { Authorization: `Bearer ${token}` } });
        try {
            if (!token) throw new AccountError('Phiên cần làm mới trước khi thu hồi.', 401, 'UNAUTHORIZED');
            await revoke();
        } catch (error) {
            if (error.status !== 401 || !refreshToken) throw error;
            // Refresh only the captured old session, without installing it into browser state.
            const data = await this._send('/v1/auth/refresh', { method: 'POST', body: { refreshToken }, auth: false });
            token = data?.tokens?.accessToken;
            if (typeof token !== 'string' || !token) throw new AccountError('Không thể thu hồi phiên từ xa.', 401, 'INVALID_RESPONSE');
            await revoke();
        }
        return { remoteRevoked: true };
    }
    signOutEverywhere() { return this.signOut({ all: true }); }
}

export const accountService = new AccountService();
