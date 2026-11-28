import assert from 'node:assert/strict';
import { AiSpendingClient, attachAiSpendingSetup, defaultAiSpending, validateAiSpending, aiSpendingErrorMessage } from '../frontend/src/modules/account/AiSpendingSetup.js';

const NOW = new Date('2026-11-26T03:00:00.000Z');
const MODEL = '143f67e7-2ce8-4695-b765-e701799663d0';
const admin = () => ({ id: 'operator', isActive: true, isEmailVerified: true, permissions: ['ai:manage'],
    roles: [{ group: 'MANAGER', scopeType: 'SYSTEM' }] });
const model = (known = false) => ({ id: MODEL, providerId: 'woku', modelId: 'registered-provider-model',
    inputPricePerMillion: known ? '0.20' : null, outputPricePerMillion: known ? '0.80' : null,
    pricingVersion: known ? 'operator-confirmed:fixture' : null });
const configuration = { ...defaultAiSpending(NOW), revision: 2 };
const status = known => ({ configuration, models: [model(known)], usage: { spentUsd: '0.05', reservedUsd: '0.02', remainingUsd: '0.93', dailyRemainingUsd: '0.03', costUnknown: false } });
const value = { ...configuration, expectedRevision: configuration.revision };
const clone = value => JSON.parse(JSON.stringify(value));
function fixture({ known = false, onRequest } = {}) {
    const calls = [], listeners = new Set();
    const session = { user: admin(), sessionVersion: 1, sessionOffline: false,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        notify() { for (const listener of listeners) listener(this.user); },
        async request(path, options = {}) {
            calls.push({ path, method: options.method || 'GET', body: clone(options.body ?? null), signal: options.signal });
            await onRequest?.(session, options);
            const result = clone(status(known));
            if (options.body) result.configuration = { ...result.configuration, ...options.body, revision: 3 };
            return result;
        } };
    return { calls, session, client: new AiSpendingClient(session), listeners };
}

assert.equal(configuration.totalBudgetUsd, '1.00');
assert.equal(configuration.dailyBudgetUsd, '0.03');
assert.equal(configuration.reserveUsd, '0.40');
assert.equal(configuration.enabled, false);
assert.equal(configuration.economyEnabled, true);
assert(new Date(configuration.startsAt) < new Date(configuration.reserveFrom));
assert(new Date(configuration.reserveFrom) < new Date(configuration.endsAt));
assert(new Date(defaultAiSpending(new Date('2026-12-13T00:00:00Z')).reserveFrom).getFullYear() === 2027);
assert.equal(defaultAiSpending(new Date('2026-11-28T10:00:00Z')).reserveFrom, '2026-12-11T17:00:00.000Z');
assert.equal(defaultAiSpending(new Date('2026-12-12T10:00:00Z')).endsAt, '2026-12-12T17:00:00.000Z');
assert(new Date(defaultAiSpending(new Date('2026-12-12T10:00:00Z')).startsAt) < new Date('2026-12-11T17:00:00Z'));

for (const invalid of [
    { totalBudgetUsd: 'unknown' }, { totalBudgetUsd: '0' }, { dailyBudgetUsd: '2' }, { reserveUsd: '2' },
    { totalBudgetUsd: '0.123456789' }, { startsAt: '9' }, { startsAt: '2026-12-13T00:00:00Z' },
    { endsAt: '2026-12-01T00:00:00Z' }, { enabled: 'true' }, { expectedRevision: -1 },
]) assert.throws(() => validateAiSpending({ ...value, ...invalid }, status(false), NOW));
assert.throws(() => validateAiSpending({ ...value, enabled: true }, status(false), NOW), { code: 'AI_SPENDING_PRICES' });
assert.doesNotThrow(() => validateAiSpending({ ...value, enabled: true }, status(true), NOW));
assert.throws(() => validateAiSpending({ ...value, modelId: MODEL, inputPricePerMillion: '0.2', outputPricePerMillion: '0.8' }, status(false), NOW), { code: 'AI_SPENDING_PRICES' });
assert.throws(() => validateAiSpending({ ...value, modelId: 'arbitrary-model', inputPricePerMillion: '0.2', outputPricePerMillion: '0.8', pricesConfirmed: true }, status(false), NOW));
assert.equal(validateAiSpending({ ...value, enabled: true, modelId: MODEL, inputPricePerMillion: '0.2', outputPricePerMillion: '0.8', pricesConfirmed: true }, status(false), NOW).modelId, MODEL);
assert.throws(() => validateAiSpending({ ...value, enabled: true }, status(true), new Date('2027-01-01T00:00:00Z')), { code: 'AI_SPENDING_DATES' });

{
    const { client, calls } = fixture();
    const controller = new AbortController();
    await client.load(controller.signal);
    await client.save({ ...value, apiKey: 'must-never-be-sent', unrelatedSetting: true }, status(false), { signal: controller.signal, now: NOW });
    assert.deepEqual(calls.map(call => [call.path, call.method]), [['/v1/admin/ai/spending', 'GET'], ['/v1/admin/ai/spending', 'PUT']]);
    assert(!JSON.stringify(calls).includes('must-never-be-sent'));
    assert.equal(calls[1].body.expectedRevision, 2);
    assert.equal(calls[1].body.economyEnabled, true);
    assert.equal(calls[1].signal, controller.signal);
    await assert.rejects(client.save({ ...value, enabled: true }, status(false), { now: NOW }), { code: 'AI_SPENDING_PRICES' });
    assert.equal(calls.length, 2, 'Unknown prices must fail before changing configuration');
}
for (const changed of [
    user => ({ ...user, roles: [{ group: 'MANAGER', scopeType: 'COURSE' }] }),
    user => ({ ...user, isEmailVerified: false }), user => ({ ...user, permissions: [] }),
]) {
    const { client, calls, session } = fixture(); session.user = changed(session.user);
    assert.throws(() => client.load(), { code: 'SESSION_CHANGED' });
    assert.equal(calls.length, 0);
}
{
    const { client, session, calls } = fixture({ onRequest: session => { session.sessionVersion++; } });
    await assert.rejects(client.load(), { code: 'SESSION_CHANGED' });
    assert.equal(calls.length, 1);
    session.sessionOffline = true;
    assert.throws(() => client.load(), { code: 'SESSION_CHANGED' });
}
assert.match(aiSpendingErrorMessage({ code: 'AI_SPENDING_PRICES' }), /nhà cung cấp/);
assert.match(aiSpendingErrorMessage({ status: 409 }), /Tải lại/);

// A small DOM fixture checks the boundary: mounting costs no requests, and
// opening/saving the panel never invokes generation or a credential endpoint.
class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.events = new Map(); this._value = ''; this.open = false; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, handler) { this.events.set(name, handler); }
    fire(name) { this.events.get(name)?.({ preventDefault() {} }); }
    get options() { return this.children.filter(child => child.tagName === 'OPTION'); }
    get value() { return this._value || (this.tagName === 'SELECT' ? this.options[0]?.value || '' : ''); }
    set value(value) { this._value = String(value); }
    querySelectorAll(selector) { const tags = selector.toUpperCase().split(','); return this.children.flatMap(child => [ ...(tags.includes(child.tagName) ? [child] : []), ...child.querySelectorAll(selector) ]); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const previousDocument = globalThis.document;
globalThis.document = { createElement: tag => new Element(tag) };
try {
    const { calls, session, listeners } = fixture();
    const host = new Element('div'), destroy = attachAiSpendingSetup(host, session);
    assert.equal(calls.length, 0, 'Mounting the closed panel must not fetch usage, models or providers');
    const details = host.children[0]; assert.equal(details.open, false);
    details.open = true; details.fire('toggle'); await tick(); await tick();
    assert.equal(calls.length, 1); assert.equal(calls[0].path, '/v1/admin/ai/spending');
    const form = host.querySelectorAll('form')[0];
    form.fire('submit'); await tick(); await tick();
    assert.equal(calls.length, 2); assert.equal(calls[1].method, 'PUT');
    const enable = host.querySelectorAll('input').find(input => input.name === 'enabled'); enable.checked = true;
    form.fire('submit'); await tick(); await tick();
    assert.equal(calls.length, 2, 'Turning on a dollar budget without confirmed prices must not send a write');
    assert(calls.every(call => call.path === '/v1/admin/ai/spending'));
    session.user = { ...session.user, id: 'another-operator' }; session.notify();
    assert.equal(host.children.length, 0);
    assert.equal(calls[0].signal.aborted, true);
    destroy(); assert.equal(listeners.size, 0);
    const student = fixture(); student.session.user.roles = [{ group: 'STUDENT', scopeType: 'SYSTEM' }];
    const studentHost = new Element('div'); attachAiSpendingSetup(studentHost, student.session);
    assert.equal(studentHost.children.length, 0); assert.equal(student.calls.length, 0);
} finally { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; }

console.log('PASS lazy admin spending panel, explicit price confirmation, metadata-only requests, budget validation, session isolation and unchanged student access');
