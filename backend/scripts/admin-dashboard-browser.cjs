// Real UI/API verification against the guarded disposable fixture only.
require('../test/setup-env.cjs');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || '../.test-tmp/browser-tools/node_modules/playwright');
(async () => {
    const fixture = JSON.parse(await fs.readFile(path.join(__dirname, '../.test-tmp/browser-phase9.json'), 'utf8'));
    assert.equal(new URL(fixture.url).hostname, '127.0.0.1');
    const output = path.resolve(__dirname, '../../docs/admin-dashboard-evidence');
    await fs.mkdir(output, { recursive: true });
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        async function login(identity) {
            await page.goto(fixture.url + '/admin.html');
            await page.getByText('Đăng nhập bằng tài khoản quản lý để tiếp tục.', { exact: true }).waitFor();
            assert.equal(await page.locator('#authLoginForm').getAttribute('method'), 'post');
            await page.locator('#loginEmail').fill(identity.email);
            await page.locator('#loginPassword').fill(identity.password);
            await page.locator('#btnLoginSubmit').click();
            await page.locator('#authProfileView').waitFor({ state: 'visible', timeout: 5000 }).catch(async error => {
                console.error('Login error:', await page.locator('#loginStatus').innerText()); throw error;
            });
        }
        await page.goto(fixture.url + '/admin.html');
        assert.equal(await page.locator('#management').isVisible(), false);
        for (const identity of [fixture.student, fixture.teacher]) {
            await login(identity);
            assert.equal(await page.locator('#management').isVisible(), false);
            assert.match(await page.locator('#adminStatus').innerText(), /chưa có quyền/);
        }
        await login(fixture.root);
        assert.equal(new URL(page.url()).search, '', 'Credentials must never enter the URL');
        assert.equal(await page.locator('[data-section="aiActions"]').count(), 1);
        const panel = page.locator('.management-panel');
        await panel.getByRole('heading', { name: 'Tổng quan hệ thống', exact: true }).waitFor();
        assert.match(await panel.innerText(), /Tổng khóa học/);
        for (const theme of ['light', 'dark']) {
            await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
            await page.locator('#management').scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(output, `overview-${theme}.png`) });
        }
        for (const [section, heading] of [['users', 'Người dùng'], ['roles', 'Vai trò & ủy quyền'],
            ['teaching', 'Khóa học phụ trách'], ['ai', 'AI Gateway'], ['operations', 'Vận hành hệ thống']]) {
            await page.locator(`[data-section="${section}"]`).click();
            await panel.getByRole('heading', { name: heading, exact: true }).waitFor();
            assert.equal(await panel.locator('[role="alert"]').count(), 0);
            console.log('PASS section ' + section);
        }
        await page.locator('[data-section="users"]').click();
        await panel.getByRole('button', { name: 'Trang sau', exact: true }).click();
        await panel.getByText(/^Trang 2 ·/).waitFor();
        await panel.getByRole('button', { name: 'Trang trước', exact: true }).click();
        await panel.getByText(/^Trang 1 ·/).waitFor();
        console.log('PASS real database pagination');
        await panel.getByLabel('Tên hoặc email').fill(fixture.student.email);
        await panel.getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
        await panel.getByRole('cell', { name: fixture.student.email, exact: true }).waitFor();
        assert.equal(await panel.locator('tbody tr').count(), 1);
        await panel.getByRole('button', { name: 'Chi tiết', exact: true }).click();
        await panel.getByRole('heading', { name: 'Tài khoản · ' + fixture.student.email }).waitFor();
        await page.locator('[data-section="users"]').click();
        await panel.getByRole('button', { name: 'Tạo tài khoản học viên', exact: true }).click();
        const createdEmail = `admin-ui-${require('node:crypto').randomUUID()}@qa.test`;
        await panel.getByLabel('Tên', { exact: true }).fill('Dashboard');
        await panel.getByLabel('Họ', { exact: true }).fill('QA');
        await panel.getByLabel('Email', { exact: true }).fill(createdEmail);
        await panel.getByLabel('Mật khẩu ban đầu').fill(require('node:crypto').randomUUID() + '-QA!');
        page.once('dialog', dialog => dialog.accept());
        await panel.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
        await panel.getByText('Đã tạo tài khoản.', { exact: false }).waitFor({timeout: 5000}).catch(async error => {
            console.error('Create-user UI error:', await panel.locator('[role="alert"]').allTextContents());
            throw error;
        });
        await panel.getByLabel('Tên hoặc email').fill(createdEmail);
        await panel.getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
        await panel.getByRole('cell', { name: createdEmail, exact: true }).waitFor();
        console.log('PASS user creation persisted via actual UI');
        await page.locator('[data-section="approvals"]').click();
        await panel.getByLabel('Tên hoặc email người nhận').fill(fixture.student.email);
        await panel.getByRole('button', { name: 'Lọc yêu cầu', exact: true }).click();
        await panel.getByRole('button', { name: 'Xem yêu cầu', exact: true }).click();
        await panel.getByRole('heading', { name: 'TEACHER_APPLICATION', exact: true }).waitFor();
        if (await panel.getByLabel('Lý do quyết định (bắt buộc)').count()) {
            await panel.getByLabel('Lý do quyết định (bắt buộc)').fill('QA xác nhận hồ sơ giáo viên trên database cô lập');
            await panel.getByRole('button', { name: 'Xác nhận quyết định', exact: true }).click();
        }
        await panel.getByText('APPROVED · 1/1', { exact: true }).waitFor();
        console.log('PASS approval persisted via actual UI');
        await page.locator('[data-section="overview"]').click();
        await panel.getByRole('heading', { name: 'Tổng quan hệ thống', exact: true }).waitFor();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#management').scrollIntoViewIfNeeded();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: path.join(output, 'overview-mobile.png') });
        await page.locator('#btnLogoutBtn').click();
        await page.locator('#authGuestView').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#management').isVisible(), false);
        console.log('PASS guest/student/teacher denied; manager modules/search/details/themes/mobile/logout');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
