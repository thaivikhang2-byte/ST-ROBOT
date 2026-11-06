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

console.log(`PASS ${groups} model catalog groups: exact advertised candidates, bounded per-key cache, private GET-only lookups, deadlines/cancellation and no external requests`);
