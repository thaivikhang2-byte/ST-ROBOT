import assert from 'node:assert/strict';
import http from 'node:http';
import { requestChatCompletion } from '../ai-server/chat-upstream.mjs';
import { createModelFallbackResolver } from '../ai-server/model-fallback.mjs';

// Only the application API uses real loopback HTTP. Every provider response is
// injected below; this suite never contacts Google, Woku or a paid model.
const ORIGIN = 'https://provider-routing.test';
const WOKU_KEY = 'local-private-woku-routing-key';
const GEMINI_KEY = 'local-private-google-routing-key';
const ROTATED_KEY = 'local-private-selected-rotated-key';
const QUESTION = 'local-private-provider-routing-question';
const DETAIL = 'local-private-provider-error-detail';
const REPLY = 'Phản hồi kiểm tra định tuyến.';
const WOKU_MODEL = 'gemini-4-argon';
const GEMINI_MODEL = 'gemini-3.8-flash';
const FALLBACK = 'models/gemini-2.5-flash';
const LEGACY_TYPO = 'gemini 4 -aron';
const URLS = {
  woku: { chat: 'https://llm.wokushop.com/v1/chat/completions', catalog: 'https://llm.wokushop.com/v1/models' },
  gemini: { chat: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    catalog: 'https://generativelanguage.googleapis.com/v1beta/openai/models' }
};
const envNames = ['NODE_ENV', 'ALLOWED_ORIGIN', 'DAILY_REQUEST_LIMIT', 'RENDER_GIT_COMMIT',
  'AI_PROVIDER', 'WOKU_API_KEY', 'AI_MODEL', 'GEMINI_API_KEY', 'GEMINI_MODEL',
  'AI_BASE_URL', 'GEMINI_BASE_URL', 'OPENAI_BASE_URL', 'CHAT_ENDPOINT', 'CATALOG_ENDPOINT'];
const prior = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
const chatBody = { question: QUESTION, course: 'microbit', lesson: 'counter', history: [] };
const planBody = { courseId: 'arduino', lessonId: 'led', count: 1, level: 'all', weakLessonIds: ['led'] };
const messages = [{ role: 'user', content: QUESTION }];
let imports = 0, groups = 0;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' }
});
const answer = () => json({ choices: [{ message: { content: REPLY } }] });
const failure = (status = 404, code = 'model_not_found') => json({ error: { code, message: DETAIL } }, status);
const catalog = ids => json({ data: ids.map(id => ({ id })) });

function privateOutput(value) {
  const output = JSON.stringify(value);
  for (const marker of [WOKU_KEY, GEMINI_KEY, ROTATED_KEY, QUESTION, DETAIL,
    WOKU_MODEL, GEMINI_MODEL, FALLBACK, LEGACY_TYPO, 'configured-woku-model', 'configured-google-model']) {
    assert.ok(!output.includes(marker), 'Public diagnostics must omit keys, questions, models and raw provider details');
  }
}

function configure(env = {}) {
  for (const name of envNames) delete process.env[name];
  Object.assign(process.env, { NODE_ENV: 'test', ALLOWED_ORIGIN: ORIGIN, DAILY_REQUEST_LIMIT: '50' }, env);
}

async function withServer(env, upstream, test) {
  configure(env);
  const { createServer } = await import(`../ai-server/server.mjs?provider-routing=${++imports}`);
  const calls = [], logs = [];
  const savedError = console.error;
  console.error = (...items) => logs.push(items);
  const server = createServer(async (url, options) => {
    calls.push({ url, options });
    return upstream(url, options, calls);
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    await test(server, calls, logs);
    privateOutput(logs);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    console.error = savedError;
  }
}

function request(server, { method = 'POST', path = '/api/home-chat', body = chatBody, origin = ORIGIN } = {}) {
  const encoded = method === 'GET' || method === 'OPTIONS' ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, method, path,
      headers: { Origin: origin, ...(encoded === undefined ? {} : {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded)
      }) }
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, headers: res.headers, data: text ? JSON.parse(text) : null });
        } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.end(encoded);
  });
}

function assertCall(call, provider, key, model, tokens = 1200) {
  assert.equal(call.url, URLS[provider].chat);
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.headers.Authorization, `Bearer ${key}`);
  assert.equal(call.options.headers['Content-Type'], 'application/json');
  assert.ok(call.options.signal instanceof AbortSignal);
  const body = JSON.parse(call.options.body);
  assert.equal(body.model, model);
  assert.equal(body.max_tokens, tokens);
  assert.ok(Array.isArray(body.messages) && body.messages.length > 0);
  return body;
}

function assertOnlyProvider(calls, provider, key) {
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.ok([URLS[provider].chat, URLS[provider].catalog].includes(call.url));
    assert.equal(call.options.headers.Authorization, `Bearer ${key}`);
    assert.ok(!JSON.stringify(call.options).includes(provider === 'gemini' ? WOKU_KEY : GEMINI_KEY));
  }
}

async function assertHealth(server, provider, keyConfigured, modelConfigured) {
  const result = await request(server, { method: 'GET', path: '/health' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { ok: true, revision: null,
    ai: { provider, keyConfigured, modelConfigured, allowedOrigin: ORIGIN } });
  assert.equal(result.headers['cache-control'], 'no-store');
  privateOutput(result.data);
}

function successfulUpstream(_url, options) {
  const body = JSON.parse(options.body);
  if (body.max_tokens === 600) {
    const prompt = JSON.parse(body.messages[1].content);
    assert.ok(prompt.templates.length > 0);
    return json({ choices: [{ message: { content: JSON.stringify({ templateIds: [prompt.templates[0].id] }) } }] });
  }
  return answer();
}

try {
  // Existing deployments still use Woku with its original default model, key,
  // tutor route and planner token budget when no Google key is configured.
  await withServer({ WOKU_API_KEY: WOKU_KEY }, successfulUpstream, async (server, calls) => {
    await assertHealth(server, 'woku', true, false);
    for (const path of ['/api/home-chat', '/api/tutor']) {
      assert.deepEqual((await request(server, { path })).data, { reply: REPLY });
    }
    const plan = await request(server, { path: '/api/practice-plan', body: planBody });
    assert.equal(plan.status, 200);
    assert.equal(plan.data.source, 'ai-plan');
    assert.equal(plan.data.model, WOKU_MODEL);
    assert.equal(calls.length, 3);
    calls.forEach((call, index) => assertCall(call, 'woku', WOKU_KEY, WOKU_MODEL, index === 2 ? 600 : 1200));
    assertOnlyProvider(calls, 'woku', WOKU_KEY);
  });
  groups++;

  // Explicit selection wins when both credentials and model settings exist.
  await withServer({ AI_PROVIDER: 'woku', WOKU_API_KEY: WOKU_KEY, GEMINI_API_KEY: GEMINI_KEY,
    AI_MODEL: ' configured-woku-model ', GEMINI_MODEL: 'configured-google-model' }, answer,
  async (server, calls) => {
    await assertHealth(server, 'woku', true, true);
    assert.equal((await request(server)).status, 200);
    assertCall(calls[0], 'woku', WOKU_KEY, 'configured-woku-model');
    assertOnlyProvider(calls, 'woku', WOKU_KEY);
  });
  groups++;

  await withServer({ AI_PROVIDER: 'gemini', WOKU_API_KEY: WOKU_KEY, GEMINI_API_KEY: GEMINI_KEY,
    AI_MODEL: LEGACY_TYPO, AI_BASE_URL: 'https://untrusted.invalid',
    GEMINI_BASE_URL: 'https://untrusted.invalid', CHAT_ENDPOINT: 'https://untrusted.invalid' },
  successfulUpstream, async (server, calls) => {
    await assertHealth(server, 'gemini', true, false);
    // User JSON and generic environment URL fields cannot select a destination,
    // credential, model or provider. Only server-owned configuration may do so.
    const body = { ...chatBody, endpoint: 'https://untrusted.invalid', catalogUrl: URLS.woku.catalog,
      baseUrl: URLS.woku.chat, provider: 'woku', apiKey: WOKU_KEY, model: LEGACY_TYPO };
    assert.equal((await request(server, { body })).status, 200);
    assert.equal((await request(server, { path: '/api/tutor' })).status, 200);
    assert.equal((await request(server, { path: '/api/practice-plan', body: planBody })).status, 200);
    assert.equal(calls.length, 3);
    calls.forEach((call, index) => assertCall(call, 'gemini', GEMINI_KEY, GEMINI_MODEL, index === 2 ? 600 : 1200));
    assertOnlyProvider(calls, 'gemini', GEMINI_KEY);
  });
  groups++;

  // A Google key alone never changes the existing paid provider. Switching
  // providers requires an explicit AI_PROVIDER=gemini setting.
  for (const env of [
    { GEMINI_API_KEY: GEMINI_KEY },
    { AI_PROVIDER: ' \t ', GEMINI_API_KEY: GEMINI_KEY, WOKU_API_KEY: WOKU_KEY,
      AI_MODEL: LEGACY_TYPO, GEMINI_MODEL: ' configured-google-model ' }
  ]) {
    await withServer(env, answer, async (server, calls) => {
      await assertHealth(server, 'woku', Boolean(env.WOKU_API_KEY), Boolean(env.AI_MODEL));
      assert.equal((await request(server)).status, env.WOKU_API_KEY ? 200 : 503);
      if (env.WOKU_API_KEY) {
        assertCall(calls[0], 'woku', WOKU_KEY, LEGACY_TYPO);
        assertOnlyProvider(calls, 'woku', WOKU_KEY);
      } else assert.equal(calls.length, 0);
    });
  }
  await withServer({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: GEMINI_KEY, WOKU_API_KEY: WOKU_KEY,
    AI_MODEL: LEGACY_TYPO, GEMINI_MODEL: ' configured-google-model ' }, answer,
  async (server, calls) => {
    await assertHealth(server, 'gemini', true, true);
    assert.equal((await request(server)).status, 200);
    assertCall(calls[0], 'gemini', GEMINI_KEY, 'configured-google-model');
    assertOnlyProvider(calls, 'gemini', GEMINI_KEY);
  });
  groups++;

  // Catalog recovery must stay on Google's catalog and completion URLs with
  // Google's credential, preserving the exact advertised fallback model ID.
  await withServer({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: GEMINI_KEY, WOKU_API_KEY: WOKU_KEY },
  async (_url, options) => {
    if (options.method === 'GET') return catalog([FALLBACK]);
    return JSON.parse(options.body).model === FALLBACK ? answer() : failure();
  }, async (server, calls) => {
    const result = await request(server);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { reply: REPLY });
    assert.deepEqual(calls.map(call => call.url), [URLS.gemini.chat, URLS.gemini.catalog, URLS.gemini.chat]);
    const primary = assertCall(calls[0], 'gemini', GEMINI_KEY, GEMINI_MODEL);
    const recovered = assertCall(calls[2], 'gemini', GEMINI_KEY, FALLBACK);
    assert.deepEqual(recovered.messages, primary.messages);
    assertOnlyProvider(calls, 'gemini', GEMINI_KEY);
    privateOutput(result.data);
  });
  groups++;

  await withServer({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: GEMINI_KEY, WOKU_API_KEY: WOKU_KEY },
  async (_url, options) => options.method === 'GET' ? failure(401, 'invalid_api_key') : failure(),
  async (server, calls) => {
    const result = await request(server);
    assert.equal(result.status, 503);
    assert.equal(result.data.code, 'AI_MODEL');
    assert.match(result.data.error, /kiểm tra cấu hình mô hình trên máy chủ/);
    assert.ok(!result.data.error.includes('AI_MODEL'), 'Google repair guidance must not point to the ignored Woku variable');
    assert.equal(result.data.catalogResult, 'http_error');
    assert.deepEqual(calls.map(call => call.url), [URLS.gemini.chat, URLS.gemini.catalog]);
    assertOnlyProvider(calls, 'gemini', GEMINI_KEY);
    privateOutput(result.data);
  });
  groups++;

  // An explicit provider without its own key cannot use the other provider's
  // available key, even for the planning route or health readiness flags.
  for (const emptyKey of [undefined, ' \t\n ']) {
    const env = { AI_PROVIDER: 'gemini', WOKU_API_KEY: WOKU_KEY, AI_MODEL: LEGACY_TYPO };
    if (emptyKey !== undefined) env.GEMINI_API_KEY = emptyKey;
    await withServer(env, () => { throw new Error('Missing selected key must not reach an upstream'); },
    async (server, calls) => {
      await assertHealth(server, 'gemini', false, false);
      for (const path of ['/api/home-chat', '/api/tutor', '/api/practice-plan']) {
        const result = await request(server, { path, body: path.endsWith('practice-plan') ? planBody : chatBody });
        assert.equal(result.status, 503);
        assert.equal(result.data.code, 'AI_AUTH');
        assert.equal(result.data.stage, 'server');
        assert.equal(result.data.retryable, false);
        privateOutput(result.data);
      }
      assert.equal(calls.length, 0);
    });
  }
  await withServer({ AI_PROVIDER: 'woku', GEMINI_API_KEY: GEMINI_KEY, GEMINI_MODEL: 'configured-google-model' }, answer,
  async (server, calls) => {
    await assertHealth(server, 'woku', false, false);
    assert.equal((await request(server)).status, 503);
    assert.equal(calls.length, 0);
  });
  groups++;

  // Provider identity, model and destinations are pinned when the server is
  // constructed. Its selected credential is read fresh for deletion/rotation.
  for (const provider of ['gemini', 'woku']) {
    const keyName = provider === 'gemini' ? 'GEMINI_API_KEY' : 'WOKU_API_KEY';
    const otherKeyName = provider === 'gemini' ? 'WOKU_API_KEY' : 'GEMINI_API_KEY';
    const modelName = provider === 'gemini' ? 'GEMINI_MODEL' : 'AI_MODEL';
    const model = provider === 'gemini' ? GEMINI_MODEL : WOKU_MODEL;
    await withServer({ AI_PROVIDER: provider, [keyName]: provider === 'gemini' ? GEMINI_KEY : WOKU_KEY },
    async (_url, options) => {
      if (options.method === 'GET') return catalog([FALLBACK]);
      return JSON.parse(options.body).model === FALLBACK ? answer() : failure();
    },
    async (server, calls) => {
      process.env.AI_PROVIDER = provider === 'gemini' ? 'woku' : 'gemini';
      process.env[otherKeyName] = provider === 'gemini' ? WOKU_KEY : GEMINI_KEY;
      process.env[modelName] = 'mutated-model-must-not-be-requested';
      delete process.env[keyName];
      await assertHealth(server, provider, false, true);
      assert.equal((await request(server)).status, 503);
      assert.equal(calls.length, 0);
      process.env[keyName] = ` ${ROTATED_KEY} `;
      assert.equal((await request(server)).status, 200);
      assert.deepEqual(calls.map(call => call.url), [URLS[provider].chat, URLS[provider].catalog, URLS[provider].chat]);
      assertCall(calls[0], provider, ROTATED_KEY, model);
      assertCall(calls[2], provider, ROTATED_KEY, FALLBACK);
      assertOnlyProvider(calls, provider, ROTATED_KEY);
      delete process.env[keyName];
      assert.equal((await request(server)).status, 503);
      assert.equal(calls.length, 3, 'Deleting the key after createServer must still disable requests');
    });
  }
  groups++;

  // Google uses the same origin restrictions and shared daily reservation:
  // a planner call leaves the remaining slot available for a learner question.
  await withServer({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: GEMINI_KEY, DAILY_REQUEST_LIMIT: '2' }, successfulUpstream,
  async (server, calls) => {
    const forbidden = await request(server, { origin: 'https://untrusted.invalid' });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.headers['access-control-allow-origin'], undefined);
    const options = await request(server, { method: 'OPTIONS' });
    assert.equal(options.status, 204);
    assert.equal(options.headers['access-control-allow-origin'], ORIGIN);
    assert.equal(calls.length, 0);
    const plan = { path: '/api/practice-plan', body: planBody };
    assert.equal((await request(server, plan)).status, 200);
    assert.equal((await request(server, plan)).status, 429);
    assert.equal((await request(server)).status, 200);
    assert.equal((await request(server)).status, 429);
    assert.equal(calls.length, 2);
    assertCall(calls[0], 'gemini', GEMINI_KEY, GEMINI_MODEL, 600);
    assertCall(calls[1], 'gemini', GEMINI_KEY, GEMINI_MODEL);
  });
  groups++;

  // Direct helper defaults remain compatible with Woku. Optional destinations
  // are a closed set, rejecting credential-bearing and almost-matching URLs.
  {
    const calls = [];
    assert.equal(await requestChatCompletion({ apiKey: WOKU_KEY, model: WOKU_MODEL, messages,
      upstream: async (url, options) => { calls.push({ url, options }); return answer(); } }), REPLY);
    assertCall(calls[0], 'woku', WOKU_KEY, WOKU_MODEL);
    const resolver = createModelFallbackResolver({ upstream: async (url, options) => {
      calls.push({ url, options }); return catalog([FALLBACK]);
    } });
    assert.equal(await resolver({ apiKey: WOKU_KEY, currentModel: WOKU_MODEL }), FALLBACK);
    assert.equal(calls[1].url, URLS.woku.catalog);
    assert.equal(calls[1].options.headers.Authorization, `Bearer ${WOKU_KEY}`);
  }
  let unsafeCalls = 0;
  const unexpectedUpstream = async () => { unsafeCalls++; return answer(); };
  for (const endpoint of ['https://untrusted.invalid', `${URLS.gemini.chat}?redirect=1`,
    `${URLS.gemini.chat}/`, `${URLS.gemini.chat}#fragment`,
    'http://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    'https://user:pass@generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    'https://generativelanguage.googleapis.com.attacker.invalid/v1beta/openai/chat/completions', new URL(URLS.gemini.chat)]) {
    await assert.rejects(requestChatCompletion({ endpoint, upstream: unexpectedUpstream,
      apiKey: GEMINI_KEY, model: GEMINI_MODEL, messages }), error => {
      privateOutput({ message: error.message });
      return error.message === 'Unsupported AI completion endpoint.';
    });
  }
  for (const catalogUrl of ['https://untrusted.invalid', `${URLS.gemini.catalog}?redirect=1`,
    `${URLS.gemini.catalog}/`, `${URLS.gemini.catalog}#fragment`,
    'http://generativelanguage.googleapis.com/v1beta/openai/models',
    'https://user:pass@generativelanguage.googleapis.com/v1beta/openai/models',
    'https://generativelanguage.googleapis.com.attacker.invalid/v1beta/openai/models', new URL(URLS.gemini.catalog)]) {
    assert.throws(() => createModelFallbackResolver({ catalogUrl, upstream: unexpectedUpstream }),
      error => error.message === 'Unsupported AI catalog endpoint.');
  }
  assert.equal(unsafeCalls, 0, 'Unsupported destinations must fail before any credential is sent');
  groups++;
} finally {
  for (const [name, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

console.log(`PASS ${groups} provider routing groups: loopback API, isolated Google/Woku credentials and models, fixed destinations, recovery, health privacy, quota and CORS`);
