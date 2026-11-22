import assert from 'node:assert/strict';
import { AccountService } from '../frontend/src/services/AccountService.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const saved = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
const baseUrl = 'https://fixture.example.test/api';
const secrets = ['private-login@example.test', 'private-password-value', 'private-access-value', 'private-refresh-value', 'private-profile-name', 'private-lesson-journal'];
const user = { id: 'private-owner-value', email: secrets[0], firstName: secrets[4] };
const credentials = { email: secrets[0], password: secrets[1] };
const auth = { user, tokens: { accessToken: secrets[2], refreshToken: secrets[3] } };
const uuid = '123e4567-e89b-42d3-a456-426614174000';
const response = (data, status = 200, requestId) => ({ ok: status < 400, status, json: async () => ({ success: status < 400, data, meta: { requestId }, message: secrets.join(' '), error: { code: secrets[0] } }) });
const allowed = ['clientBuild', 'operation', 'outcome', 'stage', 'connectionMs', 'authenticationMs', 'clientMs', 'totalMs', 'httpStatus', 'errorCode', 'requestId'];
const errorCodes = new Set([null, 'CANCELLED', 'TIMEOUT', 'NETWORK_ERROR', 'BACKEND_UNAVAILABLE', 'BACKEND_NOT_CONFIGURED', 'INVALID_RESPONSE', 'SESSION_CHANGED', 'INVALID_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'CONFLICT', 'RATE_LIMITED', 'SERVER_ERROR', 'REQUEST_FAILED']);
function privacy(report) {
    assert.ok(report);
    assert.ok(Object.isFrozen(report));
    assert.equal(report.clientBuild, 'timing-v1');
    assert.equal(report.operation, 'login');
    assert.deepEqual(Object.keys(report).sort(), allowed.filter(key => key !== 'requestId' || Object.hasOwn(report, key)).sort());
    assert.ok(Object.values(report).every(value => value === null || ['string', 'number'].includes(typeof value)));
    assert.ok(['pending', 'succeeded', 'failed', 'cancelled'].includes(report.outcome));
    assert.ok(['connection', 'authentication', 'complete'].includes(report.stage));
    assert.ok(errorCodes.has(report.errorCode));
    for (const key of ['connectionMs', 'authenticationMs', 'clientMs', 'totalMs']) assert.ok(Number.isFinite(report[key]) && report[key] >= 0);
    const text = JSON.stringify(report);
    for (const value of [...secrets, user.id, 'Authorization', 'password', 'accessToken', 'refreshToken', 'profile']) assert.equal(text.includes(value), false, value);
}

// A slow health wait and the actual authentication roundtrip remain separate.
{
    let clock = 100;
    const health = deferred(), login = deferred(), calls = [], events = [];
    const service = new AccountService({ baseUrl, storage: saved(), warmup: true, now: () => clock,
        fetchImpl: async url => { calls.push(url); if (url.endsWith('/live')) return health.promise; if (url.endsWith('/login')) return login.promise; return response({ note: secrets[5] }); } });
    service.subscribeLoginTiming(report => { events.push(report); });
    service.subscribeLoginTiming(() => { throw new Error('A diagnostic listener must not fail login'); });
    const pending = service.signIn(credentials);
    await tick();
    assert.equal(calls.length, 1);
    clock = 9100;
    assert.equal(service.loginTiming.stage, 'connection');
    assert.equal(service.loginTiming.connectionMs, 9000);
    assert.equal(service.loginTiming.authenticationMs, 0);
    health.resolve(response({ status: 'ok' }));
    await tick();
    assert.equal(service.loginTiming.stage, 'authentication');
    clock = 9300;
    service.subscribe(() => { clock += 7; });
    login.resolve(response(auth, 200, uuid));
    await pending;
    const report = service.getLoginTimingReport();
    assert.deepEqual({ connectionMs: report.connectionMs, authenticationMs: report.authenticationMs, clientMs: report.clientMs, totalMs: report.totalMs },
        { connectionMs: 9000, authenticationMs: 200, clientMs: 7, totalMs: 9207 });
    assert.equal(report.outcome, 'succeeded');
    assert.equal(report.requestId, uuid);
    assert.equal(report.httpStatus, 200);
    assert.equal(calls.length, 2, 'Diagnostics never adds another health or login request');
    assert.ok(events.every(Object.isFrozen));
    events.forEach(privacy); // Check outside callbacks: the service deliberately isolates observer errors.
    await service.request('/v1/learner-state');
    assert.deepEqual(service.getLoginTimingReport(), report, 'Snapshot data cannot replace the login trace');
    privacy(report);
}

// A warm connection can still have slow authentication; arbitrary backend text and IDs never escape.
for (const status of [200, 401, 503]) {
    let clock = 100;
    const login = deferred(), reports = [], calls = [];
    const service = new AccountService({ baseUrl, storage: saved(), warmup: false, now: () => clock,
        fetchImpl: async (url, options) => { calls.push({ url, method: options.method }); return login.promise; } });
    service.subscribeLoginTiming(report => { reports.push(report); });
    const pending = service.signIn(credentials);
    await tick(); clock = 9600;
    assert.equal(service.loginTiming.stage, 'authentication');
    assert.equal(service.loginTiming.authenticationMs, 9500);
    login.resolve(response(auth, status, secrets.join(' ')));
    if (status < 400) await pending; else await assert.rejects(pending);
    const report = service.getLoginTimingReport();
    assert.equal(report.connectionMs, 0);
    assert.equal(report.authenticationMs, 9500);
    assert.equal(report.httpStatus, status);
    assert.equal(report.errorCode, status === 401 ? 'UNAUTHORIZED' : status >= 500 ? 'SERVER_ERROR' : null);
    assert.equal(Object.hasOwn(report, 'requestId'), false);
    assert.deepEqual(calls, [{ url: baseUrl + '/v1/auth/login', method: 'POST' }], 'Login is never replayed after an HTTP failure');
    reports.forEach(privacy);
    privacy(report);
}

// User cancellation is not a watchdog timeout, even if the network throws a secret-bearing exception.
{
    let clock = 100;
    const controller = new AbortController();
    const service = new AccountService({ baseUrl, storage: saved(), warmup: false, now: () => clock,
        fetchImpl: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error(secrets.join(' '))), { once: true })) });
    const pending = service.signIn(credentials, { signal: controller.signal });
    await tick(); clock = 9300; controller.abort();
    await assert.rejects(pending, { code: 'REQUEST_ABORTED' });
    assert.equal(service.getLoginTimingReport().errorCode, 'CANCELLED');
    assert.equal(service.getLoginTimingReport().outcome, 'cancelled');
    assert.equal(service.user, null);
    privacy(service.getLoginTimingReport());
}

// Exercise the request's own watchdog without waiting twenty real seconds.
{
    const original = globalThis.setTimeout;
    let clock = 100, fireWatchdog;
    try {
        globalThis.setTimeout = (handler, timeout, ...args) => {
            if (timeout !== 20000) return original(handler, timeout, ...args);
            fireWatchdog = () => handler(...args);
            return undefined;
        };
        const service = new AccountService({ baseUrl, storage: saved(), warmup: false, now: () => clock,
            fetchImpl: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { clock = 20100; reject(new Error(secrets.join(' '))); }, { once: true })) });
        const pending = service.signIn(credentials);
        const rejected = assert.rejects(pending, { code: 'REQUEST_ABORTED' });
        await tick();
        assert.equal(typeof fireWatchdog, 'function');
        fireWatchdog();
        await rejected;
        assert.equal(service.getLoginTimingReport().errorCode, 'TIMEOUT');
        assert.equal(service.getLoginTimingReport().outcome, 'failed');
        assert.equal(service.getLoginTimingReport().authenticationMs, 20000);
        privacy(service.getLoginTimingReport());
    } finally { globalThis.setTimeout = original; }
}

// Old/cancelled requests cannot publish over a newer login or clear its session.
{
    const old = deferred(), controller = new AbortController(), reports = [];
    let clock = 100, count = 0;
    const service = new AccountService({ baseUrl, storage: saved(), warmup: false, now: () => clock,
        fetchImpl: async () => ++count === 1 ? old.promise : response(auth, 200, uuid) });
    service.subscribeLoginTiming(report => { reports.push(report); });
    const first = service.signIn(credentials, { signal: controller.signal });
    await tick(); clock = 9400;
    await service.signIn(credentials);
    const accepted = service.getLoginTimingReport(), eventCount = reports.length;
    controller.abort();
    clock = 15000; old.resolve(response(auth, 200, secrets[0]));
    await assert.rejects(first, { code: 'REQUEST_ABORTED' });
    assert.deepEqual(service.getLoginTimingReport(), accepted);
    assert.equal(reports.length, eventCount);
    assert.equal(service.user, user);
    reports.forEach(privacy);
}

// Signing out a pending login cancels its trace immediately, even if fetch ignores aborts.
{
    const login = deferred(), reports = [];
    let clock = 100;
    const service = new AccountService({ baseUrl, storage: saved(), warmup: false, now: () => clock, fetchImpl: async () => login.promise });
    service.subscribeLoginTiming(report => reports.push(report));
    const pending = service.signIn(credentials), rejected = assert.rejects(pending, { code: 'SESSION_CHANGED' });
    await tick(); clock = 8100;
    assert.deepEqual(await service.signOut(), { remoteRevoked: false });
    const cancelled = service.getLoginTimingReport(), eventCount = reports.length;
    assert.equal(cancelled.errorCode, 'CANCELLED');
    assert.equal(cancelled.outcome, 'cancelled');
    clock = 9100;
    login.resolve(response(auth, 200, uuid));
    await rejected;
    assert.equal(service.user, null);
    assert.deepEqual(service.getLoginTimingReport(), cancelled);
    assert.equal(reports.length, eventCount);
    reports.forEach(privacy);
}

// Request IDs are accepted only as complete UUIDs from response metadata.
for (const [requestId, accepted] of [
    [uuid, true], [uuid.toUpperCase(), true],
    [undefined, false], [null, false], [42, false], [{ requestId: uuid }, false],
    [secrets[0], false], [uuid + '\n', false], [' ' + uuid, false],
    ['123e4567-e89b-02d3-a456-426614174000', false],
    ['123e4567-e89b-92d3-a456-426614174000', false],
    ['123e4567-e89b-42d3-c456-426614174000', false],
]) {
    let calls = 0;
    const service = new AccountService({ baseUrl, storage: saved(), warmup: false, now: () => 100,
        fetchImpl: async () => {
            calls++;
            return { ...response(auth, 200, requestId), headers: { get: () => uuid } };
        } });
    await service.signIn(credentials);
    const report = service.getLoginTimingReport();
    assert.equal(Object.hasOwn(report, 'requestId'), accepted);
    if (accepted) assert.equal(report.requestId, requestId);
    assert.equal(calls, 1);
    privacy(report);
}

// Internal timing callbacks also expose a fixed schema, and cannot fail the request.
{
    let clock = 100;
    const events = [], calls = [];
    const service = new AccountService({ baseUrl, storage: saved(), warmup: false, now: () => clock,
        fetchImpl: async (url, options) => {
            calls.push({ url, method: options.method });
            clock += 37;
            return response(auth, 200, uuid);
        } });
    const options = { method: 'POST', body: credentials, auth: false };
    assert.deepEqual(await service._send('/v1/auth/login', { ...options, onTiming: event => events.push(event) }), auth);
    assert.deepEqual(events, [{ type: 'start' }, { type: 'end', durationMs: 37, httpStatus: 200, requestId: uuid, timedOut: false }]);
    assert.deepEqual(await service._send('/v1/auth/login', { ...options, onTiming: () => { throw Error(secrets.join(' ')); } }), auth);
    assert.equal(calls.length, 2, 'Each explicit request is sent once despite observer failures');
    assert.equal(service.getLoginTimingReport(), null, 'Unrelated requests cannot create a login trace');
}

// Backend codes/messages and raw network errors become a small, stable diagnostic vocabulary.
for (const [status, expected] of [[400, 'INVALID_REQUEST'], [403, 'FORBIDDEN'], [409, 'CONFLICT'], [429, 'RATE_LIMITED'], [418, 'REQUEST_FAILED'], [500, 'SERVER_ERROR'], [null, 'NETWORK_ERROR']]) {
    let calls = 0;
    const reports = [];
    const service = new AccountService({ baseUrl, storage: saved(), warmup: false, now: () => 100,
        fetchImpl: async () => {
            calls++;
            if (status === null) throw new Error(secrets.join(' '));
            return response(null, status, secrets[0]);
        } });
    service.subscribeLoginTiming(report => reports.push(report));
    await assert.rejects(service.signIn(credentials));
    assert.equal(service.getLoginTimingReport().errorCode, expected);
    assert.equal(calls, 1);
    reports.forEach(privacy);
}

// A newer login owns the pending trace before either response has completed.
{
    const older = deferred(), newer = deferred(), reports = [], calls = [];
    const newUser = { ...user, id: 'private-new-owner-value' };
    const newAuth = { user: newUser, tokens: { accessToken: 'new-' + secrets[2], refreshToken: 'new-' + secrets[3] } };
    let clock = 100, logins = 0;
    const service = new AccountService({ baseUrl, storage: saved(), warmup: false, now: () => clock,
        fetchImpl: async (url, options) => {
            calls.push({ url, method: options.method });
            if (url.endsWith('/login')) return ++logins === 1 ? older.promise : newer.promise;
            assert.equal(options.headers.Authorization, 'Bearer ' + newAuth.tokens.accessToken);
            return response({ owner: newUser.id });
        } });
    service.subscribeLoginTiming(report => reports.push(report));
    const first = service.signIn(credentials), rejected = assert.rejects(first, { code: 'SESSION_CHANGED' });
    await tick(); clock = 400;
    const second = service.signIn(credentials);
    await tick();
    const current = service.getLoginTimingReport(), eventCount = reports.length;
    clock = 800; older.resolve(response(auth, 200, uuid));
    await rejected;
    assert.equal(service.getLoginTimingReport().outcome, 'pending');
    assert.equal(service.getLoginTimingReport().stage, current.stage);
    assert.equal(reports.length, eventCount, 'A superseded response cannot publish a current-trace event');
    newer.resolve(response(newAuth, 200, uuid));
    await second;
    const accepted = service.getLoginTimingReport();
    assert.equal(accepted.totalMs, 400);
    assert.equal(service.user, newUser);
    assert.deepEqual(await service.request('/v1/learner-state'), { owner: newUser.id });
    assert.deepEqual(service.getLoginTimingReport(), accepted);
    assert.deepEqual(calls.map(call => call.method), ['POST', 'POST', 'GET']);
    reports.forEach(privacy);
}

// Late sign-out success or failure cannot replace a new login's trace or identity.
for (const fails of [false, true]) {
    const logout = deferred(), reports = [], calls = [];
    const newUser = { ...user, id: 'private-new-owner-value' };
    const newAuth = { user: newUser, tokens: { accessToken: 'new-' + secrets[2], refreshToken: 'new-' + secrets[3] } };
    let clock = 100, logins = 0;
    const service = new AccountService({ baseUrl, storage: saved(), warmup: false, now: () => clock,
        fetchImpl: async (url, options) => {
            calls.push({ url, method: options.method });
            if (url.endsWith('/logout-current')) {
                assert.equal(options.headers.Authorization, 'Bearer ' + auth.tokens.accessToken);
                return logout.promise;
            }
            if (url.endsWith('/login')) return response(++logins === 1 ? auth : newAuth, 200, uuid);
            assert.equal(options.headers.Authorization, 'Bearer ' + newAuth.tokens.accessToken);
            return response({ owner: newUser.id });
        } });
    service.subscribeLoginTiming(report => reports.push(report));
    await service.signIn(credentials);
    const pending = service.signOut();
    const settled = fails ? assert.rejects(pending, { code: 'NETWORK_ERROR' }) : pending;
    assert.equal(service.user, null);
    clock = 500;
    await service.signIn(credentials);
    const accepted = service.getLoginTimingReport(), eventCount = reports.length;
    clock = 9000;
    if (fails) logout.reject(new Error(secrets.join(' '))); else logout.resolve(response({ done: true }));
    await settled;
    assert.deepEqual(service.getLoginTimingReport(), accepted);
    assert.equal(reports.length, eventCount);
    assert.equal(service.user, newUser);
    assert.deepEqual(await service.request('/v1/learner-state'), { owner: newUser.id });
    assert.deepEqual(calls.map(call => call.method), ['POST', 'POST', 'POST', 'GET']);
    reports.forEach(privacy);
}

console.log('PASS login timing separates connection/authentication, redacts all private data, classifies aborts and preserves auth races');
