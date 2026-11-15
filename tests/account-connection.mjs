import assert from 'node:assert/strict';
import { AccountService, ACCOUNT_SESSION_KEY, ACCOUNT_CONNECTION_EVENT } from '../frontend/src/services/AccountService.js';

const baseUrl = 'https://account.example.test/api';
const user = { id: 'learner-one', email: 'learner@example.test', firstName: 'Learner', roles: ['STAFF'], permissions: ['users:manage'] };
const secondUser = { ...user, id: 'learner-two', email: 'second@example.test' };
const credentials = { email: user.email, password: 'fixture password' };
const auth = (profile = user) => ({ user: profile, tokens: { accessToken: 'access-' + profile.id, refreshToken: 'refresh-' + profile.id } });
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => ({ success: status < 400, data }) });
const healthy = () => response({ status: 'ok' });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const timing = { timeoutMs: 200, requestTimeoutMs: 100, retryDelayMs: 8, ttlMs: 1000 };
const storage = profile => {
    const saved = new Map(profile ? [[ACCOUNT_SESSION_KEY, JSON.stringify({ version: 1, baseUrl, refreshToken: 'saved-refresh', profile })]] : []);
    return { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
};

// Merely configuring a server or restoring a guest never wakes it. Invalid paths stay local.
{
    const calls = [];
    const service = new AccountService({ baseUrl, warmup: true, storage: storage(), fetchImpl: async (...args) => { calls.push(args); return healthy(); } });
    assert.equal(await service.ready(), null);
    assert.equal(calls.length, 0);
    await assert.rejects(service.request('https://other.example.test/steal', { auth: false }), { code: 'INVALID_API_PATH' });
    assert.equal(calls.length, 0);
    assert.deepEqual(await service.signOut(), { remoteRevoked: false });
    assert.equal(calls.length, 0);
}

// Only health GETs retry during a slow start; login and another API share one connection check.
// The small API timeout begins after the longer connection wait, and health success is cached.
{
    const calls = [], healthStatuses = [502, 503, 504, 'network', 200];
    const service = new AccountService({ baseUrl, warmup: timing, storage: storage(), fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/system/health/live')) {
            const status = healthStatuses.shift();
            if (status === 'network') throw new TypeError('fixture offline');
            return response({ status: 'ok' }, status);
        }
        return response(url.endsWith('/login') ? auth() : { registrationEnabled: false });
    } });
    const [options, profile] = await Promise.all([
        service.request('/v1/auth/options', { auth: false, timeoutMs: 10 }),
        service.signIn(credentials),
    ]);
    assert.deepEqual(options, { registrationEnabled: false });
    assert.equal(profile.id, user.id);
    const health = calls.filter(call => call.url.endsWith('/system/health/live'));
    assert.equal(health.length, 5);
    for (const { url, options: init } of health) {
        assert.equal(url, baseUrl + '/system/health/live');
        assert.equal(init.method, 'GET');
        assert.equal(init.credentials, 'omit');
        assert.equal(init.redirect, 'error');
        assert.deepEqual(init.headers, { Accept: 'application/json' });
        assert.equal(init.body, undefined);
    }
    assert.equal(calls.filter(call => call.url.endsWith('/login')).length, 1);
    await service.request('/v1/auth/options', { auth: false });
    assert.equal(calls.filter(call => call.url.endsWith('/system/health/live')).length, 5);
    assert.equal(service.connectionStatus, 'ready');
}

// A quiet connection expires; a successful API call extends the cache.
{
    let checks = 0;
    const service = new AccountService({ baseUrl, warmup: { ...timing, ttlMs: 15 }, storage: storage(), fetchImpl: async url => {
        if (url.endsWith('/system/health/live')) { checks++; return healthy(); }
        return response({ ok: true });
    } });
    await service.request('/v1/auth/options', { auth: false });
    await delay(25);
    await service.request('/v1/auth/options', { auth: false });
    assert.equal(checks, 2);
}

// One cancelled consumer must not cancel a shared connection or send its subsequent API call.
{
    const health = deferred(), calls = [], controller = new AbortController();
    let healthSignal;
    const service = new AccountService({ baseUrl, warmup: timing, storage: storage(), fetchImpl: async (url, options) => {
        calls.push(url);
        if (url.endsWith('/system/health/live')) { healthSignal = options.signal; return health.promise; }
        return response(auth());
    } });
    const cancelled = service.request('/v1/auth/options', { auth: false, signal: controller.signal });
    const rejected = assert.rejects(cancelled, { code: 'REQUEST_ABORTED' });
    const login = service.signIn(credentials);
    await delay(0);
    controller.abort();
    await rejected;
    assert.equal(healthSignal.aborted, false);
    health.resolve(healthy());
    assert.equal((await login).id, user.id);
    assert.deepEqual(calls, [baseUrl + '/system/health/live', baseUrl + '/v1/auth/login']);
}

// Cancelling the last waiter stops health immediately, even if a transport ignores abort.
// Its eventual failure cannot affect a later successful login or emit a stale error event.
{
    const oldHealth = deferred(), controller = new AbortController(), calls = [];
    let oldSignal;
    const service = new AccountService({ baseUrl, warmup: timing, storage: storage(), fetchImpl: async (url, options) => {
        calls.push(url);
        if (url.endsWith('/system/health/live')) {
            if (!oldSignal) { oldSignal = options.signal; return oldHealth.promise; }
            return healthy();
        }
        return response(auth(secondUser));
    } });
    const older = service.signIn(credentials, { signal: controller.signal });
    const rejected = assert.rejects(older, { code: 'REQUEST_ABORTED' });
    await delay(0);
    controller.abort();
    await rejected;
    assert.equal(oldSignal.aborted, true);
    assert.equal(service.connectionStatus, 'idle');
    await service.signIn({ email: secondUser.email, password: 'fixture other password' });
    oldHealth.reject(new TypeError('late old connection failure'));
    await delay(0);
    assert.equal(service.user.id, secondUser.id);
    assert.equal(service.connectionStatus, 'ready');
    assert.equal(calls.filter(url => url.endsWith('/login')).length, 1);
}

// The total connection budget bounds a transport that never settles; no password is submitted.
{
    const calls = [], started = Date.now();
    const service = new AccountService({ baseUrl, warmup: { ...timing, timeoutMs: 40, requestTimeoutMs: 12, retryDelayMs: 2 }, storage: storage(), fetchImpl: async url => {
        calls.push(url);
        return new Promise(() => {});
    } });
    await assert.rejects(service.signIn(credentials), { code: 'NETWORK_ERROR' });
    assert.ok(Date.now() - started < 500, 'Connection wait must remain bounded');
    assert.ok(calls.length >= 2);
    assert.ok(calls.every(url => url === baseUrl + '/system/health/live'));
    assert.equal(service.connectionStatus, 'error');
}

// Permanent health errors and malformed success envelopes stop immediately, retain the saved
// owner without cached staff authority, and never become an account 401 or submit refresh tokens.
for (const healthResponse of [response(null, 400), response(null, 401), response(null, 404), response(null, 500), response({ status: 'starting' })]) {
    const saved = storage(user), calls = [];
    const service = new AccountService({ baseUrl, warmup: timing, storage: saved, fetchImpl: async url => { calls.push(url); return healthResponse; } });
    assert.equal((await service.ready()).id, user.id);
    assert.equal(service.sessionOffline, true);
    assert.deepEqual(service.user.roles, []);
    assert.deepEqual(service.user.permissions, []);
    assert.equal(service.sessionError.code, 'BACKEND_UNAVAILABLE');
    assert.equal(service.sessionError.status, 0);
    assert.equal(calls.length, 1);
    assert.ok(saved.getItem(ACCOUNT_SESSION_KEY));
}

// Offline health failures also preserve the cached account scope and a later recovery rotates
// the refresh token once, before returning authenticated data.
{
    let online = false, refreshes = 0;
    const saved = storage(user), calls = [];
    const service = new AccountService({ baseUrl, warmup: { ...timing, timeoutMs: 25, retryDelayMs: 3 }, storage: saved, fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (!online) throw new TypeError('fixture offline');
        if (url.endsWith('/system/health/live')) return healthy();
        if (url.endsWith('/refresh')) { refreshes++; return response({ tokens: auth().tokens }); }
        if (url.endsWith('/me')) return response(user);
        return response({ owner: user.id });
    } });
    assert.equal((await service.ready()).id, user.id);
    assert.equal(service.sessionOffline, true);
    assert.equal(service.sessionError.code, 'NETWORK_ERROR');
    assert.ok(calls.every(call => call.url.endsWith('/system/health/live')));
    online = true;
    assert.deepEqual(await Promise.all([service.request('/v1/learner-state'), service.request('/v1/learner-state')]), [{ owner: user.id }, { owner: user.id }]);
    assert.equal(refreshes, 1);
    assert.equal(service.sessionOffline, false);
}

// A credential POST is never replayed after HTTP failure or a dropped response.
for (const failure of [() => response(null, 503), () => { throw new TypeError('response lost'); }]) {
    const calls = [];
    const service = new AccountService({ baseUrl, warmup: timing, storage: storage(), fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/system/health/live')) return healthy();
        return failure();
    } });
    await assert.rejects(service.signIn(credentials));
    assert.deepEqual(calls.map(call => call.options.method), ['GET', 'POST']);
}
{
    let refreshes = 0;
    const service = new AccountService({ baseUrl, warmup: timing, storage: storage(user), fetchImpl: async url => {
        if (url.endsWith('/system/health/live')) return healthy();
        assert.ok(url.endsWith('/refresh'));
        refreshes++;
        throw new TypeError('rotation response lost');
    } });
    assert.equal((await service.ready()).id, user.id);
    assert.equal(refreshes, 1);
    assert.equal(service.sessionOffline, true);
}

// A sign-out during preflight cancels the authentication intent before credentials are sent.
{
    const health = deferred(), calls = [];
    const service = new AccountService({ baseUrl, warmup: timing, storage: storage(), fetchImpl: async url => { calls.push(url); return health.promise; } });
    const login = service.signIn(credentials);
    const rejected = assert.rejects(login, { code: 'SESSION_CHANGED' });
    await service.signOut();
    health.resolve(healthy());
    await rejected;
    assert.deepEqual(calls, [baseUrl + '/system/health/live']);
    assert.equal(service.user, null);
}

// A cancellation racing a 401 response must not start an unnecessary token rotation.
{
    const controller = new AbortController(), calls = [];
    const service = new AccountService({ baseUrl, warmup: timing, storage: storage(), fetchImpl: async url => {
        calls.push(url);
        if (url.endsWith('/system/health/live')) return healthy();
        if (url.endsWith('/login')) return response(auth());
        controller.abort();
        return response(null, 401);
    } });
    await service.signIn(credentials);
    await assert.rejects(service.request('/v1/learner-state', { signal: controller.signal }), { code: 'REQUEST_ABORTED' });
    assert.equal(calls.some(url => url.endsWith('/refresh')), false);
}

// A body captured for one owner must be rejected after a delayed connection and account switch.
{
    const waiting = deferred(), calls = [];
    const service = new AccountService({ baseUrl, warmup: timing, storage: storage(), fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/system/health/live')) return healthy();
        return response(auth(JSON.parse(options.body).email === user.email ? user : secondUser));
    } });
    await service.signIn(credentials);
    const ensureConnection = service._ensureConnection.bind(service);
    let pause = true;
    service._ensureConnection = signal => {
        if (pause) { pause = false; return waiting.promise; }
        return ensureConnection(signal);
    };
    const oldWrite = service.request('/v1/learner-state', { method: 'PUT', body: { owner: user.id } });
    const rejected = assert.rejects(oldWrite, { code: 'SESSION_CHANGED' });
    await service.signIn({ email: secondUser.email, password: 'fixture other password' });
    waiting.resolve();
    await rejected;
    assert.equal(service.user.id, secondUser.id);
    assert.equal(calls.some(call => call.url.endsWith('/learner-state')), false);
}

// Browser status events contain only connection state, never URLs or authentication material.
{
    const originalDispatch = Object.getOwnPropertyDescriptor(globalThis, 'dispatchEvent');
    const originalEvent = Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent');
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const events = [], calls = [];
    Object.defineProperty(globalThis, 'dispatchEvent', { configurable: true, value: event => { events.push(event); return true; } });
    Object.defineProperty(globalThis, 'CustomEvent', { configurable: true, value: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });
    try {
        const service = new AccountService({ baseUrl, storage: storage(), fetchImpl: async url => { calls.push(url); return url.endsWith('/system/health/live') ? healthy() : response(auth()); } });
        await service.signIn(credentials);
        assert.deepEqual(calls, [baseUrl + '/system/health/live', baseUrl + '/v1/auth/login']);
        assert.deepEqual(events.map(event => [event.type, event.detail]), [
            [ACCOUNT_CONNECTION_EVENT, { status: 'connecting' }], [ACCOUNT_CONNECTION_EVENT, { status: 'ready' }],
        ]);
        const controller = new AbortController();
        const cancelled = new AccountService({ baseUrl, storage: storage(), fetchImpl: async () => { throw Error('Cancelled preflight must not fetch'); } });
        const pending = cancelled.signIn(credentials, { signal: controller.signal });
        const rejected = assert.rejects(pending, { code: 'REQUEST_ABORTED' });
        controller.abort();
        await rejected;
        assert.equal(cancelled.connectionStatus, 'idle');
    } finally {
        if (originalDispatch) Object.defineProperty(globalThis, 'dispatchEvent', originalDispatch); else delete globalThis.dispatchEvent;
        if (originalEvent) Object.defineProperty(globalThis, 'CustomEvent', originalEvent); else delete globalThis.CustomEvent;
        if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else delete globalThis.window;
    }
}

console.log('PASS lazy account readiness, bounded health retries, cancellation, credential POST safety, cached ownership and session races');
