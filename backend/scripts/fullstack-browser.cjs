// Real local Nest/PostgreSQL fixture; external services are blocked, never mocked as successful.
require('../test/setup-env.cjs');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || '../.test-tmp/browser-tools/node_modules/playwright');
(async () => {
  const fixture = JSON.parse(await fs.readFile(path.join(__dirname, '../.test-tmp/browser-phase9.json'), 'utf8'));
  const origin = new URL(fixture.url).origin;
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const name of ['index', 'gioithieu', 'kit', 'hoclieu', 'dangky', 'quiz', 'course.learning', 'admin']) {
      assert.equal((await page.goto(`${origin}/${name}.html`)).status(), 200);
      await page.locator('#themeToggleBtn').waitFor();
      assert.ok(await page.locator('nav a').count() > 0);
    }
    await page.goto(origin + '/index.html');
    const theme = await page.locator('body').getAttribute('class');
    await page.locator('#themeToggleBtn').click();
    await page.reload();
    assert.notEqual(await page.locator('body').getAttribute('class'), theme);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 1440, height: 1000 });
    async function loginStudent() {
      const form = page.locator('[data-login]');
      await form.locator('[name=email]').fill(fixture.student.email);
      await form.locator('[name=password]').fill(fixture.student.password);
      await form.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
      // Learning closes the account disclosure after login; verify state, not its ancestor visibility.
      await page.locator('[data-profile]:not([hidden])').waitFor({ state: 'attached' });
    }
    await page.goto(origin + '/course.learning.html?course=' + fixture.courseId + '&lesson=' + fixture.lessonId);
    await loginStudent();
    await page.locator('#courseSelect option[value="' + fixture.courseId + '"]').waitFor({ state: 'attached' });
    await page.locator('#courseSelect').selectOption(fixture.courseId);
    await page.getByText('QA · Đọc cảm biến khoảng cách', { exact: true }).first().waitFor();
    assert.equal(await page.locator('#learningChatForm').count(), 1);
    await page.screenshot({ path: path.join(__dirname, '../../docs/admin-dashboard-evidence/learning-regression.png') });
    await page.goto(origin + '/quiz.html');
    await loginStudent();
    await page.locator('#btnInitQuiz:not([disabled])').waitFor();
    await page.locator('#btnInitQuiz').click();
    await page.getByRole('button', { name: 'Xem lịch sử điểm', exact: true }).click();
    await page.getByText('Lịch sử đã lưu trên máy chủ:', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS 8 pages/navigation/theme persistence/mobile/real learner login/course/quiz history; AI panel only; external services blocked');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
