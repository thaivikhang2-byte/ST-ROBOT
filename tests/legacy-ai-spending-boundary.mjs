import assert from 'node:assert/strict';
import http from 'node:http';
import { createAiClient, AI_SERVICE_ORIGIN } from '../frontend/src/services/AiService.js';
import { listTemplates } from '../ai-server/generation/QuestionEngine.js';

// Local HTTP/provider fixtures only. No credential or request reaches a vendor.
const envNames = ['NODE_ENV', 'AI_PROVIDER', 'ALLOWED_ORIGIN', 'WOKU_API_KEY', 'AI_MODEL', 'DAILY_REQUEST_LIMIT', 'LEGACY_AI_GENERATION_ENABLED'];
const previous = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
const origin = 'https://legacy-boundary.test';
const question = 'private-fixture-question';
const key = 'private-fixture-not-a-real-key';
const template = listTemplates({ courseId: 'arduino', lessonId: 'led' })[0].id;
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const requests = [
  ['/api/home-chat', { question }],
  ['/api/tutor', { course: 'arduino', lesson: 'led', question }],
  ['/api/practice-plan', { courseId: 'arduino', lessonId: 'led', count: 1, level: 'all', weakLessonIds: [] }],
];
let imports = 0;
async function api(server, path, body) {
  const data = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path,
      method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin,
        ...(data === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }) } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
      res.on('error', reject);
    });
    req.on('error', reject); req.end(data);
  });
}
async function fixture(env, options, check) {
  for (const name of envNames) delete process.env[name];
  Object.assign(process.env, { NODE_ENV: 'test', AI_PROVIDER: 'woku', ALLOWED_ORIGIN: origin,
    WOKU_API_KEY: key, AI_MODEL: 'local-boundary-model', DAILY_REQUEST_LIMIT: '50' }, env);
  const { createServer } = await import(`../ai-server/server.mjs?legacy-boundary=${++imports}`);
  const calls = [];
  const server = createServer(async (_url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    return json({ choices: [{ message: { content: body.max_tokens === 600
      ? JSON.stringify({ templateIds: [template] }) : 'Fixture reply.' } }] });
  }, options);
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    await check(server, calls);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}

try {
  await fixture({}, undefined, async (server, calls) => {
    const health = await api(server, '/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.ai.generationEnabled, false);
    assert.equal(health.body.ai.keyConfigured, true);
    for (const [path, body] of requests) {
      const result = await api(server, path, body);
      assert.equal(result.status, 503);
      assert.equal(result.body.retryable, false);
      assert.match(result.body.error, /đăng nhập.*tài khoản/);
      assert.ok(!JSON.stringify(result.body).includes(key));
      assert.ok(!JSON.stringify(result.body).includes(question));
    }
    assert.equal(calls.length, 0, 'All legacy paid routes are off by default even when a key exists');
  });
  for (const [env, options] of [
    [{ LEGACY_AI_GENERATION_ENABLED: 'true' }, undefined],
    [{}, { legacyGenerationEnabled: true }],
  ]) await fixture(env, options, async (server, calls) => {
    assert.equal((await api(server, '/health')).body.ai.generationEnabled, true);
    for (const [path, body] of requests) assert.equal((await api(server, path, body)).status, 200);
    assert.equal(calls.length, 3, 'Explicit opt-in retains all legacy features');
  });

  let fetches = 0;
  const owner = '89d478c4-102a-4a71-92af-a0c44e62c49b';
  const account = { configured: true, baseUrl: 'https://accounts.example/api', user: null, sessionVersion: 1,
    async ready() { return this.user; }, async request() { throw Error('No metadata for an unsigned guest'); } };
  const guest = createAiClient({ account, fetchImpl: async () => { fetches++; throw Error('No legacy fallback'); } });
  await assert.rejects(guest.requestReply('/api/home-chat', { question }), error => error.code === 'AI_AUTH' && !error.retryable);
  assert.equal(fetches, 0);

  for (const policy of [{ economyEnabled: true, spendingEnabled: false },
    { economyEnabled: false, spendingEnabled: true }, {}, null]) {
    const metadataCalls = [];
    const client = createAiClient({ account: { ...account, user: { id: owner }, async request(path, options) {
      metadataCalls.push({ path, options }); return policy;
    } }, fetchImpl: async () => { fetches++; throw Error('No legacy vision under the managed budget'); } });
    await assert.rejects(client.requestReply('/api/tutor', { course: 'arduino', lesson: 'led', question,
      images: [{ dataUrl: 'private-image-not-sent' }] }), error => error.code === 'AI_IMAGE_UNSUPPORTED'
        && !error.retryable && /ảnh chưa được gửi/.test(error.message));
    assert.equal(metadataCalls.length, 1);
    assert.equal(metadataCalls[0].path, '/v1/ai/agent/status?mode=EDUCATIONAL');
    assert.equal(metadataCalls[0].options.method, undefined);
    assert.equal(metadataCalls[0].options.body, undefined);
    assert.ok(!JSON.stringify(metadataCalls).includes(question));
    assert.equal(fetches, 0);
  }
  const unavailable = createAiClient({ account: { ...account, user: { id: owner },
    async request() { throw Error('Private provider failure must not reach UI'); } },
    fetchImpl: async () => { fetches++; throw Error('No fallback when policy cannot be confirmed'); } });
  await assert.rejects(unavailable.requestReply('/api/tutor', { question, images: [{}] }), error =>
    error.code === 'AI_IMAGE_UNSUPPORTED' && !error.message.includes('Private provider failure'));
  assert.equal(fetches, 0);

  const legacyRequests = [];
  const allowed = createAiClient({ account: { ...account, user: { id: owner }, async request() {
    return { economyEnabled: false, spendingEnabled: false, supportsImages: false };
  } }, fetchImpl: async (url, options) => { legacyRequests.push({url, options});
    return url.endsWith('/health') ? json({ok:true, ai:{generationEnabled:true}}) : json({reply:'Image fixture reply.'}); } });
  assert.equal(await allowed.requestReply('/api/tutor', { question, images: [{dataUrl:'fixture-image'}] }), 'Image fixture reply.');
  assert.deepEqual(legacyRequests.map(row => row.url), [AI_SERVICE_ORIGIN + '/health', AI_SERVICE_ORIGIN + '/api/tutor']);
  assert.equal(JSON.parse(legacyRequests[1].options.body).images[0].dataUrl, 'fixture-image');

  const disabled = createAiClient({ account: { configured: false }, fetchImpl: async url => {
    assert.ok(url.endsWith('/health'), 'A disabled legacy service must not receive the question');
    return json({ok:true, ai:{generationEnabled:false,keyConfigured:true}});
  } });
  await assert.rejects(disabled.requestReply('/api/home-chat', { question }), error => error.code === 'AI_UNAVAILABLE' && !error.retryable);
  console.log('PASS legacy spending boundary: default-off server, explicit opt-in, metadata-only image checks, no guest or budget bypass, images never silently dropped');
} finally {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}
