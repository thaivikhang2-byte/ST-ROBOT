#!/usr/bin/env python3
"""Measure account rendering with delayed local API fixtures, never production calls."""
import argparse
import asyncio
import collections
import json
import os
import time
import urllib.parse
from playwright.async_api import async_playwright, expect


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:5519')
    parser.add_argument('--chromium', default='/usr/bin/chromium' if os.path.exists('/usr/bin/chromium') else None)
    parser.add_argument('--baseline', action='store_true')
    args = parser.parse_args()
    base = args.base.rstrip('/')
    assert urllib.parse.urlsplit(base).hostname in ['127.0.0.1', 'localhost']
    api = 'http://127.0.0.1:5998/api'
    owner = '20000000-0000-4000-8000-000000000001'
    perms = ['learning:read', 'learning:update', 'users:read', 'analytics:read', 'users:create', 'users:update']
    user = {'id': owner, 'email': 'latency-fixture@example.test', 'firstName': 'Fixture', 'lastName': 'Manager',
            'isActive': True, 'isEmailVerified': True, 'role': {'name': 'superadmin'}, 'permissions': perms,
            'roles': [{'group': 'MANAGER', 'scopeType': 'SYSTEM', 'roleName': 'superadmin', 'permissions': perms}]}
    tokens = {'accessToken': 'fixture-access', 'refreshToken': 'fixture-refresh', 'expiresIn': 900}
    options = {'registrationEnabled': False, 'approvalRegistrationEnabled': True, 'emailDeliveryEnabled': False, 'managedAccountsEnabled': True}
    calls, errors = [], []
    course_id = '20000000-0000-4000-8000-000000000002'
    enrolled = False
    created_student = None
    write_started = asyncio.Event()
    snapshot_finished = False
    phase = 'restore'
    start = time.perf_counter()

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
        context = await browser.new_context(viewport={'width': 1440, 'height': 1000})
        saved = json.dumps({'version': 1, 'baseUrl': api, 'refreshToken': 'fixture-refresh', 'profile': user})
        await context.add_init_script("sessionStorage.setItem('strobot.account.session.v1', " + json.dumps(saved) + ");")
        page = await context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))

        async def route_request(route):
            nonlocal enrolled, created_student, snapshot_finished
            request = route.request
            url = urllib.parse.urlsplit(request.url)
            if url.path.endswith('/src/config/backend.config.js'):
                await route.fulfill(status=200, content_type='text/javascript', body='export const BACKEND_CONFIG={apiBaseUrl:' + json.dumps(api) + '}; export function resolveBackendUrl(){return BACKEND_CONFIG.apiBaseUrl;}')
                return
            if url.netloc != '127.0.0.1:5998':
                if url.netloc == urllib.parse.urlsplit(base).netloc:
                    await route.continue_()
                else:
                    await route.fulfill(status=200, content_type='text/html', body='<p>External calls disabled</p>')
                return
            headers = {'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'}
            if request.method == 'OPTIONS':
                await route.fulfill(status=204, headers=headers)
                return
            path = url.path.removeprefix('/api')
            calls.append({'phase': phase, 'method': request.method, 'path': path, 'time': time.perf_counter() - start})
            data = {}
            if path == '/system/health/live':
                data = {'status': 'ok'}
            elif path == '/v1/auth/options':
                await asyncio.sleep(1.2)
                data = options
            elif path == '/v1/auth/refresh':
                await asyncio.sleep(.15)
                data = {'user': user, 'tokens': tokens}
            elif path == '/v1/auth/login':
                data = {'user': user, 'tokens': tokens}
            elif path == '/v1/auth/me':
                await asyncio.sleep(.05)
                data = user
            elif path == '/v1/learner-state':
                await asyncio.sleep(2.4 if phase == 'restore' else .05)
                snapshot_finished = True
                data = {'revision': 0, 'values': {}, 'updatedAt': None}
            elif path == '/v1/users/student-overview':
                # Capture the database view at request start, before a concurrent
                # write commits. A forced refresh must not reuse this response.
                rows = [] if created_student is None else [created_student]
                await asyncio.sleep(.8)
                data = {'data': rows, 'meta': {'page': 1, 'totalPages': 1, 'total': len(rows)}}
            elif path == '/v1/users/students':
                body = json.loads(request.post_data)
                write_started.set()
                await asyncio.sleep(.3)
                created_student = {'id': '20000000-0000-4000-8000-000000000003', 'email': body['email'],
                    'firstName': body['firstName'], 'lastName': body['lastName'], 'isActive': True, 'isEmailVerified': True,
                    'role': {'name': 'student'}, 'roles': [{'group': 'STUDENT', 'scopeType': 'SELF'}]}
                data = created_student
            elif path == '/v1/courses':
                await asyncio.sleep(.4)
                data = {'data': [{'id': course_id, 'title': 'Fixture course'}]}
            elif path == '/v1/enrollments':
                await asyncio.sleep(.4)
                data = {'data': [{'course': {'id': course_id}, 'enrolledAt': '2026-11-21T00:00:00Z'}] if enrolled else []}
            elif path == '/v1/enrollments/' + course_id:
                assert request.method == 'POST'
                enrolled = True
                data = {'status': 'active'}
            elif path.startswith('/v1/auth/logout'):
                data = {}
            else:
                data = {'data': []}
            try:
                await route.fulfill(status=200, headers=headers, content_type='application/json', body=json.dumps({'success': True, 'data': data}))
            except Exception:
                if not request.failure:
                    raise

        await context.route('**/*', route_request)
        await page.goto(base + '/frontend/public/account.html', wait_until='domcontentloaded')
        await expect(page.locator('#account-signed-in')).to_be_visible(timeout=1500)
        visible_ms = round((time.perf_counter() - start) * 1000)
        assert not snapshot_finished, 'visible account identity was blocked by the larger learner snapshot'
        # Publish an unchanged profile while the first management read is pending.
        await page.evaluate('''async () => {
            const {accountService}=await import(new URL('../src/services/AccountService.js', location.href));
            await accountService.reloadProfile();
        }''')
        await page.evaluate('''async () => {
            const {learnerSync}=await import(new URL('../src/services/LearnerSyncService.js', location.href));
            await learnerSync.ready();
        }''')
        await asyncio.sleep(.9)
        count = collections.Counter(item['path'] for item in calls)
        restore_queries = count['/v1/users/student-overview']
        print(json.dumps({'sessionVisibleMs': visible_ms, 'restoreStudentOverviewRequests': restore_queries,
                          'restoreRequests': dict(count)}, ensure_ascii=False), flush=True)
        if not args.baseline:
            assert restore_queries == 1, 'same-owner/ready/options updates repeated the management query'
            assert count['/v1/courses'] == count['/v1/enrollments'] == 0, 'closed enrollment panel loaded at startup'
            assert not any('/v1/admin/ai/' in item['path'] or '/v1/ai/agent/' in item['path'] for item in calls), 'closed optional panels loaded during login'

        phase = 'hidden-enrollments'
        before = len(calls)
        await page.locator('#account-enrollments').evaluate('(element) => { element.open = true; }')
        await asyncio.sleep(.1)
        if not args.baseline:
            assert len(calls) == before, 'an open-but-hidden enrollment panel started requests'
        phase = 'open-enrollments'
        await page.locator('[data-workspace-view="learning"]').click()
        await asyncio.sleep(.08)
        await page.evaluate('''async () => {
            const {accountService}=await import(new URL('../src/services/AccountService.js', location.href));
            await accountService.reloadProfile();
        }''')
        await expect(page.locator('#account-enrollments-content')).to_contain_text('Fixture course')
        await asyncio.sleep(.5)
        enrollment_reads = lambda: [item for item in calls if item['path'] in ['/v1/courses', '/v1/enrollments']]
        if not args.baseline:
            assert len(enrollment_reads()) == 2, 'visible enrollment load repeated after a same-owner publication'
            await page.locator('#account-enrollments > summary').click()
            await page.locator('#account-enrollments > summary').click()
            await asyncio.sleep(.15)
            assert len(enrollment_reads()) == 2, 'reopening fresh enrollments repeated the query'
            await page.locator('#account-enrollments-content button', has_text='Tham gia khóa').click()
            await expect(page.locator('#account-enrollments-content button', has_text='Rời khóa')).to_be_visible()
            assert len(enrollment_reads()) == 4, 'successful enrollment write did not force a fresh read'

            # A mutation can commit while a user-requested pre-write list read
            # is still pending. Keep the selected view, but supersede that read.
            phase = 'mutation-race'
            await page.locator('[data-workspace-view="management"]').click()
            await page.locator('.account-create-student > summary').click()
            form = page.locator('#account-create-student')
            for name, value in {'email': 'fresh-view@example.test', 'password': 'Fixture-Performance-Password', 'firstName': 'Fresh', 'lastName': 'Student'}.items():
                await form.locator('[name="' + name + '"]').fill(value)
            await form.locator('input[type="checkbox"]').check()
            await form.locator('button[type="submit"]').click()
            await asyncio.wait_for(write_started.wait(), timeout=2)
            await page.locator('[data-student-refresh]').click()
            await expect(page.locator('#account-management-content')).to_contain_text('fresh-view@example.test')
            reads = [item for item in calls if item['phase'] == 'mutation-race' and item['path'] == '/v1/users/student-overview']
            assert len(reads) == 2, 'accepted mutation did not supersede the pre-write in-flight read'

            phase = 'new-session'
            await page.evaluate('''async () => {
                const {accountService}=await import(new URL('../src/services/AccountService.js', location.href));
                await accountService.signIn({email:'latency-fixture@example.test', password:'Fixture-Only-Login'});
            }''')
            await expect(page.locator('#account-management-content')).to_contain_text('fresh-view@example.test')
            reads = [item for item in calls if item['phase'] == 'new-session' and item['path'] == '/v1/users/student-overview']
            assert len(reads) == 1, 'a new session reused the previous session cache or duplicated its fresh read'

            phase = 'role-revocation'
            user.update(roles=[], permissions=[], role={'name': 'student'})
            await page.evaluate('''async () => {
                const {accountService}=await import(new URL('../src/services/AccountService.js', location.href));
                await accountService.reloadProfile();
            }''')
            await expect(page.locator('#account-management')).to_be_hidden()
            await expect(page.locator('[data-workspace-view="management"]')).to_be_hidden()
        assert not errors, errors
        print('BASELINE recorded' if args.baseline else 'PASS delayed account UI stays responsive; hidden reads defer and visible reads coalesce', flush=True)
        await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
