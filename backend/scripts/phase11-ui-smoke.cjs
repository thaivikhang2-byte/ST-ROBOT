// Runs only against the disposable browser fixture, never against the demo/user database.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
require('../test/setup-env.cjs');
(async () => {
  const fixture = JSON.parse(await fs.readFile(path.join(__dirname, '../.test-tmp/browser-phase10.json'), 'utf8'));
  assert.equal(new URL(fixture.url).hostname, '127.0.0.1');
  const out = path.resolve(__dirname, '../../docs/phase11-evidence');
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1879, height: 964 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const result = { checks: {}, video: null };
  try {
    await page.goto(fixture.url + '/index.html');
    await page.locator('.hc-slide.is-active img').waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('.hc-slide').count(), 4);
    await page.locator('[data-hc="next"]').click();
    assert.equal(await page.locator('.hc-slide').nth(1).getAttribute('aria-hidden'), 'false');
    await page.locator('[data-hc="next"]').press('ArrowLeft');
    assert.equal(await page.locator('.hc-slide').first().getAttribute('aria-hidden'), 'false');
    result.checks.carousel = true;
    result.nav = await page.locator('#navbar-container nav a').evaluateAll(nodes => nodes.map(a => ({ text: a.textContent.trim(), path: new URL(a.href).pathname })));
    assert.equal(result.nav.length, 8);
    for (const a of result.nav) assert.equal((await context.request.get(fixture.url + a.path)).status(), 200);
    result.checks.navigation = true;
    await page.screenshot({ path: path.join(out, 'home-desktop-light.png') });
    await page.locator('#themeToggleBtn').click();
    await page.reload();
    assert.equal(await page.locator('body').evaluate(x => x.classList.contains('dark-mode')), true);
    await page.screenshot({ path: path.join(out, 'home-desktop-dark.png') });
    result.checks.themePersistence = true;
    await page.locator('#themeToggleBtn').click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(out, 'home-mobile.png') });
    await page.goto(fixture.url + '/dangky.html');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(out, 'registration-mobile.png') });
    await page.setViewportSize({ width: 1879, height: 964 });
    await page.screenshot({ path: path.join(out, 'registration-desktop.png') });
    for (const id of ['registerForm', 'authLoginForm', 'authRegisterForm', 'verifyTokenForm']) assert.equal(await page.locator('#' + id).count(), 1);
    result.checks.registrationForms = true;
    async function loginManagement(actor) {
      const isolated = await browser.newContext();
      isolated.setDefaultTimeout(12000);
      const p = await isolated.newPage();
      await p.goto(fixture.url + '/dangky.html');
      await p.locator('#loginEmail').fill(fixture[actor].email);
      await p.locator('#loginPassword').fill(fixture[actor].password);
      const loginResponse = p.waitForResponse(r => r.url().endsWith('/auth/login'));
      await p.locator('#authLoginForm').evaluate(form => form.requestSubmit());
      assert.equal((await loginResponse).status(), 200, actor + ' login status');
      await p.locator('.management-panel[aria-busy="false"]').waitFor();
      const text = await p.locator('.management-panel').innerText();
      assert.match(text, actor === 'teacher' ? /Khóa học phụ trách/ : /Quản trị|người dùng|Người dùng/);
      await isolated.close();
      result.checks[actor + 'Dashboard'] = true;
    }
    await loginManagement('teacher');
    await loginManagement('root');
    const learning = await browser.newContext();
    const learner = await learning.newPage();
    const db = new (require('@prisma/client').PrismaClient)();
    let course;
    try { course = await db.course.findUniqueOrThrow({ where: { id: fixture.courseId }, select: { slug: true } }); }
    finally { await db.$disconnect(); }
    await learner.goto(fixture.url + '/course.learning.html?course=' + encodeURIComponent(course.slug) + '&lesson=' + fixture.lessonId);
    const loginSource = await fs.readFile(path.join(__dirname, '../.test-tmp/browser-phase10-student-learning.js'), 'utf8');
    const logged = await learner.evaluate('(' + loginSource + ')()');
    assert.equal(logged.video, true);
    result.checks.selfStudy = true;
    result.checks.aiTutorPanel = await learner.locator('#learningChatForm').count() === 1;
    await learner.locator('#lessonVideos .st-video-player').first().getByRole('button', { name: 'Mở video / thử lại' }).click();
    await learner.waitForFunction(() => document.querySelector('#lessonVideos video')?.readyState >= 1, { timeout: 12000 });
    result.video = await learner.evaluate(async () => {
      const v = document.querySelector('#lessonVideos video');
      v.muted = true;
      const play = await Promise.race([v.play().then(() => true).catch(() => false), new Promise(r => setTimeout(() => r(false), 5000))]);
      await new Promise(r => setTimeout(r, 1500));
      const value = { play, time: v.currentTime, duration: Number.isFinite(v.duration) ? v.duration : null, readyState: v.readyState, error: v.error?.code || null };
      v.pause(); return value;
    });
    result.pageErrors = errors;
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(out, 'ui-smoke.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    assert.equal(result.video.play, true, 'HLS play must resolve after opening video');
    assert.ok(result.video.time > 0, 'HLS decoded playback advances time');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
