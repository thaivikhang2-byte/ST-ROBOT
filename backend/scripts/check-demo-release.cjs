const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const dotenv = require('dotenv');
(async () => {
  const root = path.resolve(__dirname, '../..'), demo = path.join(root, 'demo_production');
  const manifest = JSON.parse(await fs.readFile(path.join(demo, 'release-manifest.json')));
  const env = dotenv.parse(await fs.readFile(path.join(demo, '.env')));
  const secrets = Object.entries(env).filter(([k, v]) => /PASSWORD|SECRET|MASTER_KEY|API_KEY|TOKEN$/.test(k) && v.length >= 12).map(([, v]) => v.replace(/\$\$/g, '$'));
  for (const f of manifest.files) {
    const data = await fs.readFile(path.join(demo, f.dest));
    assert.equal(createHash('sha256').update(data).digest('hex'), f.sha256, f.dest);
    if (f.dest.startsWith('frontend/') && /\.(html|css|js|mjs|json|svg|txt)$/.test(f.dest)) for (const secret of secrets) assert.equal(data.includes(Buffer.from(secret)), false, 'Secret in public asset');
  }
  for (const service of ['backend', 'postgres', 'redis']) {
    const ports = JSON.parse(execFileSync('docker', ['inspect', 'st-robot-demo-' + service + '-1', '--format', '{{json .NetworkSettings.Ports}}'], { encoding: 'utf8' }));
    assert.ok(Object.values(ports).every(p => !p?.length), service + ' must have no host binding');
  }
  for (const service of ['nginx', 'minio']) {
    const ports = JSON.parse(execFileSync('docker', ['inspect', 'st-robot-demo-' + service + '-1', '--format', '{{json .NetworkSettings.Ports}}'], { encoding: 'utf8' }));
    assert.ok(Object.values(ports).flat().filter(Boolean).every(p => p.HostIp === '127.0.0.1'));
  }
  const network = JSON.parse(execFileSync('docker', ['network', 'inspect', 'st-robot-demo_data', 'st-robot-demo_api'], { encoding: 'utf8' }));
  assert.ok(network.every(n => n.Internal));
  const tunnel = execFileSync('docker', ['ps', '--filter', 'label=com.docker.compose.service=cloudflared', '--format', '{{.Names}}'], { encoding: 'utf8' });
  assert.equal(tunnel.trim(), '');
  const vaultCheck = JSON.parse(execFileSync('docker', ['exec', 'st-robot-demo-backend-1', 'node', '-e', `const {VaultStore}=require('./dist/modules/ai-gateway/vault/vault-store');new VaultStore(process.env.AI_PROVIDERS_CONFIG_PATH,process.env.AI_CREDENTIALS_MASTER_KEY,process.env.AI_CREDENTIALS_KEY_ID).read().then(v=>console.log(JSON.stringify({uid:process.getuid(),configured:v.providers.some(p=>p.id==='gemini'),disabled:process.env.AI_GATEWAY_ENABLED==='false'}))).catch(()=>process.exit(1));`], { encoding: 'utf8' }));
  assert.equal(vaultCheck.uid, 100); assert.equal(vaultCheck.configured, true); assert.equal(vaultCheck.disabled, true);
  const media = 'http://localhost:19010/' + env.S3_BUCKET + '/cors-probe';
  const preflight = await fetch(media, { method: 'OPTIONS', headers: { Origin: 'http://localhost:8080', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:8080');
  const foreign = await fetch(media, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
  assert.equal(foreign.headers.get('access-control-allow-origin'), null);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1879, height: 964 }, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://localhost:8080/');
    await page.locator('#featuredCourses[aria-busy="false"]').waitFor();
    const courses = (await (await page.request.get('http://localhost:8080/api/v1/courses')).json()).data;
    assert.equal(courses.length, 5);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(root, 'docs/phase11-evidence/demo-home.png') });
    await page.goto('http://localhost:8080/dangky.html#account');
    assert.equal(await page.locator('#authLoginForm').count(), 1);
    assert.equal(await page.locator('#authRegisterForm').count(), 1);
    for (const p of ['/not-found', '/.env', '/secrets/gemini-api-key.txt', '/backend/prisma/schema.prisma', '/api/docs']) assert.equal((await page.request.get('http://localhost:8080' + p)).status(), 404, p);
    const mjs = await page.request.get('http://localhost:8080/src/vendor/hls/hls.light.mjs');
    assert.match(mjs.headers()['content-type'], /javascript/);
    assert.deepEqual(errors, []);
    const result = { releaseFiles: manifest.files.length, hashesMatch: true, noEnvSecretsInAssets: true, loopbackBindings: true, privateDbRedisBackend: true, internalDataApiNetworks: true, tunnelStopped: true, geminiVaultReadableAsNonRootAndDisabled: true, storageCorsAllowlist: true, courseCount: courses.length, frontendNoPageErrors: true, missingAndPrivatePaths404: true, hlsModuleMime: 'application/javascript' };
    await fs.writeFile(path.join(root, 'docs/phase11-evidence/demo-smoke.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
