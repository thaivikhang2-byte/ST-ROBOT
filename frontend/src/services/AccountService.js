import { resolveBackendUrl } from '../config/backend.config.js';

export const ACCOUNT_SESSION_KEY = 'strobot.account.session.v1';

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
    constructor({ baseUrl = resolveBackendUrl(), fetchImpl = globalThis.fetch?.bind(globalThis), storage = browserStorage() } = {}) {
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
        this._listeners = new Set();
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
    }

    get user() { return this._user; }
    get profile() { return this._user; }
    get configured() { return !!this.baseUrl; }
    // Opaque revision for consumers that perform state changes after awaiting an API call.
    get sessionVersion() { return `${this._generation}:${this._authIntent}`; }

    subscribe(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }
    onAuthChange(listener) { return this.subscribe(listener); }

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
                await this._refresh();
                if (generation !== this._generation) return this._user;
                const user = await this.request('/v1/auth/me');
                if (generation !== this._generation) return this._user;
                this._user = user;
                this.sessionError = null;
                this.sessionOffline = false;
                this._persist();
                this._notify();
                return user;
            } catch (error) {
                if (generation !== this._generation || error.code === 'SESSION_CHANGED') return this._user;
                this.sessionError = error;
                if (error.status === 401) this._clear();
                else if (this._cachedUser && ['NETWORK_ERROR', 'REQUEST_ABORTED'].includes(error.code)) {
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

    async _send(path, { method = 'GET', body, auth = true, headers = {}, timeoutMs = 20000, signal } = {}) {
        if (!this.configured) throw new AccountError('Máy chủ tài khoản chưa được cấu hình. Bạn vẫn có thể học và lưu trên thiết bị.', 0, 'BACKEND_NOT_CONFIGURED');
        // Only this configured API may receive the bearer token.
        if (!/^\/v1\/[a-zA-Z0-9/_?=&%.:+-]*$/.test(path) || path.includes('..'))
            throw new AccountError('Đường dẫn API không hợp lệ.', 0, 'INVALID_API_PATH');
        if (!this.fetchImpl) throw new AccountError('Trình duyệt không hỗ trợ kết nối máy chủ.', 0, 'NETWORK_ERROR');
        const controller = new AbortController();
        const abort = () => controller.abort();
        if (signal?.aborted) controller.abort();
        else signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await this.fetchImpl(this.baseUrl + path, {
                method, credentials: 'omit', cache: 'no-store', signal: controller.signal,
                headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
                    ...headers, ...(auth && this._accessToken ? { Authorization: `Bearer ${this._accessToken}` } : {}) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || payload?.success === false)
                throw new AccountError(typeof payload?.message === 'string' ? payload.message : 'Không thể thực hiện yêu cầu. Vui lòng thử lại.', response.status, payload?.error?.code || 'HTTP_ERROR');
            if (!payload || payload.success !== true || !Object.hasOwn(payload, 'data'))
                throw new AccountError('Máy chủ trả về dữ liệu không hợp lệ.', response.status, 'INVALID_RESPONSE');
            return payload.data;
        } catch (error) {
            if (error instanceof AccountError) throw error;
            throw new AccountError(controller.signal.aborted ? 'Kết nối quá thời gian hoặc đã bị hủy. Vui lòng thử lại.' : 'Không kết nối được máy chủ. Kiểm tra mạng và thử lại.', 0, controller.signal.aborted ? 'REQUEST_ABORTED' : 'NETWORK_ERROR');
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
        }
    }

    _refresh() {
        if (this._refreshPromise) return this._refreshPromise;
        const token = this._refreshToken, generation = this._generation;
        if (!token) return Promise.reject(new AccountError('Vui lòng đăng nhập để tiếp tục.', 401, 'UNAUTHORIZED'));
        this._refreshPromise = this._send('/v1/auth/refresh', { method: 'POST', body: { refreshToken: token }, auth: false })
            .then(async data => {
                if (generation !== this._generation) throw new AccountError('Phiên đăng nhập đã thay đổi.', 401, 'SESSION_CHANGED');
                this._tokens(data.tokens);
                if (this.sessionOffline) {
                    const user = await this._send('/v1/auth/me');
                    if (generation !== this._generation) throw new AccountError('Phiên đăng nhập đã thay đổi.', 401, 'SESSION_CHANGED');
                    this._user = user;
                    this.sessionOffline = false;
                    this.sessionError = null;
                    this._persist();
                    this._notify();
                }
            }).catch(error => {
                if (error.status === 401 && generation === this._generation) this._clear();
                throw error;
            }).finally(() => { this._refreshPromise = null; });
        return this._refreshPromise;
    }

    async request(path, options = {}) {
        if (!this.configured) throw new AccountError('Máy chủ tài khoản chưa được cấu hình. Bạn vẫn có thể học và lưu trên thiết bị.', 0, 'BACKEND_NOT_CONFIGURED');
        const auth = options.auth !== false;
        if (auth && (!this._accessToken || this.sessionOffline)) await this._refresh();
        const generation = this._generation, token = this._accessToken;
        const current = value => {
            if (auth && generation !== this._generation) throw new AccountError('Phiên đăng nhập đã thay đổi.', 401, 'SESSION_CHANGED');
            return value;
        };
        try { return current(await this._send(path, options)); }
        catch (error) {
            if (!auth || error.status !== 401 || !this._refreshToken || generation !== this._generation) throw error;
            // Another request may already have rotated the token before this 401 arrived.
            if (token === this._accessToken) await this._refresh();
            return current(await this._send(path, options));
        }
    }

    async _authenticate(path, credentials) {
        const intent = ++this._authIntent;
        const data = await this._send(path, { method: 'POST', body: credentials, auth: false });
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
        return data.user;
    }
    signIn(credentials) { return this._authenticate('/v1/auth/login', credentials); }
    login(credentials) { return this.signIn(credentials); }
    register(credentials) { return this._authenticate('/v1/auth/register', credentials); }

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
        const accessToken = this._accessToken, refreshToken = this._refreshToken;
        // Clear immediately. A later logout response must never clear a newer login.
        this._clear();
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
}

export const accountService = new AccountService();
