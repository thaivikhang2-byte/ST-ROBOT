import assert from 'node:assert/strict';
import { AccountService, ACCOUNT_SESSION_KEY } from '../frontend/src/services/AccountService.js';
import { resolveBackendUrl } from '../frontend/src/config/backend.config.js';

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

assert.equal(resolveBackendUrl('', 'thaivikhang2-byte.github.io'), '');
assert.equal(resolveBackendUrl('', 'localhost'), 'http://localhost:3000/api');
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

console.log('PASS account configuration, session isolation, refresh/auth intent races, offline restoration, stale consumers and logout');
