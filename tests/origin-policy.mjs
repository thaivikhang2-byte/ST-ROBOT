import assert from 'node:assert/strict';
import http from 'node:http';
import { normalizeAllowedOrigin } from '../ai-server/origin-policy.mjs';
import { listTemplates } from '../ai-server/generation/QuestionEngine.js';

const origin = 'https://thaivikhang2-byte.github.io';
const key = 'private-local-origin-key-never-return';
const model = 'private-local-origin-model-never-return';
const revision = 'a'.repeat(40);
const prior = Object.fromEntries(['NODE_ENV', 'ALLOWED_ORIGIN', 'WOKU_API_KEY', 'AI_MODEL', 'DAILY_REQUEST_LIMIT', 'RENDER_GIT_COMMIT'].map(name => [name, process.env[name]]));
const templateId = listTemplates({ courseId: 'arduino', lessonId: 'led' })[0].id;
const requests = [
  { path: '/api/home-chat', body: { question: 'Kiểm tra kết nối bằng fixture.' } },
  { path: '/api/tutor', body: { course: 'arduino', lesson: 'led', question: 'Điện trở dùng làm gì?' } },
  { path: '/api/practice-plan', body: { courseId: 'arduino', lessonId: 'led', count: 3, level: 'all', weakLessonIds: [] } }
];
let imported = 0, requestsChecked = 0;

function request(server, { path = '/health', method = 'GET', requestOrigin = origin, body } = {}) {
  const encoded = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method, headers: {
      ...(requestOrigin === null ? {} : { Origin: requestOrigin }),
      ...(method === 'OPTIONS' ? { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } : {}),
      ...(encoded === null ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) })
    } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          requestsChecked++;
          resolve({ status: res.statusCode, headers: res.headers, data: text ? JSON.parse(text) : null, text });
        } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.end(encoded);
  });
}

async function withServer(configured, test, options = {}) {
  const apiKey = Object.hasOwn(options, 'apiKey') ? options.apiKey : key;
  const aiModel = Object.hasOwn(options, 'aiModel') ? options.aiModel : model;
  const gitRevision = Object.hasOwn(options, 'gitRevision') ? options.gitRevision : revision;
  process.env.NODE_ENV = 'test';
  for (const [name, value] of Object.entries({ ALLOWED_ORIGIN: configured, WOKU_API_KEY: apiKey, AI_MODEL: aiModel, DAILY_REQUEST_LIMIT: '50', RENDER_GIT_COMMIT: gitRevision })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  const { createServer } = await import(`../ai-server/server.mjs?origin-policy-test=${++imported}`);
  let calls = 0;
  const server = createServer(async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    const content = body.max_tokens === 600 ? JSON.stringify({ templateIds: [templateId] }) : 'Phản hồi fixture cục bộ.';
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    await test(server, () => calls);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}

try {
  const normalized = [
    [undefined, origin], ['', origin], [' \t ', origin], [origin, origin],
    [origin + '/', origin], [origin + '/ST-ROBOT/frontend/public/quiz.html?course=arduino#main', origin],
    [' ' + origin + ' ', origin], ['HTTPS://THAIVIKHANG2-BYTE.GITHUB.IO:443/path', origin],
    ['http://localhost:5500/quiz', 'http://localhost:5500'],
    ['http://example.test:80/path', 'http://example.test'], ['https://example.test:8443/path', 'https://example.test:8443']
  ];
  for (const [value, expected] of normalized) assert.equal(normalizeAllowedOrigin(value), expected);
  assert.equal(normalizeAllowedOrigin(undefined, ' https://fallback.test/path '), 'https://fallback.test');
  for (const value of [null, false, 1, [], {}, '*', 'https://*.example.test', 'https://*', 'null', 'file:///tmp/page.html',
    'data:text/html,hello', 'javascript:void(0)', 'ftp://example.test', '//example.test', 'example.test',
    'https://user@example.test', 'https://user:password@example.test', 'https://example.test:99999']) {
    assert.throws(() => normalizeAllowedOrigin(value), /ALLOWED_ORIGIN/);
  }
  assert.throws(() => normalizeAllowedOrigin(undefined, '*'), /ALLOWED_ORIGIN/);

  // These are the deployment values that previously produced 403 with no CORS
  // header. Exercise preflight AND actual POST against all three real routes.
  for (const configured of [origin, origin + '/', origin + '/ST-ROBOT', ' ' + origin + ' ']) {
    await withServer(configured, async (server, calls) => {
      for (const selection of requests) {
        const preflight = await request(server, { path: selection.path, method: 'OPTIONS' });
        assert.equal(preflight.status, 204);
        assert.equal(preflight.headers['access-control-allow-origin'], origin);
        assert.equal(preflight.headers['access-control-allow-methods'], 'POST, OPTIONS');
        assert.equal(preflight.headers['access-control-allow-headers'], 'Content-Type');
        const response = await request(server, { ...selection, method: 'POST' });
        assert.equal(response.status, 200);
        assert.equal(response.headers['access-control-allow-origin'], origin);
        assert.equal(response.headers.vary, 'Origin');
        assert.ok(selection.path.endsWith('practice-plan') ? response.data.source === 'ai-plan' : response.data.reply);
      }
      assert.equal(calls(), 3, 'Preflight must not call the AI provider');
      for (const requestOrigin of [null, 'null', '*', 'https://unrelated.test', 'https://thaivikhang2-byte.github.io.attacker.test',
        'http://thaivikhang2-byte.github.io', origin + ':8443', origin + '/ST-ROBOT']) {
        for (const method of ['OPTIONS', 'POST']) {
          const rejected = await request(server, { ...requests[0], method, requestOrigin });
          assert.equal(rejected.status, 403);
          assert.equal(rejected.headers['access-control-allow-origin'], undefined);
        }
      }
      assert.equal(calls(), 3, 'Rejected origins must not call the provider or bypass authorization');
    });
  }

  await withServer(origin + '/ST-ROBOT', async (server, calls) => {
    const health = await request(server, { requestOrigin: null });
    assert.equal(health.status, 200);
    assert.deepEqual(health.data, { ok: true, revision, ai: { keyConfigured: true, modelConfigured: true, allowedOrigin: origin } });
    assert.ok(!health.text.includes(key) && !health.text.includes(model), 'Public health must reveal no key or configured model name');
    assert.equal(calls(), 0, 'Health must not call the paid AI provider');
  });
  for (const gitRevision of [undefined, 'invalid-private-revision', 'a'.repeat(39), 'a'.repeat(41)]) {
    await withServer(undefined, async (server, calls) => {
      const health = await request(server, { requestOrigin: null });
      assert.deepEqual(health.data, { ok: true, revision: null, ai: { keyConfigured: false, modelConfigured: false, allowedOrigin: origin } });
      assert.ok(!health.text.includes('invalid-private-revision'));
      assert.equal(calls(), 0);
    }, { apiKey: '   ', aiModel: undefined, gitRevision });
  }
  console.log(`PASS origin normalization, ${requestsChecked} real local HTTP checks across 3 routes, strict origin rejection and private/no-cost health diagnostics`);
} finally {
  for (const [name, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
