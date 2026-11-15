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

    def profile(id, email, group='STUDENT', role='student'):
        perms = ['learning:read', 'learning:update'] if group == 'STUDENT' else ['dashboard:read', 'users:read', 'users:update', 'users:create', 'audit:read', 'analytics:read']
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
    errors, mutations = [], []
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
            body = json.loads(request.post_data or '{}')
            actor = tokens.get(request.headers.get('authorization', '').removeprefix('Bearer '))
            data = {}
            if path == '/v1/auth/options':
                data = {'registrationEnabled': False, 'emailDeliveryEnabled': False, 'managedAccountsEnabled': True}
            elif path == '/v1/auth/login':
                user = profiles[body['email']]
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
        expect(page.locator('[data-auth-mode="register"]')).to_be_hidden()
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
        expect(page.locator('#account-workspace-switch')).to_be_hidden()
        page.locator('#account-activity-load').click()
        expect(page.locator('#account-activity-content')).to_contain_text('Mở phòng lab')
        assert 'Private student note' not in page.locator('#account-student-content').inner_text()
        print('PASS student dashboard reads owned progress without management controls', flush=True)

        page.locator('#account-logout').click()
        expect(page.locator('#account-signed-in')).to_be_hidden()
        login(manager['email'])
        expect(page.locator('#account-role-label')).to_have_text('Quản trị hệ thống')
        expect(page.locator('#account-workspace-title')).to_contain_text('quản trị')
        expect(page.locator('#account-management')).to_be_visible()
        expect(page.locator('#account-student-dashboard')).to_be_hidden()
        page.locator('[data-workspace-view="learning"]').click()
        expect(page.locator('#account-student-dashboard')).to_be_visible()
        expect(page.locator('#account-student-content')).to_contain_text('0/30')
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
        assert mutations == [('create', '10000000-0000-4000-8000-000000000004'), ('password', other_id), ('status-off', other_id), ('status-on', other_id)]
        print('PASS managed student create/password/status actions use guarded APIs and clear passwords', flush=True)

        page.set_viewport_size({'width': 390, 'height': 844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        manager.update(roles=[], permissions=[], role={'name': 'student'})
        page.evaluate('''async () => { const {accountService}=await import(new URL('../src/services/AccountService.js',location.href)); await accountService.reloadProfile(); }''')
        expect(page.locator('#account-management')).to_be_hidden()
        expect(page.locator('#account-workspace-switch')).to_be_hidden()
        assert not errors, errors
        print('PASS mobile layout and loss of management role hide administration immediately', flush=True)
        browser.close()


if __name__ == '__main__':
    main()
