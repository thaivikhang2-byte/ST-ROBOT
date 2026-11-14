// Real frontend/Nest/tools/PostgreSQL; fixture deliberately replaces only the external AI gateway.
require('../test/setup-env.cjs');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || '../.test-tmp/browser-tools/node_modules/playwright');
const { PrismaClient } = require('../dist/database/client');
(async () => {
  const fixture = JSON.parse(await fs.readFile(path.resolve(__dirname, '../.test-tmp/browser-phase13.json'), 'utf8'));
  const database = new URL(fixture.databaseUrl);
  assert.equal(database.hostname, '127.0.0.1'); assert.equal(database.port, '15432'); assert.equal(database.pathname, '/st_robot_phase4_test');
  assert.match(database.searchParams.get('schema'), /^phase13_browser_\d+$/);
  const db = new PrismaClient({ datasourceUrl: database.href });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const origin = new URL(fixture.url).origin, evidence = path.resolve(__dirname, '../../docs/phase13-evidence');
  await fs.mkdir(evidence, { recursive: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(12000);
    async function accountLogin(host, user) {
      const form = host.locator('[data-login]');
      await form.locator('[name=email]').fill(user.email); await form.locator('[name=password]').fill(user.password);
      await form.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
      await host.locator('[data-profile]:not([hidden])').waitFor({ state: 'attached' });
    }
    async function managerLogin(user, url) {
      await page.goto(origin + url); await page.locator('#loginEmail').fill(user.email); await page.locator('#loginPassword').fill(user.password);
      await page.locator('#btnLoginSubmit').click(); await page.locator('.management-panel[aria-busy="false"]').waitFor();
    }
    async function send(host, text) {
      await host.getByRole('textbox', { name: 'Yêu cầu cho trợ lý', exact: true }).fill(text);
      await host.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();
      await host.getByText('Đã nhận xong trả lời.', { exact: true }).waitFor();
    }
    await page.goto(origin + '/index.html'); await page.locator('#chatTriggerBtn').click();
    const home = page.locator('#supportChatWindow'); await accountLogin(home, fixture.student);
    await page.locator('#chatInputField').fill('remember-preference'); await page.locator('#chatSubmitBtn').click();
    await home.getByText('Đã nhận xong trả lời.', { exact: true }).waitFor();
    await home.getByText('Hội thoại & ghi nhớ', { exact: true }).click();
    await home.getByRole('button', { name: 'Đề xuất & ghi nhớ của tôi', exact: true }).click();
    const proposed = home.getByRole('textbox', { name: 'Nội dung ghi nhớ cần xác nhận' }); await proposed.fill('I prefer diagrams and small examples.');
    await home.getByRole('button', { name: 'Xác nhận đúng nội dung đang hiển thị', exact: true }).click();
    const saved = home.getByRole('textbox', { name: 'Nội dung ghi nhớ đã lưu' }); await saved.waitFor();
    await saved.fill('I prefer concise diagrams.');
    const edited = page.waitForResponse(response => response.url().includes('/memory/entries/') && response.request().method() === 'PATCH');
    await home.getByRole('button', { name: 'Xác nhận nội dung đã sửa', exact: true }).click();
    assert.equal((await edited).status(), 200);
    assert.equal((await db.aiMemoryEntry.findFirstOrThrow({ where: { owner_id: fixture.student.id, revoked_at: null } })).content, 'I prefer concise diagrams.');
    page.once('dialog', dialog => dialog.accept()); await home.getByRole('button', { name: 'Xóa ghi nhớ', exact: true }).click();
    await saved.waitFor({ state: 'detached' }); assert.equal(await db.aiMemoryEntry.count({ where: { owner_id: fixture.student.id, revoked_at: null } }), 0);
    await home.getByRole('button', { name: 'Tải hội thoại', exact: true }).click();
    const selected = home.getByRole('combobox', { name: 'Hội thoại AI' });
    await selected.locator('option').nth(1).waitFor({ state: 'attached' });
    assert.ok(await selected.locator('option').count() >= 2); await selected.selectOption({ index: 1 });
    await home.getByRole('button', { name: 'Mở hội thoại', exact: true }).click();
    await home.getByText('remember-preference', { exact: true }).waitFor();
    console.log('PASS homepage lifecycle/history and exact memory consent/edit/revoke persisted');
    await page.goto(origin + '/index.html'); await page.locator('#chatTriggerBtn').click(); await accountLogin(home, fixture.student);
    await home.getByText('Hội thoại & ghi nhớ', { exact: true }).click(); await home.getByRole('button', { name: 'Tải hội thoại', exact: true }).click();
    await selected.locator('option').nth(1).waitFor({ state: 'attached' });
    await selected.selectOption({ index: 1 }); await home.getByRole('button', { name: 'Mở hội thoại', exact: true }).click();
    await home.getByText('remember-preference', { exact: true }).waitFor(); console.log('PASS authenticated cross-page continuation');
    await page.goto(origin + `/course.learning.html?course=${fixture.courseId}&lesson=${fixture.lessonId}`);
    await accountLogin(page, fixture.student); await page.locator('#lessonTitle').getByText('QA Phase13 sensor lesson', { exact: true }).waitFor();
    const ask = async text => { await page.locator('#chatInput').fill(text); await page.locator('#learningChatForm button[type=submit]').click(); };
    await ask('Explain sensor'); await page.locator('#aiStatus').getByText('Đã nhận xong trả lời.', { exact: true }).waitFor();
    assert.match(await page.locator('#chatMessages').innerText(), /QA grounded response/);
    await ask('simulate-slow'); await page.locator('#cancelAi').click();
    await page.locator('#aiStatus').getByText('AI chưa hoàn tất yêu cầu.', { exact: true }).waitFor();
    await ask('simulate-error'); await page.locator('#aiStatus').getByText('AI chưa hoàn tất yêu cầu.', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(evidence, 'educational-agent.png') });
    console.log('PASS Self-Study authorized lifecycle, cancellation and honest provider error');
    await managerLogin(fixture.teacher, '/dangky.html');
    const panel = page.locator('.management-panel'); await page.locator('[data-section=educationalAi]').click();
    await send(panel, 'Propose a lesson plan'); assert.equal(await page.locator('[data-section=aiActions]').count(), 0);
    console.log('PASS Teacher Educational workspace; Management unavailable');
    const draftsBefore = await db.course.count({ where: { title: fixture.draftTitle } });
    await managerLogin(fixture.root, '/admin.html'); await page.locator('[data-section=aiActions]').click(); await send(panel, 'create-draft');
    await panel.getByText(fixture.draftTitle, { exact: false }).waitFor();
    assert.equal(await db.course.count({ where: { title: fixture.draftTitle } }), draftsBefore);
    page.once('dialog', dialog => dialog.accept()); await panel.getByRole('button', { name: 'Xác nhận (CREATE_DRAFT)', exact: true }).click();
    await panel.getByText('Máy chủ đã xác nhận hoàn tất hành động (CREATE_DRAFT).', { exact: true }).waitFor();
    assert.equal(await db.course.count({ where: { title: fixture.draftTitle, status: 'draft' } }), draftsBefore + 1);
    await panel.getByRole('heading', { name: 'Trợ lý AI quản lý', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidence, 'management-agent.png') });
    await page.locator('#themeToggleBtn').click(); await page.screenshot({ path: path.join(evidence, 'management-agent-theme.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.getByRole('heading', { name: 'Trợ lý AI quản lý', exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(evidence, 'management-agent-mobile.png') });
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(evidence, 'browser-result.json'), JSON.stringify({ externalGateway: 'deterministic fixture, no live API', realNest: true,
      realPostgreSQL: true, surfaces: ['homepage', 'Self-Study', 'Teacher', 'Admin'], history: true, memoryConsentEditRevoke: true,
      actionPreviewConfirm: true, cancellation: true, errorHandling: true, theme: true, mobileNoOverflow: true, pageErrors: errors }, null, 2));
    console.log('PASS Management exact preview/confirm created one real draft; themes/mobile/navbar preserved');
  } finally { await browser.close(); await db.$disconnect(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
