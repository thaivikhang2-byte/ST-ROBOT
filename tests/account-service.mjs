import assert from 'node:assert/strict';
import { AccountService, ACCOUNT_SESSION_KEY, ACCOUNT_LOGOUT_CHANNEL } from '../frontend/src/services/AccountService.js';
import { BACKEND_CONFIG, resolveBackendUrl } from '../frontend/src/config/backend.config.js';

const store = () => {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => status < 400 ? { success: true, data } : { success: false, message: 'Rejected', error: { code: 'UNAUTHORIZED' } } });
const user = { id: 'learner-one', email: 'learner@example.test', firstName: 'Learner', isEmailVerified: true };
const auth = (accessToken, refreshToken) => ({ user, tokens: { accessToken, refreshToken, expiresIn: '15m' } });
const baseUrl = 'https://account.example.test/api';
const secondUser = { ...user, id: 'learner-two', email: 'second@example.test' };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const secondAuth = () => ({ user: secondUser, tokens: { accessToken: 'access-two', refreshToken: 'refresh-two', expiresIn: '15m' } });
const logoutHub = () => {
    const channels = [], pending = [], sent = [];
    return {
        sent,
        create: () => {
            const listeners = new Set();
            const channel = {
                addEventListener: (type, listener) => { if (type === 'message') listeners.add(listener); },
                postMessage: data => { sent.push(structuredClone(data)); pending.push({ sender: channel, data: structuredClone(data) }); },
                receive: data => { for (const listener of listeners) listener({ data: structuredClone(data) }); },
            };
            channels.push(channel); return channel;
        },
        flush: () => { for (const { sender, data } of pending.splice(0)) for (const channel of channels) if (channel !== sender) channel.receive(data); },
        inject: data => { for (const channel of channels) channel.receive(data); },
    };
};

assert.equal(resolveBackendUrl('', 'thaivikhang2-byte.github.io'), '');
assert.equal(resolveBackendUrl('', 'localhost'), 'http://localhost:3000/api');
assert.equal(resolveBackendUrl(undefined, 'thaivikhang2-byte.github.io'), BACKEND_CONFIG.apiBaseUrl);
for (const host of ['localhost', '127.0.0.1', '[::1]', '::1'])
    assert.equal(resolveBackendUrl(undefined, host), 'http://localhost:3000/api');
assert.equal(resolveBackendUrl(baseUrl, 'localhost'), baseUrl);
assert.equal(resolveBackendUrl('http://untrusted.test/api'), '');
assert.equal(resolveBackendUrl('https://person:secret@example.test/api'), '');
assert.equal(resolveBackendUrl('https://example.test/api?key=secret'), '');
assert.equal(resolveBackendUrl(baseUrl + '/'), baseUrl);

// Tokens stay out of localStorage; only a server-bound refresh token is retained.
{
    const storage = store(), calls = [];
    const service = new AccountService({ baseUrl, storage, fetchImpl: async (url, options) => { calls.push({ url, options }); return response(auth('access-one', 'refresh-one')); } });
    assert.equal(await service.ready(), null);
    await service.signIn({ email: user.email, password: 'fixture password' });
    assert.equal(service.user, user);
    assert.equal(calls[0].options.headers.Authorization, undefined);
    assert.equal(calls[0].options.credentials, 'omit');
    const saved = JSON.parse(storage.getItem(ACCOUNT_SESSION_KEY));
    assert.deepEqual(saved, { version: 1, baseUrl, refreshToken: 'refresh-one', profile: { id: user.id, email: user.email, firstName: user.firstName, isEmailVerified: true } });
    assert.equal(JSON.stringify(saved).includes('access-one'), false);
    assert.equal(JSON.stringify(saved).includes('fixture password'), false);
    await assert.rejects(service.request('https://other.example.test/steal'), { code: 'INVALID_API_PATH' });
    assert.equal(calls.length, 1);
    const otherServer = new AccountService({ baseUrl: 'https://other.example.test/api', storage, fetchImpl: () => { throw Error('Must not send another server token'); } });
    assert.equal(await otherServer.ready(), null);
}

// Failed API calls retain only a validated request UUID for private support correlation.
{
    const requestId = '123e4567-e89b-42d3-a456-426614174000';
    const privateValue = 'fixture-private-provider-secret';
    for (const candidate of [requestId, privateValue, { value: requestId }, null]) {
        const storage = store();
        let posts = 0;
        const service = new AccountService({ baseUrl, storage, fetchImpl: async url => {
            if (url.endsWith('/login')) return response(auth('access-one', 'refresh-one'));
            posts++;
            return { ok: false, status: 503, json: async () => ({ success: false,
                message: 'AI connection rejected', error: { code: 'AI_PROVIDER_AUTH_FAILED' },
                meta: { requestId: candidate, providerSecret: privateValue } }) };
        } });
        await service.signIn({ email: user.email, password: 'fixture password' });
        await assert.rejects(service.request('/v1/ai/agent/chat', { method: 'POST', body: { message: 'Fixture' } }), error => {
            assert.equal(error.code, 'AI_PROVIDER_AUTH_FAILED');
            assert.equal(error.status, 503);
            assert.equal(error.requestId, candidate === requestId ? requestId : undefined);
            assert.equal(JSON.stringify(error).includes(privateValue), false);
            return true;
        });
        assert.equal(posts, 1, 'Provider auth failure must not replay the question');
        assert.equal(JSON.stringify(storage.getItem(ACCOUNT_SESSION_KEY)).includes(requestId), false);
    }
}

// Concurrent expired requests use one refresh; retries receive the rotated token.
{
    const storage = store(); let refreshCalls = 0;
    const service = new AccountService({ baseUrl, storage, fetchImpl: async (url, options) => {
        if (url.endsWith('/login')) return response(auth('expired-access', 'refresh-one'));
        if (url.endsWith('/refresh')) {
            refreshCalls++;
            await new Promise(resolve => setTimeout(resolve, 15));
            return response({ tokens: auth('fresh-access', 'refresh-two').tokens });
        }
        assert.equal(url, baseUrl + '/v1/learner-state');
        return options.headers.Authorization === 'Bearer fresh-access' ? response({ revision: 1 }) : response(null, 401);
    } });
    await service.signIn({ email: user.email, password: 'fixture password' });
    const values = await Promise.all([service.request('/v1/learner-state'), service.request('/v1/learner-state'), service.request('/v1/learner-state')]);
    assert.equal(refreshCalls, 1);
    assert.deepEqual(values, [{ revision: 1 }, { revision: 1 }, { revision: 1 }]);
    assert.equal(JSON.parse(storage.getItem(ACCOUNT_SESSION_KEY)).refreshToken, 'refresh-two');
}

// A late 401 for the old token does not rotate the new refresh token a second time.
{
    let refreshCalls = 0, oldRequests = 0;
    const service = new AccountService({ baseUrl, storage: store(), fetchImpl: async (url, options) => {
        if (url.endsWith('/login')) return response(auth('expired-access', 'refresh-one'));
        if (url.endsWith('/refresh')) { refreshCalls++; return response({ tokens: auth('fresh-access', 'refresh-two').tokens }); }
        if (options.headers.Authorization === 'Bearer expired-access') {
            if (++oldRequests === 2) await new Promise(resolve => setTimeout(resolve, 20));
            return response(null, 401);
        }
        return response({ ok: true });
    } });
    await service.signIn({ email: user.email, password: 'fixture password' });
    await Promise.all([service.request('/v1/learner-state'), service.request('/v1/learner-state')]);
    assert.equal(refreshCalls, 1);
}

// Restoring a session is single-flight; failed authorization clears stored state.
{
    const storage = store(); storage.setItem(ACCOUNT_SESSION_KEY, JSON.stringify({ version: 1, baseUrl, refreshToken: 'refresh-one' }));
    let calls = 0;
    const service = new AccountService({ baseUrl, storage, fetchImpl: async url => { calls++; return url.endsWith('/refresh') ? response({ tokens: auth('fresh-access', 'refresh-two').tokens }) : response(user); } });
    assert.deepEqual(await Promise.all([service.ready(), service.ready()]), [user, user]);
    assert.equal(calls, 2);
    const rejected = new AccountService({ baseUrl, storage, fetchImpl: async () => response(null, 401) });
    assert.equal(await rejected.ready(), null);
    assert.equal(storage.getItem(ACCOUNT_SESSION_KEY), null);
}

// Responses from a revoked browser identity cannot become another account's data.
{
    let resolvePending;
    const pending = new Promise(resolve => { resolvePending = resolve; });
    const storage = store();
    const service = new AccountService({ baseUrl, storage, fetchImpl: async url => {
        if (url.endsWith('/login')) return response(auth('access-one', 'refresh-one'));
        if (url.endsWith('/logout-current')) return response({ message: 'Done' });
        return pending;
    } });
    await service.signIn({ email: user.email, password: 'fixture password' });
    const read = service.request('/v1/learner-state');
    await service.signOut();
    resolvePending(response({ private: 'old identity' }));
    await assert.rejects(read, { code: 'SESSION_CHANGED' });
    assert.equal(service.user, null);
    assert.equal(storage.getItem(ACCOUNT_SESSION_KEY), null);
}

// Network failure on sign-out still removes the browser identity.
{
    let online = true;
    const storage = store();
    const service = new AccountService({ baseUrl, storage, fetchImpl: async () => { if (!online) throw Error('offline'); return response(auth('access-one', 'refresh-one')); } });
    await service.signIn({ email: user.email, password: 'fixture password' }); online = false;
    await assert.rejects(service.signOut(), { code: 'NETWORK_ERROR' });
    assert.equal(service.user, null);
    assert.equal(storage.getItem(ACCOUNT_SESSION_KEY), null);
}

// Offline startup keeps work in the last confirmed account, without cached staff authority.
{
    const storage = store(); let online = true;
    const fetchImpl = async url => {
        if (!online) throw Error('offline');
        if (url.endsWith('/login')) return response(auth('access-one', 'refresh-one'));
        if (url.endsWith('/refresh')) return response({ tokens: auth('access-two', 'refresh-two').tokens });
        if (url.endsWith('/me')) return response(user);
        return response({ revision: 3 });
    };
    const first = new AccountService({ baseUrl, storage, fetchImpl });
    await first.signIn({ email: user.email, password: 'fixture password' });
    online = false;
    const restored = new AccountService({ baseUrl, storage, fetchImpl });
    assert.equal((await restored.ready()).id, user.id);
    assert.equal(restored.sessionOffline, true);
    assert.deepEqual(restored.user.permissions, []);
    assert.deepEqual(restored.user.roles, []);
    online = true;
    assert.deepEqual(await restored.request('/v1/learner-state'), { revision: 3 });
    assert.equal(restored.sessionOffline, false);
    assert.equal(restored.user, user);
}

// Latest explicit authentication intent wins even if the older response arrives last.
{
    const first = deferred();
    const service = new AccountService({ baseUrl, storage: store(), fetchImpl: async (url, options) => {
        if (url.endsWith('/login') && JSON.parse(options.body).email === user.email) return first.promise;
        if (url.endsWith('/register')) return response(secondAuth());
        assert.equal(options.headers.Authorization, 'Bearer access-two');
        return response({ owner: secondUser.id });
    } });
    const older = service.signIn({ email: user.email, password: 'fixture password' });
    const rejected = assert.rejects(older, { code: 'SESSION_CHANGED' });
    await service.register({ email: secondUser.email, password: 'fixture password', firstName: 'Second', lastName: 'Learner' });
    first.resolve(response(auth('access-one', 'refresh-one')));
    await rejected;
    assert.equal(service.user.id, secondUser.id);
    assert.deepEqual(await service.request('/v1/learner-state'), { owner: secondUser.id });
}

// Logout clears immediately; its delayed completion cannot remove a newer login.
{
    const logout = deferred();
    const storage = store();
    const service = new AccountService({ baseUrl, storage, fetchImpl: async (url, options) => {
        if (url.endsWith('/login')) return response(JSON.parse(options.body).email === user.email ? auth('access-one', 'refresh-one') : secondAuth());
        if (url.endsWith('/logout-current')) { assert.equal(options.headers.Authorization, 'Bearer access-one'); return logout.promise; }
        assert.equal(options.headers.Authorization, 'Bearer access-two'); return response({ owner: secondUser.id });
    } });
    await service.signIn({ email: user.email, password: 'fixture password' });
    const older = service.signOut();
    assert.equal(service.user, null);
    assert.equal(storage.getItem(ACCOUNT_SESSION_KEY), null);
    await service.signIn({ email: secondUser.email, password: 'fixture password' });
    logout.resolve(response({ message: 'Old session revoked' }));
    await older;
    assert.equal(service.user, secondUser);
    assert.deepEqual(await service.request('/v1/learner-state'), { owner: secondUser.id });
}

// Consumers must recheck generation after request() resolves, before assigning profile state.
{
    const service = new AccountService({ baseUrl, storage: store(), fetchImpl: async (url, options) => {
        if (url.endsWith('/login')) return response(JSON.parse(options.body).email === user.email ? auth('access-one', 'refresh-one') : secondAuth());
        return response(user);
    } });
    await service.signIn({ email: user.email, password: 'fixture password' });
    const original = service.request.bind(service);
    service.request = async (...args) => {
        const oldProfile = await original(...args);
        await service.signIn({ email: secondUser.email, password: 'fixture password' });
        return oldProfile;
    };
    await assert.rejects(service.reloadProfile(), { code: 'SESSION_CHANGED' });
    assert.equal(service.user, secondUser);
}

// Session restoration has the same consumer-side guard; it returns the newer identity.
{
    const storage = store(); storage.setItem(ACCOUNT_SESSION_KEY, JSON.stringify({ version: 1, baseUrl, refreshToken: 'refresh-one' }));
    const service = new AccountService({ baseUrl, storage, fetchImpl: async url => {
        if (url.endsWith('/refresh')) return response({ tokens: auth('access-one', 'refresh-one').tokens });
        if (url.endsWith('/login')) return response(secondAuth());
        return response(user);
    } });
    const original = service.request.bind(service);
    service.request = async (...args) => {
        const oldProfile = await original(...args);
        await service.signIn({ email: secondUser.email, password: 'fixture password' });
        return oldProfile;
    };
    assert.equal(await service.ready(), secondUser);
    assert.equal(service.user, secondUser);
}

// A late offline failure cannot restore an old cached identity over a newer login.
{
    const refresh = deferred(), storage = store();
    storage.setItem(ACCOUNT_SESSION_KEY, JSON.stringify({ version: 1, baseUrl, refreshToken: 'refresh-one', profile: user }));
    const service = new AccountService({ baseUrl, storage, fetchImpl: async url => url.endsWith('/refresh') ? refresh.promise : response(secondAuth()) });
    const oldRestore = service.ready();
    await service.signIn({ email: secondUser.email, password: 'fixture password' });
    refresh.reject(Error('offline old session'));
    assert.equal(await oldRestore, secondUser);
    assert.equal(service.user, secondUser);
    assert.equal(service.sessionOffline, false);
}

// Cancelling a still-pending login must not resurrect the account on response.
{
    const login = deferred(), storage = store();
    const service = new AccountService({ baseUrl, storage, fetchImpl: async () => login.promise });
    const pending = service.signIn({ email: user.email, password: 'fixture password' });
    const rejected = assert.rejects(pending, { code: 'SESSION_CHANGED' });
    assert.deepEqual(await service.signOut(), { remoteRevoked: false });
    login.resolve(response(auth('access-one', 'refresh-one')));
    await rejected;
    assert.equal(service.user, null);
    assert.equal(storage.getItem(ACCOUNT_SESSION_KEY), null);
}

// A successful old refresh cannot install its rotated tokens over another login.
{
    const refresh = deferred(), storage = store();
    const service = new AccountService({ baseUrl, storage, fetchImpl: async (url, options) => {
        if (url.endsWith('/login')) return response(JSON.parse(options.body).email === user.email ? auth('expired-one', 'refresh-one') : secondAuth());
        if (url.endsWith('/refresh')) return refresh.promise;
        if (options.headers.Authorization === 'Bearer expired-one') return response(null, 401);
        assert.equal(options.headers.Authorization, 'Bearer access-two');
        return response({ owner: secondUser.id });
    } });
    await service.signIn({ email: user.email, password: 'fixture password' });
    const oldRead = service.request('/v1/learner-state');
    const rejected = assert.rejects(oldRead, { code: 'SESSION_CHANGED' });
    // Let the first 401 start its refresh before switching browser identity.
    await new Promise(resolve => setTimeout(resolve, 0));
    await service.signIn({ email: secondUser.email, password: 'fixture password' });
    refresh.resolve(response({ tokens: auth('rotated-old-access', 'rotated-old-refresh').tokens }));
    await rejected;
    assert.equal(service.user, secondUser);
    assert.equal(JSON.parse(storage.getItem(ACCOUNT_SESSION_KEY)).refreshToken, 'refresh-two');
    assert.deepEqual(await service.request('/v1/learner-state'), { owner: secondUser.id });
}

// A fresh profile returned by refresh avoids a redundant /me and replaces cached authority.
{
    const storage = store(), calls = [];
    const freshUser = { ...user, firstName: 'Fresh', roles: [], permissions: ['learning:read'] };
    storage.setItem(ACCOUNT_SESSION_KEY, JSON.stringify({ version: 1, baseUrl, refreshToken: 'refresh-one', profile: { ...user, roles: ['ADMIN'] } }));
    const service = new AccountService({ baseUrl, storage, fetchImpl: async url => {
        calls.push(url);
        assert.equal(url, baseUrl + '/v1/auth/refresh');
        return response({ tokens: auth('fresh-access', 'fresh-refresh').tokens, user: freshUser });
    } });
    assert.equal(await service.ready(), freshUser);
    assert.equal(service.user, freshUser);
    assert.deepEqual(service.user.permissions, ['learning:read']);
    assert.equal(service.sessionOffline, false);
    assert.equal(calls.length, 1);
    assert.equal(JSON.parse(storage.getItem(ACCOUNT_SESSION_KEY)).refreshToken, 'fresh-refresh');
}

// A malformed or different-owner profile cannot install its rotated refresh tokens.
for (const invalidUser of [secondUser, { email: user.email }, { ...user, id: 42 }]) {
    const storage = store();
    storage.setItem(ACCOUNT_SESSION_KEY, JSON.stringify({ version: 1, baseUrl, refreshToken: 'refresh-one', profile: user }));
    const service = new AccountService({ baseUrl, storage, fetchImpl: async () => response({ tokens: auth('wrong-access', 'wrong-refresh').tokens, user: invalidUser }) });
    await assert.rejects(service._refresh(), { code: 'INVALID_RESPONSE' });
    assert.equal(service.user, null);
    assert.equal(service._accessToken, '');
    assert.equal(JSON.parse(storage.getItem(ACCOUNT_SESSION_KEY)).refreshToken, 'refresh-one');
}

// Fresh refresh identity recovers an offline owner without adding another profile round trip.
{
    const storage = store(), calls = [];
    storage.setItem(ACCOUNT_SESSION_KEY, JSON.stringify({ version: 1, baseUrl, refreshToken: 'refresh-one', profile: user }));
    let online = false;
    const service = new AccountService({ baseUrl, storage, fetchImpl: async url => {
        calls.push(url);
        if (!online) throw new TypeError('fixture offline');
        if (url.endsWith('/refresh')) return response({ tokens: auth('fresh-access', 'fresh-refresh').tokens, user });
        assert.equal(url, baseUrl + '/v1/learner-state');
        return response({ owner: user.id });
    } });
    assert.equal((await service.ready()).id, user.id);
    assert.equal(service.sessionOffline, true);
    assert.deepEqual(service.user.roles, []);
    online = true;
    assert.deepEqual(await service.request('/v1/learner-state'), { owner: user.id });
    assert.equal(service.sessionOffline, false);
    assert.equal(calls.filter(url => url.endsWith('/refresh')).length, 2);
    assert.equal(calls.some(url => url.endsWith('/me')), false);
}

// A late profile-bearing refresh cannot replace a newer explicit login.
{
    const refresh = deferred(), storage = store();
    storage.setItem(ACCOUNT_SESSION_KEY, JSON.stringify({ version: 1, baseUrl, refreshToken: 'refresh-one', profile: user }));
    const service = new AccountService({ baseUrl, storage, fetchImpl: async url => url.endsWith('/refresh') ? refresh.promise : response(secondAuth()) });
    const oldRestore = service.ready();
    await service.signIn({ email: secondUser.email, password: 'fixture password' });
    refresh.resolve(response({ tokens: auth('rotated-old-access', 'rotated-old-refresh').tokens, user }));
    assert.equal(await oldRestore, secondUser);
    assert.equal(service.user, secondUser);
    assert.equal(JSON.parse(storage.getItem(ACCOUNT_SESSION_KEY)).refreshToken, 'refresh-two');
}

// Logout is immediately shared with matching browser tabs, without credentials or API replay.
{
    const hub = logoutHub(), calls = [], logout = deferred(); let clock = 100;
    const make = (profile, server = baseUrl) => new AccountService({ baseUrl: server, storage: store(),
        logoutChannelFactory: hub.create, now: () => clock, fetchImpl: async (url, options) => {
            calls.push({ url, options });
            if (url.endsWith('/login')) return response({ user: profile, tokens: auth('access-private', 'refresh-private').tokens });
            assert.equal(url, baseUrl + '/v1/auth/logout-current'); return logout.promise;
        } });
    const first = make(user), same = make(user), foreignOwner = make(secondUser), foreignServer = make(user, 'https://other.example.test/api');
    await Promise.all([first, same, foreignOwner, foreignServer].map(service => service.signIn({ email: 'private@example.test', password: 'private-password' })));
    assert.equal(hub.sent.length, 0, 'Login/profile information is never broadcast');
    let notifications = 0; same.subscribe(profile => { assert.equal(profile, null); notifications++; });
    clock = 200;
    const signingOut = first.signOut();
    assert.equal(first.user, null);
    assert.deepEqual(hub.sent, [{ version: 1, type: 'logout', baseUrl, ownerId: user.id, issuedAt: clock }]);
    hub.flush();
    assert.equal(same.user, null); assert.equal(notifications, 1);
    assert.equal(same.storage.getItem(ACCOUNT_SESSION_KEY), null);
    assert.equal(foreignOwner.user.id, secondUser.id); assert.equal(foreignServer.user.id, user.id);
    assert.equal(hub.sent.length, 1, 'Receivers do not echo logout');
    await Promise.resolve();
    assert.equal(calls.filter(call => !call.url.endsWith('/login')).length, 1, 'Only the initiating tab revokes its captured session');
    for (const secret of ['access-private', 'refresh-private', 'private@example.test', 'private-password', 'email', 'tokens'])
        assert.equal(JSON.stringify(hub.sent).includes(secret), false);
    logout.resolve(response({ message: 'Done' })); await signingOut;
    await same.signOut(); assert.equal(hub.sent.length, 1, 'An already signed-out guest does not broadcast');
}

// Remote-tab logout invalidates a restoring refresh and an offline cached identity.
for (const offline of [false, true]) {
    const hub = logoutHub(), pending = deferred(), saved = store(); let clock = 100;
    saved.setItem(ACCOUNT_SESSION_KEY, JSON.stringify({ version: 1, baseUrl, refreshToken: 'saved-private-refresh', profile: user }));
    const calls = [];
    const restored = new AccountService({ baseUrl, storage: saved, logoutChannelFactory: hub.create, now: () => clock,
        fetchImpl: async url => { calls.push(url); if (offline) throw Error('fixture offline'); return pending.promise; } });
    const ready = restored.ready();
    if (offline) { assert.equal((await ready).id, user.id); assert.equal(restored.sessionOffline, true); }
    const source = new AccountService({ baseUrl, storage: store(), logoutChannelFactory: hub.create, now: () => clock,
        fetchImpl: async () => response(auth('source-access', 'source-refresh')) });
    await source.signIn({ email: user.email, password: 'fixture password' });
    clock = 200;
    await source.signOutEverywhere(); hub.flush();
    assert.equal(restored.user, null); assert.equal(restored._cachedUser, null); assert.equal(restored.sessionOffline, false);
    assert.equal(saved.getItem(ACCOUNT_SESSION_KEY), null);
    if (!offline) { pending.resolve(response({ user, tokens: auth('late-access', 'late-refresh').tokens })); assert.equal(await ready, null); }
    assert.equal(restored.user, null); assert.equal(saved.getItem(ACCOUNT_SESSION_KEY), null);
    assert.deepEqual(calls, [baseUrl + '/v1/auth/refresh'], 'Receiving logout never sends a revocation or replay');
    assert.equal(hub.sent.length, 1);
}

// A queued old logout cannot clear a newer login, including its still-pending response.
for (const pendingLogin of [false, true]) {
    const hub = logoutHub(), pending = deferred(); let clock = 100, logins = 0;
    const service = new AccountService({ baseUrl, storage: store(), logoutChannelFactory: hub.create, now: () => clock,
        fetchImpl: async () => ++logins === 2 && pendingLogin ? pending.promise : response(auth('current-access', 'current-refresh')) });
    await service.signIn({ email: user.email, password: 'fixture password' });
    clock = 300;
    const newerLogin = service.signIn({ email: user.email, password: 'new fixture password' });
    if (!pendingLogin) await newerLogin;
    clock = 400;
    hub.inject({ version: 1, type: 'logout', baseUrl, ownerId: user.id, issuedAt: 200 });
    assert.equal(service.user.id, user.id);
    if (pendingLogin) pending.resolve(response(auth('new-access', 'new-refresh')));
    await newerLogin; assert.equal(service.user.id, user.id);
}

// Reject stale, future, malformed, different-owner and different-backend signals.
{
    const hub = logoutHub(); let clock = 1000000;
    const service = new AccountService({ baseUrl, storage: store(), logoutChannelFactory: hub.create, now: () => clock,
        fetchImpl: async () => response(auth('access-one', 'refresh-one')) });
    await service.signIn({ email: user.email, password: 'fixture password' }); clock += 400001;
    const message = { version: 1, type: 'logout', baseUrl, ownerId: user.id, issuedAt: clock };
    for (const invalid of [null, [], {}, { ...message, type: 'login' }, { ...message, version: 2 },
        { ...message, issuedAt: clock - 300001 }, { ...message, issuedAt: clock + 30001 }, { ...message, issuedAt: NaN },
        { ...message, ownerId: '../invalid' }, { ...message, ownerId: secondUser.id },
        { ...message, baseUrl: 'https://other.example.test/api' }, { ...message, accessToken: 'do-not-accept' }]) {
        hub.inject(invalid); assert.equal(service.user.id, user.id);
    }
    hub.inject(message); assert.equal(service.user, null); assert.equal(hub.sent.length, 0);
}

// Browsers without BroadcastChannel use a same-origin storage event containing no session data.
{
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), tabs = [], events = [];
    const browserTab = unavailable => {
        const listeners = new Set();
        const tab = { document: {}, location: { origin: 'https://frontend.example.test' },
            addEventListener: (type, listener) => { if (type === 'storage') listeners.add(listener); },
            receive: (key, value) => { for (const listener of listeners) listener({ storageArea: tab.localStorage, key, newValue: value }); } };
        tab.localStorage = {
            setItem: (key, value) => { events.push({ key, value }); for (const other of tabs) if (other !== tab) other.receive(key, value); },
            removeItem: key => { for (const other of tabs) if (other !== tab) other.receive(key, null); },
        };
        if (unavailable) tab.BroadcastChannel = class { constructor() { throw Error('Channel disabled'); } };
        tabs.push(tab); return tab;
    };
    try {
        const services = [];
        for (let index = 0; index < 2; index++) {
            Object.defineProperty(globalThis, 'window', { configurable: true, value: browserTab(index === 1) });
            services.push(new AccountService({ baseUrl, storage: store(), warmup: false,
                fetchImpl: async () => response(auth('private-access', 'private-refresh')) }));
        }
        await Promise.all(services.map(service => service.signIn({ email: user.email, password: 'fixture password' })));
        await services[0].signOutEverywhere();
        assert.equal(services[1].user, null); assert.equal(events.length, 1);
        assert.equal(events[0].key, ACCOUNT_LOGOUT_CHANNEL);
        assert.deepEqual(Object.keys(JSON.parse(events[0].value)).sort(), ['baseUrl', 'issuedAt', 'ownerId', 'type', 'version']);
        assert.equal(events[0].value.includes('private-'), false);
    } finally {
        if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else delete globalThis.window;
    }
}

console.log('PASS account sessions, refresh/auth races, offline restoration and owner-bound cross-tab logout without credentials or replay');
