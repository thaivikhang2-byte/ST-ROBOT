// Real Nest/PostgreSQL/Redis/private storage + real nginx. Only upstream AI SDK transport is simulated.
// setup-env refuses unknown databases. This harness never uses demo_production/.env.
require('../test/setup-env.cjs');
require('ts-node/register');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync, execFile } = require('node:child_process');
const dockerAsync = require('node:util').promisify(execFile);
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ConfigService } = require('@nestjs/config');
const { AppModule } = require('../src/app.module');
const { setupHttp } = require('../src/config/setup-http');
const { PrismaService } = require('../src/database/prisma.service');
const { ProviderClients } = require('../src/modules/ai-gateway/provider-clients');
const OpenAI = require('openai').default;
const root = path.resolve(__dirname, '../..');
const name = 'st-robot-phase11-proxy-qa';
const base = 'http://127.0.0.1:18080';
const selfStudy = process.argv.includes('--selfstudy');
function docker(args, allowFailure = false) {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0 && !allowFailure) throw new Error('Docker harness command failed: ' + r.stderr.slice(-600));
  return r;
}
const delay = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  assert.notEqual(docker(['inspect', name], true).status, 0, 'Do not overwrite an existing QA container');
  process.env.AI_GATEWAY_ENABLED = 'true';
  process.env.VIDEO_PLAYBACK_TTL_SECONDS = '30';
  let mode = 'normal', aborted = 0;
  const upstream = async (_input, init) => {
    if (mode === 'error') return new Response(JSON.stringify({ error: { message: 'synthetic-provider-secret' } }), { status: 503 });
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({
      async start(controller) {
        const emit = event => controller.enqueue(encoder.encode('data: ' + JSON.stringify(event) + '\n\n'));
        try {
          init.signal?.addEventListener('abort', () => { aborted++; }, { once: true });
          emit({ type: 'response.created', response: { id: 'resp-qa' } });
          emit({ type: 'response.output_text.delta', delta: 'first', output_index: 0 });
          await delay(450);
          init.signal?.throwIfAborted();
          emit({ type: 'response.output_text.delta', delta: ' second', output_index: 0 });
          emit({ type: 'response.completed', response: { id: 'resp-qa', usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } });
          controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close();
        } catch { try { controller.close(); } catch {} }
      }, cancel() { aborted++; },
    }), { headers: { 'Content-Type': 'text/event-stream' } });
  };
  const clients = { available: async () => true, acquire: async () => undefined, finish: async () => {}, timeout: () => 60000,
    openai: async () => new OpenAI({ apiKey: 'qa-not-a-real-key', maxRetries: 0, fetch: upstream }) };
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ProviderClients).useValue(clients).compile();
  const app = module.createNestApplication({ logger: false });
  app.use('/api/v1/ai/proxy-probe', (req, res) => res.json({ xff: req.headers['x-forwarded-for'], proto: req.headers['x-forwarded-proto'], host: req.headers.host, cf: req.headers['cf-connecting-ip'] || null }));
  setupHttp(app);
  let started = false, oldProvider, oldFlag, oldDefaults = [], selfstudyFixture;
  const results = { environment: 'disposable PostgreSQL/Redis/MinIO', aiTransport: 'SIMULATED SDK upstream; no paid calls', checks: {} };
  try {
    await app.listen(0, '0.0.0.0');
    app.get(ConfigService).set('AI_GATEWAY_ENABLED', true);
    const port = app.getHttpServer().address().port;
    const prisma = app.get(PrismaService);
    oldProvider = await prisma.aiProvider.findUniqueOrThrow({ where: { id: 'openai' } });
    oldFlag = await prisma.featureFlag.findUniqueOrThrow({ where: { key: 'ai_chat' } });
    await prisma.aiProvider.update({ where: { id: 'openai' }, data: { enabled: true } });
    await prisma.featureFlag.update({ where: { key: 'ai_chat' }, data: { is_enabled: true } });
    const model = await prisma.aiModel.create({ data: { provider_id: 'openai', model_id: 'proxy-' + randomUUID(), enabled: true, capabilities: ['chat', 'streaming'], allowed_tools: [], max_input_tokens: 16000, max_output_tokens: 2000, context_tokens: 18000 } });
    if (selfStudy) {
      await fs.mkdir(path.join(root, 'docs/phase12-evidence'), { recursive: true });
      oldDefaults = await prisma.aiModel.findMany({ where: { is_default: true }, select: { id: true } });
      await prisma.aiModel.updateMany({ where: { is_default: true }, data: { is_default: false } });
      await prisma.aiModel.update({ where: { id: model.id }, data: { is_default: true } });
    }
    const config = (await fs.readFile(path.join(root, 'docker/nginx/demo.conf'), 'utf8')).replace('server backend:3000;', `server host.docker.internal:${port};`);
    const configFile = path.join(root, 'backend/.test-tmp/phase11-proxy.conf');
    await fs.writeFile(configFile, config);
    docker(['run', '-d', '--name', name, '--network', 'st-robot-demo_edge', '-p', '127.0.0.1:18080:80',
      '--mount', `type=bind,src=${configFile},dst=/etc/nginx/conf.d/default.conf,readonly`,
      '--mount', `type=bind,src=${path.join(root, 'docker/nginx/strobot-proxy.inc')},dst=/etc/nginx/strobot-proxy.inc,readonly`,
      '--mount', `type=bind,src=${path.join(root, 'frontend/public')},dst=/usr/share/nginx/public,readonly`,
      '--mount', `type=bind,src=${path.join(root, 'frontend/src')},dst=/usr/share/nginx/src,readonly`,
      'nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236']);
    started = true;
    for (let i = 0; i < 30; i++) { try { if ((await fetch(base + '/nginx-health')).ok) break; } catch {} await delay(200); }
    async function req(route, body, token, headers = {}) {
      return fetch(base + '/api/v1/' + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    }
    for (const p of ['/', '/dangky.html', '/src/app.js', '/api/system/health']) assert.equal((await fetch(base + p)).status, 200, p);
    assert.match((await fetch(base + '/src/vendor/hls/hls.light.mjs')).headers.get('content-type'), /javascript/);
    for (const p of ['/missing', '/src/missing.js', '/.env', '/secrets/gemini-api-key.txt', '/backend/prisma/schema.prisma', '/src/../.env']) assert.equal((await fetch(base + p)).status, 404, p);
    const legacy = await fetch(base + '/frontend/public/kit.html', { redirect: 'manual' });
    assert.equal(legacy.headers.get('location'), '/kit.html');
    results.checks.static404SecretsDeepLinks = true;
    const probe = await (await req('ai/proxy-probe', undefined, undefined, { 'X-Forwarded-For': '8.8.8.8', 'CF-Connecting-IP': '9.9.9.9', 'X-Forwarded-Proto': 'https' })).json();
    assert.equal(probe.proto, 'http'); assert.notEqual(probe.xff, '8.8.8.8'); assert.equal(probe.cf, null); assert.match(probe.host, /:18080$/);
    results.checks.untrustedForwardedHeadersDiscarded = true;
    const connectorScript = `async function main(){for(const proto of ['https','https,http']){const r=await fetch('http://${name}/api/v1/ai/proxy-probe',{headers:{'CF-Connecting-IP':'9.9.9.9','X-Forwarded-Proto':proto}});console.log(JSON.stringify(await r.json()));}}main().catch(()=>process.exit(1));`;
    const connector = await dockerAsync('docker', ['run', '--rm', '--network', 'st-robot-demo_edge', '--ip', '172.29.110.20', 'st-robot-phase11-demo:local', 'node', '-e', connectorScript], { timeout: 20000 });
    const trusted = connector.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.equal(trusted[0].proto, 'https'); assert.equal(trusted[0].xff, '9.9.9.9');
    assert.equal(trusted[1].proto, 'http');
    results.checks.trustedConnectorBoundaryAndMalformedProto = true;
    const fixture = JSON.parse(await fs.readFile(path.join(__dirname, '../.test-tmp/browser-phase10.json'), 'utf8'));
    if (selfStudy) {
      const role = await prisma.role.findUniqueOrThrow({ where: { name: 'student' } });
      const password = randomUUID() + '-Phase12!';
      const user = await prisma.user.create({ data: { email: randomUUID() + '@phase12-qa.example', first_name: 'Phase12', last_name: 'QA', role_id: role.id, is_email_verified: true, password_hash: await require('../src/shared/utils/hash.util').hashPassword(password) } });
      fixture.student = { id: user.id, email: user.email, password };
      await prisma.enrollment.create({ data: { user_id: user.id, course_id: fixture.courseId } });
    }
    if (selfStudy) selfstudyFixture = await require('./phase12-selfstudy-browser.cjs').prepare(prisma, fixture);
    async function login() { const r = await req('auth/login', { email: fixture.student.email, password: fixture.student.password }); assert.equal(r.status, 200); return (await r.json()).data.tokens; }
    let tokens = await login();
    assert.equal((await req('auth/me', undefined, tokens.accessToken)).status, 200);
    assert.equal((await req('admin/ai/models', undefined, tokens.accessToken)).status, 403);
    const refresh = await req('auth/refresh', { refreshToken: tokens.refreshToken }); assert.equal(refresh.status, 200);
    const rotated = (await refresh.json()).data.tokens;
    assert.notEqual(rotated.refreshToken, tokens.refreshToken);
    assert.equal((await req('auth/logout-current', {}, rotated.accessToken)).status, 200);
    assert.equal((await req('auth/me', undefined, rotated.accessToken)).status, 401);
    tokens = await login();
    results.checks.loginRefreshLogoutRbac = true;
    const allowed = await req('auth/me', undefined, tokens.accessToken, { Origin: 'http://localhost:3000' });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    const denied = await req('auth/me', undefined, tokens.accessToken, { Origin: 'https://evil.example' });
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
    assert.equal(denied.headers.get('access-control-allow-credentials'), null);
    assert.equal(allowed.headers.get('set-cookie'), null);
    results.checks.explicitCorsJsonBearerTransport = true;
    const chat = { modelId: model.id, maxOutputTokens: 32, messages: [{ role: 'user', content: 'QA' }] };
    const before = Date.now();
    const stream = await req('ai/chat/stream', chat, tokens.accessToken);
    assert.match(stream.headers.get('content-type'), /text\/event-stream/);
    const reader = stream.body.getReader(); let text = '', firstAt = null;
    for (;;) { const part = await reader.read(); if (part.done) break; text += new TextDecoder().decode(part.value); if (text.includes('first') && firstAt === null) firstAt = Date.now(); }
    const endAt = Date.now();
    assert.match(text, /first/); assert.match(text, /second/); assert.match(text, /event: end/);
    assert.ok(firstAt !== null && endAt - firstAt >= 200, 'First text arrives before stream completes');
    results.sse = { firstTextMs: firstAt - before, totalMs: endAt - before };
    results.checks.progressiveSseThroughRealNginx = true;
    mode = 'error';
    const errorText = await (await req('ai/chat/stream', chat, tokens.accessToken)).text();
    assert.match(errorText, /event: error/); assert.doesNotMatch(errorText, /synthetic-provider-secret|qa-not-a-real-key/);
    assert.doesNotMatch(errorText, /event: end/);
    results.checks.providerFailureRedacted = true;
    mode = 'normal';
    const beforeCancel = aborted;
    const controller = new AbortController();
    const cancel = await fetch(base + '/api/v1/ai/chat/stream', { method: 'POST', headers: { Authorization: 'Bearer ' + tokens.accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify(chat), signal: controller.signal });
    const cancelReader = cancel.body.getReader();
    for (;;) { const p = await cancelReader.read(); if (p.done || new TextDecoder().decode(p.value).includes('first')) break; }
    controller.abort(); await delay(700);
    assert.ok(aborted > beforeCancel, 'Client cancellation reaches upstream transport');
    results.checks.disconnectCancellation = true;
    const videos = (await (await req(`videos?lessonId=${fixture.lessonId}`, undefined, tokens.accessToken)).json()).data;
    const record = Array.isArray(videos) ? videos.find(v => v.status === 'ready') : null;
    assert.ok(record, 'Existing real HLS fixture is ready');
    const grant = await req(`videos/${record.id}/playback`, {}, tokens.accessToken); assert.equal(grant.status, 201);
    const descriptor = (await grant.json()).data;
    const masterUrl = new URL(descriptor.url, base);
    const master = await fetch(masterUrl); assert.equal(master.status, 200);
    const manifest = await master.text(); assert.match(manifest, /#EXTM3U/);
    const variantPath = manifest.split(/\r?\n/).find(line => line && !line.startsWith('#'));
    const variant = await fetch(new URL(variantPath, masterUrl)); assert.equal(variant.status, 200);
    const variantText = await variant.text();
    const segmentPath = variantText.split(/\r?\n/).find(line => line && !line.startsWith('#'));
    const segment = await fetch(new URL(segmentPath, variant.url), { redirect: 'manual' }); assert.equal(segment.status, 302);
    const signed = new URL(segment.headers.get('location'));
    assert.equal(signed.origin, 'http://127.0.0.1:19000');
    const bytes = await fetch(signed); assert.equal(bytes.status, 200); assert.ok((await bytes.arrayBuffer()).byteLength > 0);
    const unsigned = new URL(signed); unsigned.search = ''; assert.equal((await fetch(unsigned)).status, 403);
    assert.doesNotMatch(docker(['logs', name]).stdout, /token=/);
    results.checks.variantPrivateSegmentRedirectAndBytes = true;
    assert.equal((await fetch(base + `/api/v1/videos/${record.id}/hls/master.m3u8`)).status, 401);
    results.checks.realHlsManifestAuthorization = true;
    const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const browserErrors = []; page.on('pageerror', e => browserErrors.push(e.message));
      const course = await prisma.course.findUniqueOrThrow({ where: { id: fixture.courseId }, select: { slug: true } });
      await page.goto(base + '/course.learning.html?course=' + encodeURIComponent(course.slug) + '&lesson=' + fixture.lessonId);
      if (selfStudy) {
        await page.evaluate(user => { const form = document.querySelector('[data-login]'); form.elements.email.value = user.email; form.elements.password.value = user.password; form.requestSubmit(); }, fixture.student);
        await page.locator('#lessonVideos video').first().waitFor();
      } else {
        const script = await fs.readFile(path.join(__dirname, '../.test-tmp/browser-phase10-student-learning.js'), 'utf8');
        assert.equal((await page.evaluate('(' + script + ')()')).video, true);
      }
      await page.locator('#lessonVideos .st-video-player').first().getByRole('button', { name: 'Mở video / thử lại' }).click();
      await page.waitForFunction(() => document.querySelector('#lessonVideos video')?.readyState >= 1, undefined, { timeout: 12000 });
      const playing = await page.evaluate(async () => {
        const v = document.querySelector('#lessonVideos video'); v.muted = true;
        const play = await Promise.race([v.play().then(() => true).catch(() => false), new Promise(r => setTimeout(() => r(false), 5000))]);
        await new Promise(r => setTimeout(r, 1000));
        const time = v.currentTime; v.currentTime = 5;
        await new Promise(r => setTimeout(r, 600));
        const seek = v.currentTime; v.pause(); return { play, time, seek, duration: v.duration, readyState: v.readyState, error: v.error?.code || null };
      });
      assert.equal(playing.play, true); assert.ok(playing.time > 0); assert.ok(playing.seek >= 5); assert.deepEqual(browserErrors, []);
      await page.screenshot({ path: path.join(root, selfStudy ? 'docs/phase12-evidence/player-proxy.png' : 'docs/phase11-evidence/player-proxy.png') });
      results.browserHls = playing;
      results.checks.browserHlsDecodeSeekThroughProxy = true;
      if (selfStudy) results.selfstudy = await require('./phase12-selfstudy-browser.cjs').verify(page, prisma, fixture, selfstudyFixture, value => { mode = value; }, root);
      if (selfStudy) results.operations = await require('./phase12-operations-browser.cjs').verify(page, fixture, root);
    } finally { await browser.close(); }
    await delay(Math.max(0, new Date(descriptor.expiresAt).getTime() - Date.now()) + 1000);
    assert.equal((await fetch(new URL(descriptor.url, base))).status, 401);
    results.checks.hlsCapabilityExpiry = true;
    await fs.writeFile(path.join(root, selfStudy ? 'docs/phase12-evidence/selfstudy-integration.json' : 'docs/phase11-evidence/proxy-smoke.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
  } finally {
    if (started) docker(['rm', '-f', name], true);
    const prisma = app.get(PrismaService);
    if (selfStudy) {
      await prisma.aiModel.updateMany({ where: { is_default: true }, data: { is_default: false } });
      if (oldDefaults.length) await prisma.aiModel.updateMany({ where: { id: { in: oldDefaults.map(m => m.id) } }, data: { is_default: true } });
      if (selfstudyFixture) await require('./phase12-selfstudy-browser.cjs').retire(prisma, selfstudyFixture);
    }
    if (oldProvider) await prisma.aiProvider.update({ where: { id: oldProvider.id }, data: { enabled: oldProvider.enabled } });
    if (oldFlag) await prisma.featureFlag.update({ where: { key: oldFlag.key }, data: { is_enabled: oldFlag.is_enabled } });
    await app.close();
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
