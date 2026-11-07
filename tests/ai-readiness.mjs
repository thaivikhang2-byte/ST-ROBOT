import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { AI_SERVICE_ORIGIN, AiRequestError, createAiClient } from '../frontend/src/services/AiService.js';

// Fetch fixtures only: no request reaches Render or a paid AI provider.
const origin = 'https://st-robot-1.onrender.com';
const question = { question: 'Bộ đếm tăng từ 33 thêm 3 thì bằng bao nhiêu?', history: [] };
const uuid = '89d478c4-102a-4a71-92af-a0c44e62c49b';
const privateValue = 'private-provider-or-key-value-never-reflect';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const ready = () => json({ ok: true, ai: { keyConfigured: true, modelConfigured: true } });
const reply = () => json({ reply: '33 + 3 = 36.' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const make = (fetchImpl, options = {}) => createAiClient({ fetchImpl, startupTimeoutMs: 300, replyTimeoutMs: 300, retryDelayMs: 0, ...options });
let groups = 0;

function isFailure(code, stage) {
  return error => {
    assert.ok(error instanceof AiRequestError);
    if (code) assert.equal(error.code, code);
    if (stage) assert.equal(error.stage, stage);
    assert.ok(typeof error.message === 'string' && error.message.trim());
    return true;
  };
}

assert.equal(AI_SERVICE_ORIGIN, origin);

// The readiness request cannot carry a question, secret or paid completion.
{
  const calls = [], states = [];
  const client = make(async (url, options) => {
    calls.push({ url, options });
    assert.ok(options.signal instanceof AbortSignal && !options.signal.aborted);
    return url.endsWith('/health') ? ready() : reply();
  });
  assert.equal(await client.requestReply('/api/home-chat', question, { onStatus: state => states.push(state) }), '33 + 3 = 36.');
  assert.deepEqual(calls.map(call => call.url), [origin + '/health', origin + '/api/home-chat']);
  assert.equal(calls[0].options.method || 'GET', 'GET');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.ok(!calls[0].options.body);
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.credentials, 'omit');
  assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[1].options.body), question);
  assert.notEqual(calls[0].options.signal, calls[1].options.signal, 'Startup and generation need distinct deadlines');
  assert.deepEqual(states, ['starting', 'replying']);
  groups++;
}

// A recent successful wakeup is reused by either chat entry, and expires.
{
  const calls = [];
  const client = make(async url => {
    calls.push(url);
    return url.endsWith('/health') ? ready() : reply();
  }, { readinessTtlMs: 60 });
  await client.requestReply('/api/home-chat', question);
  await client.requestReply('/api/tutor', { ...question, course: 'microbit', lesson: 'counter' });
  assert.equal(calls.filter(url => url.endsWith('/health')).length, 1);
  await sleep(80);
  await client.requestReply('/api/home-chat', question);
  assert.equal(calls.filter(url => url.endsWith('/health')).length, 2);
  groups++;
}

// Render can return an HTML 503 or a connection error while it starts. Only
// the free GET is retried; the first POST waits for a valid readiness response.
{
  const methods = [];
  let healthCalls = 0;
  const client = make(async (url, options) => {
    methods.push(options.method || 'GET');
    if (url.endsWith('/health')) {
      healthCalls++;
      if (healthCalls === 1) throw new TypeError('Fixture connection still starting');
      if (healthCalls === 2) return new Response('Starting instance', { status: 503 });
      return ready();
    }
    assert.equal(healthCalls, 3);
    return reply();
  });
  assert.equal(await client.requestReply('/api/home-chat', question), '33 + 3 = 36.');
  assert.deepEqual(methods, ['GET', 'GET', 'GET', 'POST']);
  groups++;
}

// A missing key is observable before sending a question. A failed readiness
// result must not be cached, so a subsequent configuration repair is visible.
{
  let configured = false;
  const calls = [];
  const client = make(async url => {
    calls.push(url);
    if (url.endsWith('/health')) return json({ ok: true, ai: { keyConfigured: configured } });
    return reply();
  });
  await assert.rejects(client.requestReply('/api/home-chat', question), error => {
    isFailure('AI_AUTH', 'startup')(error);
    assert.equal(error.retryable, false);
    return true;
  });
  assert.equal(calls.length, 1);
  configured = true;
  assert.equal(await client.requestReply('/api/home-chat', question), '33 + 3 = 36.');
  assert.deepEqual(calls.map(url => new URL(url).pathname), ['/health', '/health', '/api/home-chat']);
  groups++;
}

for (const fixture of [
  () => json({ error: 'Not found' }, 404),
  () => new Response('Not JSON', { status: 200 }),
  () => json({ ok: false }),
  () => json(null)
]) {
  let calls = 0;
  const client = make(async url => {
    calls++;
    assert.ok(url.endsWith('/health'), 'A failed readiness check must not send the question');
    return fixture();
  });
  await assert.rejects(client.requestReply('/api/home-chat', question), isFailure(undefined, 'startup'));
  assert.equal(calls, 1);
}
groups++;

// The old combined timeout fails this scenario: startup and reply each fit
// their own budget, while their sum exceeds the reply-generation budget.
{
  const client = make(async url => {
    await sleep(url.endsWith('/health') ? 70 : 45);
    return url.endsWith('/health') ? ready() : reply();
  }, { startupTimeoutMs: 160, replyTimeoutMs: 90 });
  const started = performance.now();
  assert.equal(await client.requestReply('/api/home-chat', question), '33 + 3 = 36.');
  assert.ok(performance.now() - started > 100, 'The fixture must cross the former combined-budget boundary');
  groups++;
}

// These fetch fixtures deliberately ignore AbortSignal. Local deadlines still
// have to settle the caller and stop the workflow from posting or retrying.
{
  let calls = 0, captured;
  const client = make(async (_url, options) => {
    calls++; captured = options.signal;
    return new Promise(() => {});
  }, { startupTimeoutMs: 35 });
  const started = performance.now();
  await assert.rejects(client.requestReply('/api/home-chat', question), isFailure('AI_STARTUP_TIMEOUT', 'startup'));
  assert.ok(performance.now() - started < 500);
  assert.equal(calls, 1);
  assert.ok(captured.aborted);
  groups++;
}
{
  const paths = [];
  let captured;
  const client = make(async (url, options) => {
    paths.push(new URL(url).pathname);
    if (url.endsWith('/health')) return ready();
    captured = options.signal;
    return new Promise(() => {});
  }, { replyTimeoutMs: 35 });
  await assert.rejects(client.requestReply('/api/home-chat', question), isFailure('AI_REPLY_TIMEOUT', 'reply'));
  assert.deepEqual(paths, ['/health', '/api/home-chat']);
  assert.ok(captured.aborted);
  groups++;
}

for (const phase of ['startup', 'reply']) {
  const paths = [];
  const client = make(async url => {
    paths.push(new URL(url).pathname);
    if (phase === 'reply' && url.endsWith('/health')) return ready();
    return { ok: true, status: 200, json: async () => new Promise(() => {}) };
  }, { startupTimeoutMs: 35, replyTimeoutMs: 35 });
  await assert.rejects(client.requestReply('/api/home-chat', question),
    isFailure(phase === 'startup' ? 'AI_STARTUP_TIMEOUT' : 'AI_REPLY_TIMEOUT', phase));
  assert.deepEqual(paths, phase === 'reply' ? ['/health', '/api/home-chat'] : ['/health']);
}
groups++;

for (const phase of ['startup', 'reply']) {
  const outer = new AbortController();
  const paths = [];
  let started, captured;
  const held = new Promise(resolve => { started = resolve; });
  const client = make(async (url, options) => {
    paths.push(new URL(url).pathname);
    if (phase === 'reply' && url.endsWith('/health')) return ready();
    captured = options.signal; started();
    return new Promise(() => {});
  });
  const pending = client.requestReply('/api/home-chat', question, { signal: outer.signal });
  const checked = assert.rejects(pending, error => error.name === 'AbortError');
  await held;
  outer.abort();
  await checked;
  assert.ok(captured.aborted);
  assert.deepEqual(paths, phase === 'reply' ? ['/health', '/api/home-chat'] : ['/health']);
}
groups++;
{
  const outer = new AbortController(); outer.abort();
  let calls = 0;
  const client = make(async () => { calls++; return ready(); });
  await assert.rejects(client.requestReply('/api/home-chat', question, { signal: outer.signal }), error => error.name === 'AbortError');
  assert.equal(calls, 0);
  groups++;
}

{
  const outer = new AbortController();
  let calls = 0, started;
  const fetched = new Promise(resolve => { started = resolve; });
  const client = make(async () => { calls++; started(); throw new TypeError('Fixture still waking'); }, { retryDelayMs: 1000 });
  const checked = assert.rejects(client.requestReply('/api/home-chat', question, { signal: outer.signal }),
    error => error.name === 'AbortError');
  await fetched;
  await sleep(0);
  outer.abort();
  await checked;
  await sleep(10);
  assert.equal(calls, 1, 'Canceling the startup backoff must stop all further requests');
  groups++;
}

{
  const paths = [];
  let failPost = true;
  const client = make(async url => {
    paths.push(new URL(url).pathname);
    if (url.endsWith('/health')) return ready();
    if (failPost) { failPost = false; throw new TypeError('Fixture transport failed'); }
    return reply();
  });
  await assert.rejects(client.requestReply('/api/home-chat', question), isFailure('AI_NETWORK', 'reply'));
  assert.equal(await client.requestReply('/api/home-chat', question), '33 + 3 = 36.');
  assert.deepEqual(paths, ['/health', '/api/home-chat', '/health', '/api/home-chat'],
    'A transport failure invalidates cached readiness without automatically retrying the POST');
  groups++;
}

// Provider failure reports remain useful without reflecting raw provider data.
{
  let posts = 0;
  const client = make(async url => {
    if (url.endsWith('/health')) return ready();
    posts++;
    return json({ error: 'Dịch vụ AI đang tạm gián đoạn.', code: 'AI_UNAVAILABLE', retryable: true,
      stage: 'provider', upstreamStatus: 503, providerCode: 'service_unavailable', requestId: uuid,
      catalogStatus:200,catalogResult:'ok',candidateCount:1,fallbackAttempted:true,
      catalogModelCount:12,configuredModelListed:false,
      rawProviderBody: privateValue }, 503);
  });
  await assert.rejects(client.requestReply('/api/home-chat', question), error => {
    isFailure('AI_UNAVAILABLE', 'provider')(error);
    assert.equal(error.httpStatus, 503);
    assert.equal(error.upstreamStatus, 503);
    assert.equal(error.providerCode, 'service_unavailable');
    assert.equal(error.requestId, uuid);
    assert.equal(error.catalogStatus, 200);
    assert.equal(error.catalogResult, 'ok');
    assert.equal(error.candidateCount, 1);
    assert.equal(error.fallbackAttempted, true);
    assert.equal(error.catalogModelCount, 12);
    assert.equal(error.configuredModelListed, false);
    assert.equal(error.retryable, true);
    assert.ok(!JSON.stringify(error).includes(privateValue));
    return true;
  });
  assert.equal(posts, 1, 'The browser must not silently repeat a paid completion');
  groups++;
}
{
  const client = make(async url => url.endsWith('/health') ? ready() : json({
    error: 'Phản hồi lỗi của máy chủ.', code: privateValue, stage: privateValue,
    upstreamStatus: privateValue, providerCode: privateValue, requestId: privateValue,
    catalogStatus:privateValue,catalogResult:privateValue,candidateCount:4,fallbackAttempted:privateValue,
    catalogModelCount:5001,configuredModelListed:privateValue
  }, 502));
  await assert.rejects(client.requestReply('/api/home-chat', question), error => {
    assert.ok(error instanceof AiRequestError);
    assert.ok(!JSON.stringify(error).includes(privateValue));
    assert.equal(error.httpStatus, 502);
    assert.equal(error.upstreamStatus, undefined);
    assert.equal(error.providerCode, undefined);
    assert.equal(error.requestId, undefined);
    assert.equal(error.catalogStatus, undefined);
    assert.equal(error.catalogResult, undefined);
    assert.equal(error.candidateCount, undefined);
    assert.equal(error.fallbackAttempted, undefined);
    assert.equal(error.catalogModelCount, undefined);
    assert.equal(error.configuredModelListed, undefined);
    return true;
  });
  groups++;
}

for (const fixture of [() => new Response('Not JSON'), () => json(null), () => json({ reply: ' ' })]) {
  let posts = 0;
  const client = make(async url => {
    if (url.endsWith('/health')) return ready();
    posts++; return fixture();
  });
  await assert.rejects(client.requestReply('/api/home-chat', question), isFailure(undefined, 'reply'));
  assert.equal(posts, 1);
}
groups++;

{
  let calls = 0;
  const client = make(async () => { calls++; return ready(); });
  for (const path of ['/api/practice-plan', '/health', 'https://unrelated.test/api/home-chat', '//unrelated.test', '/api/home-chat?x=1']) {
    await assert.rejects(async () => client.requestReply(path, question));
  }
  assert.equal(calls, 0, 'Invalid paths must be rejected before fetch');
  groups++;
}

console.log(`PASS ${groups} AI readiness groups: separate startup/reply budgets, free GET recovery, bounded cancellation, safe error reports, no duplicate POSTs and no external requests`);
