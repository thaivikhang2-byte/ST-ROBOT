import assert from 'node:assert/strict';
import http from 'node:http';
import { ChatUpstreamError, requestChatCompletion } from '../ai-server/chat-upstream.mjs';

// Only local fixtures are used. No request is made to the paid AI service.
const KEY = 'private-test-key-never-log';
const QUESTION = 'private-question-never-log';
const PROVIDER_DETAIL = 'private-provider-detail-never-log';
const messages = [{ role: 'system', content: 'Giải thích bài tập từng bước.' }, { role: 'user', content: QUESTION }];
const content = 'count = 33 + 3 = 36. button_b.was_pressed() trả False nên không đặt lại bộ đếm.';
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const answer = (value = content) => json({ choices: [{ message: { content: value } }] });
const rejection = (status, code, extra = {}) => json({ error: { code, message: PROVIDER_DETAIL, ...extra } }, status);
const defaults = { apiKey: `  ${KEY}  `, model: 'configured-test-model', messages, retryDelayMs: 0, requestId: 'local-test-request-id' };
let groups = 0;

async function failure(upstream, expected, overrides = {}) {
  let calls = 0;
  const logs = [];
  const logger = (...args) => logs.push(args);
  let captured;
  await assert.rejects(requestChatCompletion({ ...defaults, ...overrides, logger, upstream: async (...args) => { calls++; return upstream(...args); } }), error => {
    captured = error;
    assert.ok(error instanceof ChatUpstreamError);
    assert.equal(error.status, expected.status);
    assert.equal(error.code, expected.code);
    assert.equal(error.retryable, expected.retryable);
    for (const field of ['stage', 'upstreamStatus', 'providerCode']) {
      if (Object.hasOwn(expected, field)) assert.equal(error[field], expected[field]);
    }
    assert.ok(typeof error.message === 'string' && error.message.length > 0);
    return true;
  });
  if (expected.calls !== undefined) assert.equal(calls, expected.calls);
  const publicOutput = JSON.stringify({ error: { ...captured, message: captured.message }, logs });
  for (const secret of [KEY, QUESTION, PROVIDER_DETAIL]) assert.ok(!publicOutput.includes(secret), `Error/log output must not expose ${secret}`);
  return { calls, logs, error: captured };
}

const prior = Object.fromEntries(['NODE_ENV', 'ALLOWED_ORIGIN', 'AI_MODEL', 'DAILY_REQUEST_LIMIT', 'WOKU_API_KEY', 'AI_PROVIDER'].map(name => [name, process.env[name]]));
let serverIndex = 0;
async function withServer(upstream, callback, { key = KEY, limit = 50 } = {}) {
  process.env.NODE_ENV = 'test';
  process.env.AI_PROVIDER = 'woku';
  process.env.ALLOWED_ORIGIN = 'https://chat.test';
  process.env.AI_MODEL = 'configured-test-model';
  process.env.DAILY_REQUEST_LIMIT = String(limit);
  process.env.WOKU_API_KEY = key;
  const { createServer } = await import(`../ai-server/server.mjs?chat-test=${++serverIndex}`);
  const server = createServer(upstream);
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    await callback(server);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}

function request(server, path, body, origin = 'https://chat.test') {
  const encoded = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, method: 'POST', path, headers: {
      Origin: origin, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded)
    } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject); req.end(encoded);
  });
}

try {
  let received;
  const result = await requestChatCompletion({ ...defaults, maxTokens: 88, logger: () => {}, upstream: async (url, options) => {
    received = { url, options }; return answer();
  } });
  assert.equal(result, content);
  assert.equal(received.url, 'https://llm.wokushop.com/v1/chat/completions');
  assert.equal(received.options.method, 'POST');
  assert.equal(received.options.headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(received.options.body), { model: 'configured-test-model', messages, max_tokens: 88 });
  assert.ok(received.options.signal instanceof AbortSignal);
  assert.equal((await requestChatCompletion({ ...defaults, logger: () => {}, upstream: async () => answer('x'.repeat(13000)) })).length, 12000);
  groups++;

  for (const [status, code] of [[401, 'invalid_api_key'], [403, 'access_denied']]) {
    await failure(async () => rejection(status, code), { status: 503, code: 'AI_AUTH', retryable: false, calls: 1,
      stage: 'provider', upstreamStatus: status, providerCode: code });
  }
  for (const [status, code] of [[400, 'model_not_found'], [404, 'model_not_found'], [422, 'model_not_supported'],
    [503, 'model_not_found'], [503, 'model_not_supported'], [503, 'invalid_model'], [500, 'unsupported_model']]) {
    await failure(async () => rejection(status, code), { status: 503, code: 'AI_MODEL', retryable: false, calls: 1,
      stage: 'provider', upstreamStatus: status, providerCode: code });
  }
  await failure(async () => rejection(400, 'unsupported_parameter'), { status: 502, code: 'AI_REQUEST', retryable: false, calls: 1 });
  groups++;

  // Provider diagnostics use an exact allowlist. Unknown/secret-looking codes,
  // messages and details must never be echoed by either errors or logs.
  for (const code of [KEY, QUESTION, PROVIDER_DETAIL, 'unrecognized_internal_error', 'model_not_found-' + KEY, { secret: KEY }]) {
    const hidden = await failure(async () => rejection(503, code), {
      status: 503, code: 'AI_UNAVAILABLE', retryable: true, calls: 2,
      stage: 'provider', upstreamStatus: 503, providerCode: undefined
    });
    if (typeof code === 'string') assert.ok(!JSON.stringify(hidden.logs).includes(code));
  }
  const noChannel = await failure(async () => rejection(503, 'no_available_channel'), {
    status: 503, code: 'AI_UNAVAILABLE', retryable: true, calls: 2,
    stage: 'provider', upstreamStatus: 503, providerCode: 'no_available_channel'
  });
  const event = JSON.parse(noChannel.logs.at(-1)[0]);
  assert.equal(event.stage, 'provider'); assert.equal(event.upstreamStatus, 503);
  assert.equal(event.providerCode, 'no_available_channel');
  const forged = new ChatUpstreamError(503, 'AI_UNAVAILABLE', true, undefined,
    { stage: KEY, upstreamStatus: KEY, providerCode: KEY });
  assert.equal(forged.stage, 'transport');
  assert.equal(forged.upstreamStatus, undefined); assert.equal(forged.providerCode, undefined);
  groups++;

  for (const [status, code] of [[402, 'insufficient_quota'], [429, 'insufficient_quota']]) {
    await failure(async () => rejection(status, code), { status: 503, code: 'AI_QUOTA', retryable: false, calls: 1 });
  }
  await failure(async () => rejection(429, null, { type: 'insufficient_quota' }),
    { status: 503, code: 'AI_QUOTA', retryable: false, calls: 1 });
  const busy = await failure(async () => rejection(429, 'rate_limit_exceeded'), { status: 429, code: 'AI_BUSY', retryable: true, calls: 2 });
  assert.ok(Number.isFinite(busy.error.retryAfter) && busy.error.retryAfter > 0);
  for (const [status, wait, code] of [[429, 60, 'AI_BUSY'], [503, 3, 'AI_UNAVAILABLE']]) {
    const cooledDown = await failure(async () => json({ error: { code: 'rate_limit_exceeded', message: PROVIDER_DETAIL } }, status, { 'Retry-After': String(wait) }),
      { status: status === 429 ? 429 : 503, code, retryable: true, calls: 1 });
    assert.equal(cooledDown.error.retryAfter, wait, 'A long provider cooldown must be returned instead of sending again');
  }
  const retryDate = new Date(Date.now() + 60000).toUTCString();
  const dated = await failure(async () => json({ error: { code: 'rate_limit_exceeded' } }, 429, { 'Retry-After': retryDate }),
    { status: 429, code: 'AI_BUSY', retryable: true, calls: 1 });
  assert.ok(dated.error.retryAfter >= 59 && dated.error.retryAfter <= 60, 'An HTTP-date cooldown must be converted to seconds');
  let shortCooldownCalls = 0;
  const shortCooldownStarted = Date.now();
  assert.equal(await requestChatCompletion({ ...defaults, logger: () => {}, upstream: async () => {
    return ++shortCooldownCalls === 1 ? json({ error: { code: 'server_error' } }, 503, { 'Retry-After': '1' }) : answer();
  } }), content);
  assert.equal(shortCooldownCalls, 2);
  assert.ok(Date.now() - shortCooldownStarted >= 900, 'The short automatic retry must honor the provider delay');
  groups++;

  for (const status of [500, 502, 503, 504]) {
    let calls = 0;
    const recovered = await requestChatCompletion({ ...defaults, logger: () => {}, upstream: async () => ++calls === 1 ? rejection(status, 'server_error') : answer() });
    assert.equal(recovered, content); assert.equal(calls, 2);
  }
  await failure(async () => rejection(503, 'server_error'), { status: 503, code: 'AI_UNAVAILABLE', retryable: true, calls: 2 });
  groups++;

  let networkCalls = 0;
  assert.equal(await requestChatCompletion({ ...defaults, logger: () => {}, upstream: async () => {
    if (++networkCalls === 1) throw new TypeError(PROVIDER_DETAIL);
    return answer();
  } }), content);
  assert.equal(networkCalls, 2);
  await failure(async () => { throw new TypeError(PROVIDER_DETAIL); }, {
    status: 502, code: 'AI_NETWORK', retryable: true, calls: 2, stage: 'transport', upstreamStatus: undefined, providerCode: undefined
  });
  groups++;

  for (const value of [null, '', '   ', 12, [], {}]) {
    await failure(async () => answer(value), { status: 502, code: 'AI_RESPONSE', retryable: true, calls: 1,
      stage: 'provider', upstreamStatus: undefined, providerCode: undefined });
  }
  await failure(async () => new Response('<html>upstream unavailable</html>', { status: 200 }), { status: 502, code: 'AI_RESPONSE', retryable: true, calls: 1 });
  groups++;

  let aborted = false;
  const started = Date.now();
  await failure(async (_url, { signal }) => new Promise((_resolve, reject) => {
    const abort = () => { aborted = true; reject(signal.reason); };
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  }), { status: 504, code: 'AI_TIMEOUT', retryable: true, calls: 1 }, { timeoutMs: 35 });
  assert.equal(aborted, true);
  assert.ok(Date.now() - started < 1000, 'The single request deadline must abort an outstanding provider request');
  const backoffStarted = Date.now();
  await failure(async () => rejection(503, 'server_error'), { status: 504, code: 'AI_TIMEOUT', retryable: true, calls: 1 }, { timeoutMs: 35, retryDelayMs: 1000 });
  assert.ok(Date.now() - backoffStarted < 1000, 'Retry backoff must share the deadline instead of extending it');
  await failure(async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }),
    { status: 504, code: 'AI_TIMEOUT', retryable: true, calls: 1 }, { timeoutMs: 35 });
  const timeoutLog = await failure(async () => ({ ok: false, status: 503, json: () => new Promise(() => {}) }),
    { status: 504, code: 'AI_TIMEOUT', retryable: true, calls: 1 }, { timeoutMs: 35 });
  assert.ok(timeoutLog.logs.length > 0, 'A timeout while reading an error response should produce a safe diagnostic event');
  groups++;

  // HTTP exercises the real API wrapper; upstream requests remain local fixtures.
  let calls = 0;
  const captured = [];
  await withServer(async (_url, options) => {
    captured.push(JSON.parse(options.body));
    return ++calls === 1 ? rejection(503, 'server_error') : answer();
  }, async server => {
    const home = await request(server, '/api/home-chat', { question: QUESTION, history: [] });
    assert.equal(home.status, 200); assert.deepEqual(home.data, { reply: content });
    assert.equal(home.headers['access-control-allow-origin'], 'https://chat.test');
    const tutor = await request(server, '/api/tutor', { course: 'microbit', lesson: 'counter', question: QUESTION, history: [] });
    assert.equal(tutor.status, 200); assert.deepEqual(tutor.data, { reply: content });
    assert.equal(calls, 3, 'One transient error should recover without needing a second user submission');
    assert.ok(captured[2].messages[0].content.includes('microbit') || captured[2].messages[0].content.includes('micro:bit'));
    assert.equal((await request(server, '/api/home-chat', { question: QUESTION }, 'https://wrong.test')).status, 403);
    assert.equal(calls, 3, 'An invalid origin must not reach the provider');
  });
  groups++;

  let authCalls = 0;
  await withServer(async () => { authCalls++; return rejection(401, 'invalid_api_key'); }, async server => {
    for (const path of ['/api/home-chat', '/api/tutor']) {
      const response = await request(server, path, { question: QUESTION, course: 'arduino', lesson: 'led' });
      assert.equal(response.status, 503); assert.equal(response.data.code, 'AI_AUTH');
      assert.equal(response.data.retryable, false);
      assert.equal(response.data.stage, 'provider');
      assert.equal(response.data.upstreamStatus, 401);
      assert.equal(response.data.providerCode, 'invalid_api_key');
      assert.ok(typeof response.data.error === 'string' && response.data.error.length > 0);
      for (const secret of [KEY, QUESTION, PROVIDER_DETAIL]) assert.ok(!JSON.stringify(response.data).includes(secret));
    }
    assert.equal(authCalls, 2);
  });
  for (const [status, wait, code] of [[429, 60, 'AI_BUSY'], [503, 3, 'AI_UNAVAILABLE']]) {
    let cooldownCalls = 0;
    await withServer(async () => {
      cooldownCalls++;
      return json({ error: { code: 'server_error', message: PROVIDER_DETAIL } }, status, { 'Retry-After': String(wait) });
    }, async server => {
      const response = await request(server, '/api/home-chat', { question: QUESTION });
      assert.equal(response.status, status);
      assert.equal(response.data.code, code);
      assert.equal(response.data.retryable, true);
      assert.equal(response.data.stage, 'provider');
      assert.equal(response.data.upstreamStatus, status);
      assert.equal(response.data.providerCode, 'server_error');
      assert.equal(response.headers['retry-after'], String(wait), 'The public API must preserve the provider cooldown');
      assert.equal(cooldownCalls, 1);
    });
  }
  groups++;

  for (const providerCode of ['model_not_found', KEY]) {
    let diagnosticCalls = 0;
    await withServer(async () => { diagnosticCalls++; return rejection(503, providerCode); }, async server => {
      const response = await request(server, '/api/home-chat', { question: QUESTION });
      assert.equal(response.status, 503);
      assert.equal(response.data.stage, 'provider');
      assert.equal(response.data.upstreamStatus, 503);
      assert.equal(response.data.code, providerCode === KEY ? 'AI_UNAVAILABLE' : 'AI_MODEL');
      assert.equal(response.data.retryable, providerCode === KEY);
      assert.equal(response.data.providerCode, providerCode === KEY ? undefined : providerCode);
      assert.ok(/^[0-9a-f-]{36}$/i.test(response.data.requestId));
      assert.equal(diagnosticCalls, providerCode === KEY ? 2 : 1);
      for (const secret of [KEY, QUESTION, PROVIDER_DETAIL]) assert.ok(!JSON.stringify(response.data).includes(secret));
    });
  }
  groups++;

  let blankCalls = 0;
  await withServer(async () => { blankCalls++; return answer(); }, async server => {
    const missing = await request(server, '/api/home-chat', { question: QUESTION });
    assert.equal(missing.status, 503);
    assert.equal(missing.data.stage, 'server');
    assert.equal(missing.data.upstreamStatus, undefined);
    assert.equal(blankCalls, 0, 'A whitespace-only key must be rejected before any provider call');
  }, { key: '   ' });
  groups++;

  // Failed attempts keep the shared concurrency/quota accounting bounded.
  let quotaCalls = 0;
  await withServer(async () => { quotaCalls++; return rejection(401, 'invalid_api_key'); }, async server => {
    assert.equal((await request(server, '/api/home-chat', { question: QUESTION })).status, 503);
    assert.equal((await request(server, '/api/home-chat', { question: QUESTION })).status, 429);
    assert.equal(quotaCalls, 1, 'A rejected daily quota must not trigger another paid call');
  }, { limit: 1 });
  groups++;

  console.log(`PASS ${groups} chat upstream groups: canonical response, safe provider diagnostics/model classification, private failures, bounded recovery/deadlines, actual home-chat/tutor HTTP, key/origin/quota gates and no paid requests`);
} finally {
  for (const [name, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}
