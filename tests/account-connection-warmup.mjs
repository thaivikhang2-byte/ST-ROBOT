import assert from 'node:assert/strict';
import { AccountService, ACCOUNT_CONNECTION_KEY } from '../frontend/src/services/AccountService.js';
import { warmAccountConnection } from '../frontend/src/services/AccountConnectionWarmup.js';

class Page extends EventTarget {
    constructor(visible = true) { super(); this.visibilityState = visible ? 'visible' : 'hidden'; this.prerendering = false; }
    show() { this.visibilityState = 'visible'; this.dispatchEvent(new Event('visibilitychange')); }
}
class View extends EventTarget {
    constructor() { super(); this.frames = new Map(); this.tasks = new Map(); this.next = 0; }
    requestAnimationFrame(callback) { const id = ++this.next; this.frames.set(id, callback); return id; }
    cancelAnimationFrame(id) { this.frames.delete(id); }
    setTimeout(callback) { const id = ++this.next; this.tasks.set(id, callback); return id; }
    clearTimeout(id) { this.tasks.delete(id); }
    render() { const frames = [...this.frames.values()]; this.frames.clear(); frames.forEach(callback => callback()); }
    runTasks() { const tasks = [...this.tasks.values()]; this.tasks.clear(); tasks.forEach(callback => callback()); }
    hide() { this.dispatchEvent(new Event('pagehide')); }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const response = data => ({ ok: true, status: 200, json: async () => ({ success: true, data }) });
const healthy = () => response({ status: 'ok' });
const profile = { id: 'fixture-student', email: 'fixture@example.test' };
const auth = () => response({ user: profile, tokens: { accessToken: 'fixture-access', refreshToken: 'fixture-refresh' } });
const credentials = { email: profile.email, password: 'fixture-password' };
const baseUrl = 'https://account.example.test/api';
const timing = { timeoutMs: 500, requestTimeoutMs: 300, retryDelayMs: 8, ttlMs: 1000 };
const service = fetchImpl => new AccountService({ baseUrl, warmup: timing, storage: undefined, logoutChannelFactory: () => null, fetchImpl });
const visit = account => {
    const page = new Page(), view = new View();
    const cleanup = warmAccountConnection({ account, page, view });
    return { page, view, cleanup };
};

// Public DOM gets a render opportunity before one quiet, health-only preparation.
{
    const calls = [], account = { configured: true, prepareConnection: async options => { calls.push(options); } };
    const { page, view, cleanup } = visit(account);
    assert.equal(calls.length, 0);
    view.render();
    assert.equal(calls.length, 0);
    view.runTasks();
    await tick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].signal.aborted, false);
    page.show();
    view.dispatchEvent(new Event('pageshow'));
    view.render(); view.runTasks();
    await tick();
    assert.equal(calls.length, 1);
    assert.equal(view.frames.size, 0);
    assert.equal(view.tasks.size, 0);
    cleanup();
}

// Initially hidden and prerendered documents wait until an actual visible visit.
for (const prerendering of [false, true]) {
    const page = new Page(prerendering), view = new View();
    page.prerendering = prerendering;
    let calls = 0;
    const cleanup = warmAccountConnection({ account: { configured: true, prepareConnection: async () => { calls++; } }, page, view });
    view.render(); view.runTasks(); await tick();
    assert.equal(calls, 0);
    page.prerendering = false;
    page.show();
    view.render(); view.runTasks(); await tick();
    assert.equal(calls, 1);
    cleanup();
}

// Navigation cancels a scheduled request, and bfcache restoration does not restart it.
for (const stage of ['before-render', 'after-render', 'hidden']) {
    const page = new Page(stage !== 'hidden'), view = new View();
    let calls = 0;
    warmAccountConnection({ account: { configured: true, prepareConnection: async () => { calls++; } }, page, view });
    if (stage === 'after-render') view.render();
    view.hide(); page.show(); view.dispatchEvent(new Event('pageshow'));
    view.render(); view.runTasks(); await tick();
    assert.equal(calls, 0);
    assert.equal(view.frames.size, 0);
    assert.equal(view.tasks.size, 0);
}

// A page hidden between its render callback and task still waits for visibility.
{
    let calls = 0;
    const { page, view, cleanup } = visit({ configured: true, prepareConnection: async () => { calls++; } });
    view.render();
    page.visibilityState = 'hidden';
    view.runTasks(); await tick();
    assert.equal(calls, 0);
    page.show(); view.render(); view.runTasks(); await tick();
    assert.equal(calls, 1);
    cleanup();
}

// Missing configuration stays local; a rejected or synchronous prefetch failure stays quiet.
{
    const account = { configured: false, prepareConnection: () => { throw Error('Must not prepare an unconfigured API'); } };
    const { view, cleanup } = visit(account);
    view.render(); view.runTasks(); cleanup();
    for (const prepareConnection of [() => { throw Error('fixture failure'); }, async () => { throw Error('fixture failure'); }]) {
        const failing = visit({ configured: true, prepareConnection });
        failing.view.render(); failing.view.runTasks();
        await tick();
        failing.page.show(); failing.view.render(); failing.view.runTasks();
        await tick();
        assert.equal(failing.view.tasks.size, 0);
        failing.cleanup();
    }
}

// A leaving page aborts its only health waiter, even when fetch ignores cancellation.
{
    const health = deferred(), calls = [];
    let healthSignal;
    const account = service(async (url, options) => { calls.push(url); healthSignal = options.signal; return health.promise; });
    const { view } = visit(account);
    view.render(); view.runTasks(); await tick();
    assert.equal(calls.length, 1);
    view.hide(); await tick();
    assert.equal(healthSignal.aborted, true);
    assert.equal(account.connectionStatus, 'idle');
    health.reject(Error('late cancelled fixture'));
    await tick();
}

// Preparation joins the existing flight; cancelling it cannot cancel another login waiter.
{
    const health = deferred(), calls = [];
    let healthSignal;
    const account = service(async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/system/health/live')) { healthSignal = options.signal; return health.promise; }
        return auth();
    });
    const { view } = visit(account);
    view.render(); view.runTasks(); await tick();
    const login = account.signIn(credentials);
    await tick(); view.hide(); await tick();
    assert.equal(healthSignal.aborted, false);
    health.resolve(healthy());
    assert.equal((await login).id, profile.id);
    assert.deepEqual(calls.map(call => call.options.method), ['GET', 'POST']);
    assert.equal(calls[0].options.headers.Authorization, undefined);
    assert.equal(calls[0].options.body, undefined);
}

// The server-bound readiness timestamp avoids another warmup on a subsequent page.
{
    const values = new Map([[ACCOUNT_CONNECTION_KEY, JSON.stringify({ version: 1, baseUrl, checkedAt: Date.now() })]]);
    const account = new AccountService({ baseUrl, warmup: timing, logoutChannelFactory: () => null,
        storage: { getItem: key => values.get(key) }, fetchImpl: () => { throw Error('Recent readiness must not fetch'); } });
    const { view, cleanup } = visit(account);
    view.render(); view.runTasks(); await tick();
    assert.equal(account.user, null);
    assert.equal(account.connectionStatus, 'idle');
    cleanup();
}

// Measure perceived login wait with identical request counts and simulated startup latency.
{
    const measurements = {};
    for (const early of [false, true]) {
        const calls = [];
        const account = service(async (url, options) => {
            calls.push({ url, method: options.method });
            if (url.endsWith('/system/health/live')) { await delay(120); return healthy(); }
            await delay(10); return auth();
        });
        const page = early ? visit(account) : null;
        if (page) { page.view.render(); page.view.runTasks(); }
        await delay(150);
        assert.equal(calls.length, early ? 1 : 0);
        const started = performance.now();
        await account.signIn(credentials);
        measurements[early ? 'warmOnVisit' : 'wakeAtLogin'] = { loginWaitMs: Math.round(performance.now() - started), requests: calls.length };
        assert.deepEqual(calls.map(call => call.method), ['GET', 'POST']);
        page?.cleanup();
    }
    console.log('Visible visit cold-start fixture:', JSON.stringify({ wakeMs: 120, apiMs: 10, browsingMs: 150, ...measurements }));
}

console.log('PASS one-time post-render account warmup, hidden/prerender/bfcache lifecycle, quiet failure, cancellation and credential safety');
