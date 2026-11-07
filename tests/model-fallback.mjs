import assert from 'node:assert/strict';
import { createModelFallbackResolver } from '../ai-server/model-fallback.mjs';

// All provider calls below are local fixtures, including catalog lookups.
const API_KEY = 'private-catalog-test-key-never-log';
const CURRENT = 'gemini-4-argon';
const FIRST = 'gemini-2.5-flash';
const SECOND = 'gemini-2.0-flash';
const THIRD = 'gemini-flash-latest';
const catalog = (ids, status = 200) => new Response(JSON.stringify({ data: ids.map(id => ({ id })) }), {
  status, headers: { 'Content-Type': 'application/json' }
});
const resolveWith = (resolver, overrides = {}) => resolver({ apiKey: API_KEY, currentModel: CURRENT, ...overrides });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const never = () => new Promise(() => {});
let groups = 0;

// Only an exact, allowlisted ID advertised by the same provider can be selected.
let received;
const basic = createModelFallbackResolver({ upstream: async (url, options) => {
  received = { url, options, initiallyAborted: options.signal.aborted };
  return catalog([THIRD, SECOND, FIRST, 'premium-unrelated-model']);
} });
assert.equal(await resolveWith(basic, { apiKey: `  ${API_KEY}  ` }), FIRST);
assert.equal(received.url, 'https://llm.wokushop.com/v1/models');
assert.equal(received.options.method, 'GET');
assert.equal(received.options.headers.Authorization, `Bearer ${API_KEY}`);
assert.equal(received.options.body, undefined, 'A catalog lookup must not send a user question or generation payload');
assert.ok(received.options.signal instanceof AbortSignal);
assert.equal(received.initiallyAborted, false);
groups++;

const lookalikes = [FIRST + '-extra', ' ' + FIRST, FIRST.toUpperCase(), 'https://example.test/' + FIRST,
  API_KEY, 'gemini-premium-test'];
assert.equal(await resolveWith(createModelFallbackResolver({ upstream: async () => catalog(lookalikes) })), null);
for (const malformed of [{ id: FIRST }, null, 12]) {
  assert.equal(await resolveWith(createModelFallbackResolver({ upstream: async () => catalog([FIRST, malformed]) })), null,
    'A malformed catalog must not be accepted just because it also contains a candidate');
}
assert.equal(await resolveWith(createModelFallbackResolver({ upstream: async () => catalog([SECOND, THIRD]) })), SECOND);
assert.equal(await resolveWith(createModelFallbackResolver({ upstream: async () => catalog([FIRST]) }), { currentModel: FIRST }), null);
assert.equal(await resolveWith(createModelFallbackResolver({ upstream: async () => catalog([FIRST, SECOND]) }), { currentModel: FIRST }), SECOND);
assert.equal(await resolveWith(createModelFallbackResolver({ upstream: async () => catalog([FIRST]) }), { currentModel: 'gemini 4 -aron' }), FIRST);
groups++;

let rejectedCalls = 0;
const rejected = createModelFallbackResolver({ upstream: async () => { rejectedCalls++; return catalog([FIRST]); } });
for (const currentModel of ['gpt-4-test', 'claude-test', 'geminipremium', '', undefined, null, 12]) {
  assert.equal(await resolveWith(rejected, { currentModel }), null);
}
for (const apiKey of ['', '  ', undefined, null, 12]) {
  assert.equal(await resolveWith(rejected, { apiKey }), null);
}
assert.equal(rejectedCalls, 0, 'Ineligible models or missing keys must not call the provider');
groups++;

for (const response of [
  () => catalog([FIRST], 401), () => catalog([FIRST], 403), () => catalog([FIRST], 503),
  () => new Response('<html>unavailable</html>', { status: 200 }),
  () => new Response(JSON.stringify(null)), () => new Response(JSON.stringify({ data: {} })),
  () => new Response(JSON.stringify({ data: Array(5001).fill({ id: FIRST }) }))
]) {
  assert.equal(await resolveWith(createModelFallbackResolver({ upstream: async () => response() })), null);
}
groups++;

let cachedCalls = 0;
const cached = createModelFallbackResolver({ upstream: async () => { cachedCalls++; return catalog([FIRST, SECOND]); } });
assert.equal(await resolveWith(cached), FIRST);
assert.equal(await resolveWith(cached, { apiKey: ` ${API_KEY} ` }), FIRST);
assert.equal(await resolveWith(cached, { currentModel: FIRST }), SECOND);
assert.equal(cachedCalls, 1, 'A successful catalog is reused by trimmed key, without caching a single model choice');
assert.equal(await resolveWith(cached, { apiKey: API_KEY + '-rotated' }), FIRST);
assert.equal(cachedCalls, 2, 'Rotating keys must not reuse a different account catalog');
groups++;

let expiringCalls = 0;
const expiring = createModelFallbackResolver({ cacheTtlMs: 20, upstream: async () => { expiringCalls++; return catalog([FIRST]); } });
await resolveWith(expiring);
await wait(35);
await resolveWith(expiring);
assert.equal(expiringCalls, 2, 'Expired provider catalogs must be fetched again');
groups++;

let boundedCalls = 0;
const bounded = createModelFallbackResolver({ upstream: async () => { boundedCalls++; return catalog([FIRST]); } });
for (let index = 0; index < 9; index++) await resolveWith(bounded, { apiKey: `${API_KEY}-${index}` });
assert.equal(boundedCalls, 9);
await resolveWith(bounded, { apiKey: API_KEY + '-0' });
assert.equal(boundedCalls, 10, 'An eight-entry cache must evict the oldest key instead of growing indefinitely');
groups++;

let recoveringCalls = 0;
const recovering = createModelFallbackResolver({ upstream: async () => ++recoveringCalls === 1 ? catalog([], 503) : catalog([FIRST]) });
assert.equal(await resolveWith(recovering), null);
assert.equal(await resolveWith(recovering), FIRST);
assert.equal(recoveringCalls, 2, 'Failed catalog lookups must not suppress a later successful repair');
groups++;

for (const mode of ['fetch', 'json']) {
  let signal;
  const hanging = createModelFallbackResolver({ catalogTimeoutMs: 35, upstream: async (_url, options) => {
    signal = options.signal;
    return mode === 'fetch' ? never() : { ok: true, status: 200, json: never };
  } });
  const started = Date.now();
  assert.equal(await resolveWith(hanging), null);
  assert.ok(Date.now() - started < 1000, `The ${mode} lookup must respect its deadline even when the fixture ignores abort`);
  assert.equal(signal.aborted, true, 'Timed-out catalog work must receive cancellation');
}
groups++;

const preabort = new AbortController();
const preabortReason = new DOMException('Parent already stopped', 'AbortError');
preabort.abort(preabortReason);
let preabortCalls = 0;
await assert.rejects(resolveWith(createModelFallbackResolver({ upstream: async () => { preabortCalls++; return catalog([FIRST]); } }), {
  signal: preabort.signal
}), error => error === preabortReason);
assert.equal(preabortCalls, 0);
groups++;

for (const mode of ['fetch', 'json']) {
  const controller = new AbortController();
  const reason = new DOMException('Parent request stopped', 'AbortError');
  let markStarted, providerSignal;
  const started = new Promise(resolve => { markStarted = resolve; });
  const resolver = createModelFallbackResolver({ catalogTimeoutMs: 500, upstream: async (_url, options) => {
    providerSignal = options.signal;
    if (mode === 'fetch') { markStarted(); return never(); }
    return { ok: true, status: 200, json: () => { markStarted(); return never(); } };
  } });
  const operation = resolveWith(resolver, { signal: controller.signal });
  await started;
  controller.abort(reason);
  await assert.rejects(operation, error => error === reason);
  assert.equal(providerSignal.aborted, true);
}
groups++;

// One canceled caller must not cancel another caller's in-flight catalog.
const concurrentSignals = [];
let releaseSecond;
const concurrent = createModelFallbackResolver({ catalogTimeoutMs: 500, upstream: async (_url, options) => {
  concurrentSignals.push(options.signal);
  if (concurrentSignals.length === 1) return never();
  return new Promise(resolve => { releaseSecond = () => resolve(catalog([FIRST])); });
} });
const firstController = new AbortController();
const firstReason = new DOMException('First caller stopped', 'AbortError');
const firstCaller = resolveWith(concurrent, { signal: firstController.signal });
const secondCaller = resolveWith(concurrent);
await wait(0);
assert.equal(concurrentSignals.length, 2, 'Callers must not share an in-flight request tied to one caller signal');
firstController.abort(firstReason);
await assert.rejects(firstCaller, error => error === firstReason);
assert.equal(concurrentSignals[0].aborted, true);
assert.equal(concurrentSignals[1].aborted, false);
releaseSecond();
assert.equal(await secondCaller, FIRST);
groups++;

const logged = [];
const consoleMethods = Object.fromEntries(['log', 'warn', 'error'].map(name => [name, console[name]]));
try {
  for (const name of Object.keys(consoleMethods)) console[name] = (...values) => logged.push(values);
  assert.equal(await resolveWith(createModelFallbackResolver({ upstream: async () => catalog([FIRST]) })), FIRST);
  assert.equal(await resolveWith(createModelFallbackResolver({ upstream: async () => {
    throw new Error(API_KEY + ' ' + CURRENT);
  } })), null);
} finally {
  for (const [name, method] of Object.entries(consoleMethods)) console[name] = method;
}
for (const privateValue of [API_KEY, CURRENT, FIRST]) {
  assert.ok(!JSON.stringify(logged).includes(privateValue), 'Catalog diagnostics must not print credentials, model names or catalog bodies');
}
groups++;

const diagnostics = [];
const observed = createModelFallbackResolver({ upstream: async () => catalog([FIRST, SECOND, THIRD, API_KEY, CURRENT]) });
assert.equal(await resolveWith(observed, { onDiagnostic: event => diagnostics.push(event) }), FIRST);
assert.deepEqual(diagnostics, [{ catalogStatus: 200, catalogResult: 'ok', candidateCount: 3 }]);
for (const privateValue of [API_KEY, CURRENT, FIRST, SECOND, THIRD]) {
  assert.ok(!JSON.stringify(diagnostics).includes(privateValue), 'Observers receive no credentials, model names or raw catalog data');
}
groups++;

for (const status of [401, 403, 503]) {
  const events = [];
  let readBody = false;
  const resolver = createModelFallbackResolver({ upstream: async () => ({
    ok: false, status,
    body: { cancel: never },
    json: async () => { readBody = true; throw new Error(API_KEY); }
  }) });
  assert.equal(await resolveWith(resolver, { onDiagnostic: event => events.push(event) }), null);
  assert.deepEqual(events, [{ catalogStatus: status, catalogResult: 'http_error' }]);
  assert.equal(readBody, false, 'Error diagnostics must not read provider error bodies');
}
groups++;

for (const response of [
  () => new Response(API_KEY, { status: 200 }),
  () => new Response(JSON.stringify({ data: [{ id: FIRST }, null], message: API_KEY })),
  () => new Response(JSON.stringify({ error: { message: API_KEY } }))
]) {
  const events = [];
  const resolver = createModelFallbackResolver({ upstream: async () => response() });
  assert.equal(await resolveWith(resolver, { onDiagnostic: event => events.push(event) }), null);
  assert.deepEqual(events, [{ catalogStatus: 200, catalogResult: 'invalid_response' }]);
}
groups++;

for (const mode of ['fetch', 'json']) {
  const events = [];
  const resolver = createModelFallbackResolver({ catalogTimeoutMs: 20, upstream: async () =>
    mode === 'fetch' ? never() : { ok: true, status: 200, json: never }
  });
  assert.equal(await resolveWith(resolver, { onDiagnostic: event => events.push(event) }), null);
  assert.deepEqual(events, [{ ...(mode === 'json' ? { catalogStatus: 200 } : {}), catalogResult: 'timeout' }]);
}
const networkEvents = [];
assert.equal(await resolveWith(createModelFallbackResolver({ upstream: async () => {
  throw new TypeError(API_KEY + ' ' + CURRENT);
} }), { onDiagnostic: event => networkEvents.push(event) }), null);
assert.deepEqual(networkEvents, [{ catalogResult: 'network_error' }]);
groups++;

for (const candidates of [[], [FIRST, SECOND]]) {
  let calls = 0;
  const firstEvents = [], cachedEvents = [];
  const resolver = createModelFallbackResolver({ upstream: async () => { calls++; return catalog(candidates); } });
  assert.equal(await resolveWith(resolver, { onDiagnostic: event => firstEvents.push(event) }), candidates[0] || null);
  assert.equal(await resolveWith(resolver, { onDiagnostic: event => cachedEvents.push(event) }), candidates[0] || null);
  const expected = [{ catalogStatus: 200, catalogResult: 'ok', candidateCount: candidates.length }];
  assert.deepEqual(firstEvents, expected);
  assert.deepEqual(cachedEvents, expected);
  assert.equal(calls, 1, 'Even a valid catalog with no candidates is cached with safe metadata');
}
groups++;

for (const status of [-1, 0, 99, 100, 599, 600, NaN, Infinity, '503', API_KEY, { toString: () => API_KEY }]) {
  const events = [];
  const resolver = createModelFallbackResolver({ upstream: async () => ({ ok: false, status }) });
  assert.equal(await resolveWith(resolver, { onDiagnostic: event => events.push(event) }), null);
  assert.deepEqual(events, [{
    ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { catalogStatus: status } : {}),
    catalogResult: 'http_error'
  }]);
}
let statusReads = 0;
const changingStatusEvents = [];
assert.equal(await resolveWith(createModelFallbackResolver({ upstream: async () => ({
  ok: false, get status() { return ++statusReads === 1 ? 503 : API_KEY; }
}) }), { onDiagnostic: event => changingStatusEvents.push(event) }), null);
assert.deepEqual(changingStatusEvents, [{ catalogStatus: 503, catalogResult: 'http_error' }]);
assert.equal(statusReads, 1, 'Provider status is read once and validated before observation');
groups++;

let observerCalls = 0, observerFetches = 0;
const faultyObserver = createModelFallbackResolver({ upstream: async () => { observerFetches++; return catalog([FIRST]); } });
for (const onDiagnostic of [
  () => { observerCalls++; throw new Error(API_KEY); },
  async () => { observerCalls++; throw new Error(API_KEY); },
  () => ({ get then() { observerCalls++; throw new Error(API_KEY); } })
]) {
  assert.equal(await resolveWith(faultyObserver, { onDiagnostic }), FIRST);
}
await wait(0);
assert.equal(observerCalls, 3);
assert.equal(observerFetches, 1, 'Observer failures must not affect successful catalog caching');
assert.equal(await resolveWith(createModelFallbackResolver({ upstream: async () => catalog([], 503) }), {
  onDiagnostic: () => { throw new Error(API_KEY); }
}), null);
groups++;

const abortedEvents = [];
await assert.rejects(resolveWith(createModelFallbackResolver({ upstream: async () => catalog([FIRST]) }), {
  signal: preabort.signal, onDiagnostic: event => abortedEvents.push(event)
}), error => error === preabortReason);
for (const mode of ['fetch', 'json']) {
  const controller = new AbortController();
  const reason = new DOMException('Diagnostic caller stopped', 'AbortError');
  let markStarted, release;
  const started = new Promise(resolve => { markStarted = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const resolver = createModelFallbackResolver({ catalogTimeoutMs: 500, upstream: async () => {
    if (mode === 'fetch') { markStarted(); return pending; }
    return { ok: true, status: 200, json: () => { markStarted(); return pending; } };
  } });
  const operation = resolveWith(resolver, { signal: controller.signal, onDiagnostic: event => abortedEvents.push(event) });
  await started;
  controller.abort(reason);
  await assert.rejects(operation, error => error === reason);
  release(mode === 'fetch' ? catalog([FIRST]) : { data: [{ id: FIRST }] });
}
await wait(0);
assert.deepEqual(abortedEvents, [], 'Parent cancellation and late provider completion must not become provider failures');
groups++;

let diagnosticRecoveryCalls = 0;
const recoveryEvents = [];
const diagnosticRecovery = createModelFallbackResolver({ upstream: async () =>
  ++diagnosticRecoveryCalls === 1 ? catalog([], 503) : catalog([FIRST])
});
assert.equal(await resolveWith(diagnosticRecovery, { onDiagnostic: event => recoveryEvents.push(event) }), null);
assert.equal(await resolveWith(diagnosticRecovery, { onDiagnostic: event => recoveryEvents.push(event) }), FIRST);
assert.deepEqual(recoveryEvents, [
  { catalogStatus: 503, catalogResult: 'http_error' },
  { catalogStatus: 200, catalogResult: 'ok', candidateCount: 1 }
]);
assert.equal(diagnosticRecoveryCalls, 2);
const ineligibleEvents = [];
await resolveWith(diagnosticRecovery, { currentModel: 'gpt-test', onDiagnostic: event => ineligibleEvents.push(event) });
await resolveWith(diagnosticRecovery, { apiKey: '', onDiagnostic: event => ineligibleEvents.push(event) });
assert.deepEqual(ineligibleEvents, [], 'An ineligible fallback request must not report catalog work');
groups++;

console.log(`PASS ${groups} model catalog groups: exact advertised candidates, bounded per-key cache, private GET-only lookups, deadlines/cancellation and no external requests`);
