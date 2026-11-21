#!/usr/bin/env python3
"""Browser regression for student/admin views using a deterministic local API fixture.

The real backend authorization is covered by account-fullstack-smoke.py. This
test checks role-driven layout, request bodies and secret handling without any
external services or default administrative credentials.
"""
import argparse
import json
import urllib.parse
from playwright.sync_api import expect, sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:5500')
    parser.add_argument('--chromium', default='/usr/bin/chromium')
    args = parser.parse_args()
    base = args.base.rstrip('/')
    assert urllib.parse.urlsplit(base).hostname in ['localhost', '127.0.0.1']
    public = base + '/frontend/public/'
    api = 'http://127.0.0.1:5999/api'
    student_id = '10000000-0000-4000-8000-000000000001'
    manager_id = '10000000-0000-4000-8000-000000000002'
    other_id = '10000000-0000-4000-8000-000000000003'
    inactive_staff_id = '10000000-0000-4000-8000-000000000005'
    pending_id = '10000000-0000-4000-8000-000000000006'

    def profile(id, email, group='STUDENT', role='student'):
        perms = ['learning:read', 'learning:update'] if group == 'STUDENT' else ['dashboard:read', 'users:read', 'users:update', 'users:create', 'audit:read', 'analytics:read', 'ai:manage']
        return {'id': id, 'email': email, 'firstName': 'Fixture', 'lastName': role.title(), 'isActive': True,
                'isEmailVerified': True, 'permissions': perms, 'role': {'name': role},
                'roles': [{'roleName': role, 'group': group, 'scopeType': 'SELF' if group == 'STUDENT' else 'SYSTEM', 'permissions': perms}]}

    student = profile(student_id, 'learner-view@example.test')
    manager = profile(manager_id, 'manager-view@example.test', 'MANAGER', 'superadmin')
    other = profile(other_id, 'other-learner@example.test')
    inactive_staff = {**profile(inactive_staff_id, 'disabled-staff@example.test'), 'isActive': False, 'roles': [],
                      'management': {'studentOnly': False, 'roleGroups': ['STUDENT', 'TEACHER']}}
    users = [manager, student, other, inactive_staff]
    profiles = {student['email']: student, manager['email']: manager}
    tokens = {'fixture-student': student, 'fixture-manager': manager}
    state = {'revision': 1, 'values': {'strobot.original.course.v3': json.dumps({'last': 'arduino', 'arduino': {'led': {'done': True, 'note': 'Private student note'}, 'timing': {'done': False, 'note': ''}}})}, 'updatedAt': '2026-11-14T00:00:00Z'}
    errors, mutations, api_requests = [], [], []
    temporary_password = 'Fixture-Temporary-Password-42!'

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
        fallback = browser.new_context(java_script_enabled=False)
        fallback_page = fallback.new_page()
        submissions = []

        def fallback_request(route):
            request = route.request
            if request.method == 'POST':
                submissions.append((request.method, urllib.parse.urlsplit(request.url).query,
                                    urllib.parse.parse_qs(request.post_data or '')))
                route.fulfill(status=405, content_type='text/html', body='<p>JavaScript is required to sign in.</p>')
            else:
                route.continue_()

        fallback_page.route(public + 'account.html', fallback_request)
        fallback_page.goto(public + 'account.html', wait_until='domcontentloaded')
        fallback_page.locator('#login-email').fill('fallback-fixture@example.test')
        fallback_page.locator('#login-password').fill(temporary_password)
        fallback_page.locator('#account-login button[type="submit"]').click()
        expect(fallback_page.locator('body')).to_contain_text('JavaScript is required')
        assert len(submissions) == 1 and submissions[0][0] == 'POST' and submissions[0][1] == ''
        assert submissions[0][2].get('password') == [temporary_password]
        assert temporary_password not in fallback_page.url and 'password=' not in fallback_page.url
        fallback.close()
        print('PASS no-JavaScript fallback keeps credentials out of the page URL', flush=True)

        context = browser.new_context(viewport={'width': 1440, 'height': 1000})
        page = context.new_page()
        page.set_default_timeout(15000)
        page.on('pageerror', lambda error: errors.append(str(error)))

        def route_request(route):
            request = route.request
            url = urllib.parse.urlsplit(request.url)
            if url.path.endswith('/src/config/backend.config.js'):
                route.fulfill(status=200, content_type='text/javascript', body='export const BACKEND_CONFIG={apiBaseUrl:' + json.dumps(api) + '}; export function resolveBackendUrl(){return BACKEND_CONFIG.apiBaseUrl;}')
                return
            if url.netloc != '127.0.0.1:5999':
                if url.netloc == urllib.parse.urlsplit(base).netloc:
                    route.continue_()
                else:
                    route.fulfill(status=200, content_type='text/html', body='<html><body>External service blocked in test</body></html>')
                return
            cors = {'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS'}
            if request.method == 'OPTIONS':
                route.fulfill(status=204, headers=cors)
                return
            path = url.path.removeprefix('/api')
            api_requests.append((request.method, path))
            body = json.loads(request.post_data or '{}')
            actor = tokens.get(request.headers.get('authorization', '').removeprefix('Bearer '))
            data = {}
            if path == '/system/health/live':
                assert request.method == 'GET' and not request.headers.get('authorization') and not request.post_data
                data = {'status': 'ok'}
            elif path == '/v1/auth/options':
                data = {'registrationEnabled': False, 'approvalRegistrationEnabled': True, 'registrationMode': 'approval', 'emailDeliveryEnabled': False, 'managedAccountsEnabled': True}
            elif path == '/v1/auth/student-requests':
                assert request.method == 'POST' and not request.headers.get('authorization')
                assert set(body) == {'email', 'password', 'firstName', 'lastName'}
                assert body['password'] == temporary_password
                pending = {**profile(pending_id, body['email']), 'isActive': False, 'isEmailVerified': False,
                           'approvalPending': True, 'roles': [], 'management': {'studentOnly': True, 'roleGroups': ['STUDENT']}}
                users.append(pending)
                profiles[pending['email']] = pending
                mutations.append(('request', pending_id))
                route.fulfill(status=202, content_type='application/json', headers=cors, body=json.dumps({'success': True, 'data': {'status': 'pending'}}))
                return
            elif path == '/v1/auth/login':
                user = profiles[body['email']]
                if user.get('approvalPending'):
                    route.fulfill(status=401, content_type='application/json', headers=cors, body=json.dumps({'success': False, 'error': {'code': 'INVALID_CREDENTIALS', 'message': 'Invalid credentials'}}))
                    return
                data = {'user': user, 'tokens': {'accessToken': 'fixture-manager' if user['id'] == manager_id else 'fixture-student', 'refreshToken': 'fixture-refresh', 'expiresIn': 900}}
            elif path == '/v1/auth/me':
                data = actor
            elif path.startswith('/v1/auth/logout'):
                data = {}
            elif path == '/v1/learner-state':
                data = state if actor and actor['id'] == student_id else {'revision': 0, 'values': {}, 'updatedAt': None}
            elif path == '/v1/learner-state/activity':
                data = {'data': [{'action': 'learner.lab_opened', 'recordedAt': '2026-11-14T00:00:00Z', 'details': {'courseId': 'arduino', 'lessonId': 'led'}}]}
            elif path == '/v1/admin/dashboard':
                assert actor and actor['id'] == manager_id
                data = {'users': len(users), 'activeStudents': 2, 'teachers': 0, 'publishedCourses': 5, 'learningActivityLast7Days': 1, 'pendingApprovals': 0}
            elif path == '/v1/users/student-overview':
                assert actor and actor['id'] == manager_id
                query = urllib.parse.parse_qs(url.query)
                status = query.get('status', ['all'])[0]
                rows = []
                for user in users:
                    if status == 'pending' and not user.get('approvalPending'):
                        continue
                    if status == 'active' and (user.get('approvalPending') or not user['isActive']):
                        continue
                    if status == 'locked' and (user.get('approvalPending') or user['isActive']):
                        continue
                    completed = 1 if user['id'] == student_id else 0
                    rows.append({**user, 'progressSummary': {'source': 'learner-self-report', 'completed': completed,
                        'total': 30, 'percentage': round(completed / 30 * 100), 'courses': [{'courseId': 'arduino', 'completed': completed, 'total': 6}]},
                        'lastLearningAt': '2026-11-14T00:00:00Z' if completed else None})
                data = {'data': rows, 'meta': {'totalPages': 1, 'page': 1, 'total': len(rows)}}
            elif path.endswith('/approve-student'):
                assert actor and actor['id'] == manager_id and path == '/v1/users/' + pending_id + '/approve-student'
                assert request.method == 'POST' and body == {}
                pending = profiles['pending-learner@example.test']
                pending.update(isActive=True, isEmailVerified=True, approvalPending=False, roles=profile(pending_id, pending['email'])['roles'])
                mutations.append(('approve', pending_id))
                data = pending
            elif path == '/v1/users' and request.method == 'GET':
                assert actor and actor['id'] == manager_id
                data = {'data': users}
            elif path == '/v1/users/students':
                assert actor and actor['id'] == manager_id
                assert set(body) == {'email', 'password', 'firstName', 'lastName'}
                assert body['password'] == temporary_password
                created = profile('10000000-0000-4000-8000-000000000004', body['email'])
                users.append(created)
                mutations.append(('create', created['id']))
                data = created
            elif path.endswith('/student-password'):
                assert actor and actor['id'] == manager_id and path == '/v1/users/' + other_id + '/student-password'
                assert body == {'newPassword': temporary_password}
                mutations.append(('password', other_id))
            elif path.startswith('/v1/users/') and path.endswith('/status'):
                assert actor and actor['id'] == manager_id and path == '/v1/users/' + other_id + '/status'
                assert set(body) == {'isActive'} and isinstance(body['isActive'], bool)
                other['isActive'] = body['isActive']
                other['roles'] = profile(other_id, other['email'])['roles'] if body['isActive'] else []
                other['management'] = {'studentOnly': True, 'roleGroups': ['STUDENT']}
                mutations.append(('status-on' if body['isActive'] else 'status-off', other_id))
                data = other
            elif path.startswith('/v1/admin/ai/'):
                assert actor and actor['id'] == manager_id
                assert request.method == 'GET', 'opening settings never changes the saved provider'
                data = {'enabled': True, 'serverEnabled': True} if path.endswith('/settings') else {'revision': 1, 'providers': []} if path.endswith('/vault') else [] if path.endswith('/models') else {'dailyRequestLimit': 20}
            elif path.startswith('/v1/ai/agent/'):
                data = {'available': False, 'message': 'Agent fixture chưa cấu hình', 'data': []} if '/status' in path else {'data': []}
            else:
                data = {'data': []}
            route.fulfill(status=200, content_type='application/json', headers=cors, body=json.dumps({'success': True, 'data': data}))

        context.route('**/*', route_request)
        page.goto(public + 'account.html', wait_until='domcontentloaded')
        for selector in ['#account-login', '#account-register', '#account-reset', '#account-change-password', '#account-student-password']:
            expect(page.locator(selector)).to_have_attribute('method', 'post')
        expect(page.locator('#account-registration-options')).to_be_visible()
        expect(page.locator('[data-auth-mode="register"]')).to_be_visible()
        page.locator('[data-auth-mode="register"]').click()
        for selector, value in {'#register-first': 'Pending', '#register-last': 'Learner', '#register-email': 'pending-learner@example.test', '#register-password': temporary_password}.items():
            page.locator(selector).fill(value)
        page.locator('#account-register button[type="submit"]').click()
        expect(page.locator('#account-message')).to_contain_text('Quản trị viên sẽ duyệt')
        expect(page.locator('#account-register input[type="password"]')).to_have_value('')
        expect(page.locator('#account-signed-in')).to_be_hidden()
        assert page.evaluate('async () => (await import(new URL("../src/services/AccountService.js", location.href))).accountService.user === null')
        page.locator('#login-email').fill('pending-learner@example.test')
        page.locator('#login-password').fill(temporary_password)
        page.locator('#account-login button[type="submit"]').click()
        expect(page.locator('#account-message')).to_have_attribute('data-kind', 'error')
        expect(page.locator('#account-signed-in')).to_be_hidden()
        print('PASS student signup submits a pending request without creating an authenticated session', flush=True)
        expect(page.locator('[data-auth-mode="reset"]')).to_be_hidden()

        def login(email):
            page.locator('#login-email').fill(email)
            page.locator('#login-password').fill('Fixture-Login-Password-Only')
            page.locator('#account-login button[type="submit"]').click()
            expect(page.locator('#account-signed-in')).to_be_visible()

        login(student['email'])
        expect(page.locator('#account-role-label')).to_have_text('Học sinh')
        expect(page.locator('#account-student-dashboard')).to_be_visible()
        expect(page.locator('#account-student-content')).to_contain_text('1/30')
        expect(page.locator('#account-management')).to_be_hidden()
        expect(page.locator('[data-workspace-view="management"]')).to_be_hidden()
        expect(page.locator('#account-resume-study')).to_have_attribute('href', 'course.learning.html?course=arduino&lesson=timing')
        expect(page.locator('.account-learning-course')).to_have_count(5)
        expect(page.locator('#account-settings')).to_be_hidden()
        expect(page.locator('#account-ai-setup')).to_be_empty()
        assert not any(path.startswith('/v1/admin/ai/') for method, path in api_requests)
        page.locator('[data-workspace-view="settings"]').click()
        expect(page.locator('#account-profile')).not_to_be_visible()
        expect(page.locator('#account-ai-settings-details')).to_be_hidden()
        page.locator('[data-workspace-view="learning"]').click()
        page.locator('#account-activity > summary').click()
        page.locator('#account-activity-load').click()
        expect(page.locator('#account-activity-content')).to_contain_text('Mở phòng lab')
        assert 'Private student note' not in page.locator('#account-student-content').inner_text()
        page.screenshot(path='/tmp/strobot-product-account/student-desktop.png', full_page=True)
        page.set_viewport_size({'width': 390, 'height': 844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        page.screenshot(path='/tmp/strobot-product-account/student-mobile.png', full_page=True)
        page.set_viewport_size({'width': 1440, 'height': 1000})
        print('PASS student resume, five course cards, private progress and collapsed settings on desktop/mobile', flush=True)

        page.locator('#account-logout').click()
        expect(page.locator('#account-signed-in')).to_be_hidden()
        login(manager['email'])
        expect(page.locator('#account-role-label')).to_have_text('Quản trị hệ thống')
        expect(page.locator('#account-workspace-title')).to_contain_text('Học viên')
        expect(page.locator('#account-management')).to_be_visible()
        expect(page.locator('#account-student-dashboard')).to_be_hidden()
        expect(page.locator('[data-student-filter="pending"]')).to_be_visible()
        expect(page.locator('#account-management-content')).to_contain_text('1/30 bài')
        assert 'Private student note' not in page.locator('#account-management-content').inner_text()
        assert not any(path.startswith('/v1/admin/ai/') for method, path in api_requests)
        page.screenshot(path='/tmp/strobot-product-account/admin-desktop.png', full_page=True)
        page.locator('[data-student-filter="pending"]').click()
        expect(page.locator('[data-student-approve="' + pending_id + '"]')).to_be_visible()
        expect(page.locator('[data-student-status="' + pending_id + '"]')).to_have_count(0)
        expect(page.locator('[data-student-password="' + pending_id + '"]')).to_have_count(0)
        page.once('dialog', lambda dialog: dialog.accept())
        page.locator('[data-student-approve="' + pending_id + '"]').click()
        expect(page.locator('#account-management-content')).to_contain_text('Không có đăng ký đang chờ duyệt')
        page.locator('[data-student-filter="all"]').click()
        expect(page.locator('[data-student-status="' + pending_id + '"]')).to_be_visible()
        page.locator('[data-workspace-view="settings"]').click()
        expect(page.locator('#account-ai-settings-details')).to_be_visible()
        expect(page.locator('#account-ai-setup')).to_be_empty()
        assert not any(path.startswith('/v1/admin/ai/') for method, path in api_requests)
        page.locator('#account-ai-settings-details > summary').click()
        expect(page.locator('[data-ai-setup-form]')).to_be_visible()
        assert any(path.startswith('/v1/admin/ai/') for method, path in api_requests)
        page.locator('[data-workspace-view="learning"]').click()
        expect(page.locator('#account-student-dashboard')).to_be_visible()
        expect(page.locator('#account-student-content')).to_contain_text('0/30')
        expect(page.locator('#account-ai-setup')).to_be_empty()
        page.locator('[data-workspace-view="management"]').click()
        page.locator('[data-management-mode="users"]').click()
        expect(page.locator('[data-student-status="' + manager_id + '"]')).to_have_count(0)
        expect(page.locator('[data-student-status="' + inactive_staff_id + '"]')).to_have_count(0)
        expect(page.locator('[data-student-password="' + inactive_staff_id + '"]')).to_have_count(0)
        page.locator('.account-create-student summary').click()
        form = page.locator('#account-create-student')
        expect(form).to_have_attribute('method', 'post')
        for name, value in {'firstName': 'New', 'lastName': 'Learner', 'email': 'created-learner@example.test', 'password': temporary_password}.items():
            form.locator('[name="' + name + '"]').fill(value)
        form.locator('input[type="checkbox"]').check()
        form.locator('button[type="submit"]').click()
        expect(page.locator('#account-management-content')).to_contain_text('created-learner@example.test')
        page.locator('[data-student-password="' + other_id + '"]').click()
        expect(page.locator('#account-student-password-dialog')).to_be_visible()
        assert page.locator('#student-new-password').get_attribute('type') == 'password'
        page.locator('#student-new-password').fill(temporary_password)
        page.locator('#student-password-confirm').check()
        page.locator('#account-student-password button[type="submit"]').click()
        expect(page.locator('#account-student-password-dialog')).to_be_hidden()
        expect(page.locator('#student-new-password')).to_have_value('')
        assert not page.evaluate('password => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes(password))', temporary_password)
        page.once('dialog', lambda dialog: dialog.accept())
        page.locator('[data-student-status="' + other_id + '"]').click()
        expect(page.locator('[data-student-status="' + other_id + '"]')).to_have_text('Mở khóa học viên')
        expect(page.locator('[data-student-password="' + other_id + '"]')).to_have_count(0)
        page.once('dialog', lambda dialog: dialog.accept())
        page.locator('[data-student-status="' + other_id + '"]').click()
        expect(page.locator('[data-student-status="' + other_id + '"]')).to_have_text('Khóa học viên')
        expect(page.locator('[data-student-password="' + other_id + '"]')).to_have_count(1)
        assert mutations == [('request', pending_id), ('approve', pending_id), ('create', '10000000-0000-4000-8000-000000000004'), ('password', other_id), ('status-off', other_id), ('status-on', other_id)]
        print('PASS managed student create/password/status actions use guarded APIs and clear passwords', flush=True)

        page.set_viewport_size({'width': 390, 'height': 844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        assert page.locator('.account-student-table thead').bounding_box()['height'] <= 1
        assert page.evaluate('''() => {
            const wrap = document.querySelector('.account-student-table').parentElement.getBoundingClientRect();
            return [...document.querySelectorAll('.account-student-table td')].every(cell => {
                const bounds = cell.getBoundingClientRect();
                return bounds.left >= wrap.left && bounds.right <= wrap.right;
            });
        }'''), 'mobile student cards keep progress and actions within the viewport'
        page.screenshot(path='/tmp/strobot-product-account/admin-mobile.png', full_page=True)
        manager.update(roles=[], permissions=[], role={'name': 'student'})
        page.evaluate('''async () => { const {accountService}=await import(new URL('../src/services/AccountService.js',location.href)); await accountService.reloadProfile(); }''')
        expect(page.locator('#account-management')).to_be_hidden()
        expect(page.locator('[data-workspace-view="management"]')).to_be_hidden()
        expect(page.locator('#account-ai-settings-details')).to_be_hidden()
        expect(page.locator('#account-ai-setup')).to_be_empty()
        assert not errors, errors
        print('PASS mobile layout and loss of management role hide administration immediately', flush=True)
        browser.close()


if __name__ == '__main__':
    main()
