import assert from 'node:assert/strict';
import http from 'node:http';
import { ChatUpstreamError, requestChatCompletion } from '../ai-server/chat-upstream.mjs';

// All provider responses below are fixtures. Only the API wrapper uses real,
// loopback HTTP; this suite never contacts Woku or a paid model.
const KEY = 'private-recovery-key-never-return';
const QUESTION = 'private-recovery-question-never-return';
const DETAIL = 'private-provider-detail-never-return';
const PRIMARY = 'gemini-4-argon';
const FALLBACK = 'gemini-2.5-flash';
const REPLY = 'Phản hồi fixture từ lần gọi khôi phục.';
const messages = [{ role: 'system', content: 'Giải thích từng bước.' }, { role: 'user', content: QUESTION }];
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', ...headers }
});
const answer = () => json({ choices: [{ message: { content: REPLY } }] });
const reject = (status = 503, code = 'server_error', headers = {}) => json({ error: { code, message: DETAIL } }, status, headers);
const catalog = ids => json({ data: ids.map(id => ({ id })) });
const prior = Object.fromEntries(['NODE_ENV', 'ALLOWED_ORIGIN', 'AI_MODEL', 'WOKU_API_KEY', 'DAILY_REQUEST_LIMIT'].map(name => [name, process.env[name]]));
let imported = 0, groups = 0;

function privateOutput(value) {
  const output = JSON.stringify(value);
  for (const secret of [KEY, QUESTION, DETAIL, PRIMARY, FALLBACK]) {
    assert.ok(!output.includes(secret), 'Public replies and diagnostic logs must omit private request/model/provider data');
  }
}

async function withServer(upstream, test, { model = PRIMARY, key = KEY, limit = 50 } = {}) {
  process.env.NODE_ENV = 'test';
  process.env.ALLOWED_ORIGIN = 'https://recovery.test';
  process.env.AI_MODEL = model;
  process.env.WOKU_API_KEY = key;
  process.env.DAILY_REQUEST_LIMIT = String(limit);
  const { createServer } = await import(`../ai-server/server.mjs?model-recovery=${++imported}`);
  const calls = [], logs = [];
  const savedError = console.error;
  console.error = (...items) => logs.push(items);
  const server = createServer(async (url, options) => {
    calls.push({ url, options });
    return upstream(url, options, calls);
  });
  try {
    await new Promise((resolve, rejectPromise) => { server.once('error', rejectPromise); server.listen(0, '127.0.0.1', resolve); });
    await test(server, calls, logs);
    privateOutput(logs);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    console.error = savedError;
  }
}

function request(server, path = '/api/home-chat') {
  const body = JSON.stringify({ question: QUESTION, course: 'microbit', lesson: 'counter', history: [] });
  return new Promise((resolve, rejectPromise) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method: 'POST', headers: {
      Origin: 'https://recovery.test', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)
    } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', rejectPromise);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (error) { rejectPromise(error); }
      });
    });
    req.on('error', rejectPromise); req.end(body);
  });
}

function completionCalls(calls) { return calls.filter(call => call.options.method === 'POST'); }
function modelCalls(calls) { return calls.filter(call => call.options.method === 'GET'); }
function assertSameRequest(first, second) {
  const firstBody = JSON.parse(first.options.body), secondBody = JSON.parse(second.options.body);
  assert.equal(first.url, 'https://llm.wokushop.com/v1/chat/completions');
  assert.equal(second.url, first.url);
  assert.deepEqual(firstBody.messages, secondBody.messages);
  assert.equal(firstBody.max_tokens, secondBody.max_tokens);
  assert.equal(first.options.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(second.options.headers.Authorization, first.options.headers.Authorization);
  assert.equal(secondBody.model, FALLBACK);
}

async function directFailure(upstream, expected, overrides = {}) {
  let posts = 0, resolutions = 0;
  const logs = [];
  const { resolveFallbackModel = async () => FALLBACK, ...settings } = overrides;
  await assert.rejects(requestChatCompletion({ apiKey: KEY, model: PRIMARY, messages, retryDelayMs: 0,
    requestId: 'recovery-local-request', logger: (...items) => logs.push(items),
    upstream: async (...args) => { posts++; return upstream(...args); },
    resolveFallbackModel: async (...args) => { resolutions++; return resolveFallbackModel(...args); }, ...settings
  }), error => {
    assert.ok(error instanceof ChatUpstreamError);
    assert.equal(error.code, expected.code);
    if (expected.upstreamStatus !== undefined) assert.equal(error.upstreamStatus, expected.upstreamStatus);
    for (const field of ['catalogStatus', 'catalogResult', 'candidateCount', 'fallbackAttempted']) {
      if (Object.hasOwn(expected, field)) assert.equal(error[field], expected[field]);
    }
    privateOutput({ error: { ...error, message: error.message }, logs });
    return true;
  });
  assert.equal(posts, expected.posts);
  assert.equal(resolutions, expected.resolutions);
}

try {
  let resolved = 0, posts = 0;
  const direct = await requestChatCompletion({ apiKey: KEY, model: PRIMARY, messages, retryDelayMs: 0,
    upstream: async () => { posts++; return answer(); }, logger: () => {},
    resolveFallbackModel: async () => { resolved++; return FALLBACK; }
  });
  assert.equal(direct, REPLY); assert.equal(posts, 1); assert.equal(resolved, 0);
  groups++;

  // The resolver sees the caller's configured ID verbatim, including an ID
  // entered with spaces. It may only replace it with an exact catalog member.
  for (const model of [PRIMARY, 'gemini 4 -aron']) {
    await withServer(async (_url, options) => {
      if (options.method === 'GET') return catalog([FALLBACK]);
      return JSON.parse(options.body).model === FALLBACK ? answer() : reject();
    }, async (server, calls) => {
      const response = await request(server);
      assert.equal(response.status, 200); assert.equal(response.data.reply, REPLY);
      assert.equal(response.headers['access-control-allow-origin'], 'https://recovery.test');
      assert.deepEqual(calls.map(call => call.options.method), ['POST', 'GET', 'POST']);
      assert.equal(JSON.parse(calls[0].options.body).model, model, 'Do not silently guess or normalize the configured model ID');
      assertSameRequest(calls[0], calls[2]);
      assert.equal(calls[1].url, 'https://llm.wokushop.com/v1/models');
      assert.equal(calls[1].options.headers.Authorization, `Bearer ${KEY}`);
      assert.equal(calls[1].options.body, undefined, 'Catalog lookup must not send the question or conversation');
      privateOutput(response.data);
    }, { model });
  }
  groups++;

  await withServer(async () => answer(), async (server, calls) => {
    assert.equal((await request(server)).status, 200);
    assert.equal(calls.length, 1); assert.equal(modelCalls(calls).length, 0);
  });
  groups++;

  for (const model of ['configured-test-model', 'gpt-4o-mini']) {
    await withServer(async () => reject(), async (server, calls) => {
      const response = await request(server);
      assert.equal(response.status, 503); assert.equal(response.data.code, 'AI_UNAVAILABLE');
      assert.equal(completionCalls(calls).length, 2); assert.equal(modelCalls(calls).length, 0);
      assert.ok(completionCalls(calls).every(call => JSON.parse(call.options.body).model === model));
      privateOutput(response.data);
    }, { model });
  }
  groups++;

  for (const [listing, catalogStatus, catalogResult, candidateCount] of [
    [() => catalog(['unapproved-premium-model', PRIMARY]), 200, 'ok', 0],
    [() => json({ data: null }), 200, 'invalid_response'],
    [() => new Response('<html>not a catalog</html>', { status: 200 }), 200, 'invalid_response'],
    [() => reject(401, 'invalid_api_key'), 401, 'http_error'], [() => reject(503), 503, 'http_error']
  ]) {
    await withServer(async (_url, options) => options.method === 'GET' ? listing() : reject(), async (server, calls) => {
      const response = await request(server);
      assert.equal(response.status, 503); assert.equal(response.data.code, 'AI_UNAVAILABLE');
      assert.equal(completionCalls(calls).length, 2, 'An unusable catalog must not add a third completion attempt');
      assert.equal(modelCalls(calls).length, 1);
      assert.equal(response.data.catalogStatus, catalogStatus);
      assert.equal(response.data.catalogResult, catalogResult);
      assert.equal(response.data.candidateCount, candidateCount);
      assert.equal(response.data.fallbackAttempted, false);
      assert.ok(completionCalls(calls).every(call => JSON.parse(call.options.body).model === PRIMARY));
      privateOutput(response.data);
    });
  }
  groups++;

  await withServer(async (_url, options) => {
    if (options.method === 'GET') return catalog([FALLBACK]);
    return JSON.parse(options.body).model === FALLBACK ? answer() : reject(400, 'model_not_found');
  }, async (server, calls) => {
    const response = await request(server);
    assert.equal(response.status, 200); assert.equal(response.data.reply, REPLY);
    assert.equal(completionCalls(calls).length, 2); assert.equal(modelCalls(calls).length, 1);
    assertSameRequest(completionCalls(calls)[0], completionCalls(calls)[1]);
  });
  await directFailure(async () => reject(400, 'model_not_found'), { code: 'AI_MODEL', posts: 1, resolutions: 1 }, {
    resolveFallbackModel: async () => null
  });
  groups++;

  for (const [status, code, headers, expectedPosts, publicCode] of [
    [401, 'invalid_api_key', {}, 1, 'AI_AUTH'], [403, 'access_denied', {}, 1, 'AI_AUTH'],
    [503, 'invalid_api_key', {}, 1, 'AI_AUTH'],
    [402, 'insufficient_quota', {}, 1, 'AI_QUOTA'], [503, 'insufficient_quota', {}, 1, 'AI_QUOTA'],
    [429, 'rate_limit_exceeded', {}, 2, 'AI_BUSY'], [429, 'rate_limit_exceeded', { 'Retry-After': '3' }, 1, 'AI_BUSY'],
    [503, 'server_error', { 'Retry-After': '3' }, 1, 'AI_UNAVAILABLE'], [408, 'server_error', {}, 2, 'AI_UNAVAILABLE']
  ]) await directFailure(async () => reject(status, code, headers), { code: publicCode, posts: expectedPosts, resolutions: 0 });
  await directFailure(async () => json({ error: { type: 'authentication_error', message: DETAIL } }, 503),
    { code: 'AI_AUTH', posts: 1, resolutions: 0 });
  groups++;

  await withServer(async (_url, options) => {
    if (options.method === 'GET') return catalog([FALLBACK]);
    return JSON.parse(options.body).model === FALLBACK ? reject(502, 'server_error') : reject(503);
  }, async (server, calls) => {
    const response = await request(server);
    assert.equal(response.status, 503); assert.equal(response.data.code, 'AI_UNAVAILABLE');
    assert.equal(response.data.stage, 'provider'); assert.equal(response.data.upstreamStatus, 502);
    assert.equal(response.data.providerCode, 'server_error');
    assert.equal(response.data.catalogStatus, 200);
    assert.equal(response.data.catalogResult, 'ok');
    assert.equal(response.data.candidateCount, 1);
    assert.equal(response.data.fallbackAttempted, true);
    assert.equal(completionCalls(calls).length, 2); assert.equal(modelCalls(calls).length, 1);
    privateOutput(response.data);
  });
  groups++;

  await withServer(async (_url, options) => {
    if (options.method === 'GET') return catalog([FALLBACK]);
    return JSON.parse(options.body).model === FALLBACK ? answer() : reject();
  }, async (server, calls) => {
    const home = await request(server), tutor = await request(server, '/api/tutor');
    assert.equal(home.status, 200); assert.equal(tutor.status, 200);
    assert.equal(home.data.reply, REPLY); assert.equal(tutor.data.reply, REPLY);
    assert.equal(completionCalls(calls).length, 4); assert.equal(modelCalls(calls).length, 1, 'Both real routes reuse only the verified catalog cache');
    privateOutput([home.data, tutor.data]);
  });
  groups++;

  for (const candidate of [KEY, 'unapproved-premium-model', '', null, PRIMARY, [FALLBACK], { id: FALLBACK }]) {
    await directFailure(async () => reject(), { code: 'AI_UNAVAILABLE', posts: 2, resolutions: 1 }, {
      resolveFallbackModel: async () => candidate
    });
  }
  await directFailure(async () => reject(), { code: 'AI_UNAVAILABLE', posts: 2, resolutions: 1 }, {
    resolveFallbackModel: async () => { throw new Error(KEY); }
  });
  await directFailure(async () => reject(), {
    code:'AI_UNAVAILABLE',posts:2,resolutions:1,catalogStatus:undefined,catalogResult:undefined,
    candidateCount:undefined,fallbackAttempted:false
  }, {
    resolveFallbackModel: async ({ onDiagnostic }) => {
      onDiagnostic({ catalogStatus:KEY,catalogResult:DETAIL,candidateCount:4,fallbackAttempted:true,raw:QUESTION });
      return null;
    }
  });
  groups++;

  let callsDuringResolution = 0, resolutionSignal, release;
  const blockedResolution = new Promise(resolve => { release = resolve; });
  const started = Date.now();
  await assert.rejects(requestChatCompletion({ apiKey: KEY, model: PRIMARY, messages, retryDelayMs: 0, timeoutMs: 35,
    logger: () => {}, upstream: async () => { callsDuringResolution++; return reject(); },
    resolveFallbackModel: ({ signal }) => { resolutionSignal = signal; return blockedResolution; }
  }), error => error.code === 'AI_TIMEOUT');
  assert.ok(Date.now() - started < 1000);
  assert.equal(resolutionSignal.aborted, true); assert.equal(callsDuringResolution, 1);
  release(FALLBACK);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(callsDuringResolution, 1, 'A late catalog result must not trigger a completion after the shared deadline');
  groups++;

  await withServer(async (_url, options) => {
    if (options.method === 'GET') return catalog([FALLBACK]);
    return JSON.parse(options.body).model === FALLBACK ? answer() : reject();
  }, async (server, calls) => {
    assert.equal((await request(server)).status, 200);
    assert.equal((await request(server)).status, 429);
    assert.equal(completionCalls(calls).length, 2); assert.equal(modelCalls(calls).length, 1);
  }, { limit: 1 });
  groups++;

  console.log(`PASS ${groups} model recovery groups: verified same-provider fallback, exact catalog membership, bounded two-POST recovery/deadlines, real chat/tutor HTTP, protected auth/quota/cooldowns and private diagnostics`);
} finally {
  for (const [name, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}
