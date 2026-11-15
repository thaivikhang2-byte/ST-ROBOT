#!/usr/bin/env python3
"""Real managed-account lifecycle against disposable loopback services.

The operator fixture is supplied privately by the caller, never in source:
  {"api":"http://127.0.0.1:3200/api", "base":"http://127.0.0.1:5500",
   "adminEmail":"...", "adminPassword":"..."}

Requires a fresh seeded database with an explicitly attested SYSTEM admin and
managed accounts enabled. Creates a random student. No SMTP/provider calls.
"""
import argparse
import importlib.util
import json
import os
import pathlib
import secrets
import urllib.parse

from playwright.sync_api import expect, sync_playwright

HELPER = pathlib.Path(__file__).with_name('account-fullstack-smoke.py')
SPEC = importlib.util.spec_from_file_location('account_fullstack_helpers', HELPER)
HELPERS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HELPERS)
LocalApi, eventually, require = HELPERS.LocalApi, HELPERS.eventually, HELPERS.require


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', type=pathlib.Path, default='/tmp/strobot-managed-fixture.private.json')
    parser.add_argument('--output', type=pathlib.Path, default='/tmp/strobot-managed-fullstack-results.json')
    parser.add_argument('--state', type=pathlib.Path, default='/tmp/strobot-managed-smoke-state.private.json')
    parser.add_argument('--chromium', default='/usr/bin/chromium')
    args = parser.parse_args()
    fixture = json.loads(args.fixture.read_text())
    base = fixture.get('base', 'http://127.0.0.1:5500').rstrip('/')
    api_url = fixture.get('api', 'http://127.0.0.1:3200/api').rstrip('/')
    for url in (base, api_url):
        require(urllib.parse.urlsplit(url).hostname in ['localhost', '127.0.0.1', '::1'],
                'This test requires disposable loopback services')
    admin_email = fixture.get('adminEmail', fixture.get('email'))
    admin_password = fixture.get('adminPassword', fixture.get('password'))
    require(bool(admin_email and admin_password), 'Private operator fixture is incomplete')
    public = base + '/frontend/public/'
    run_id = secrets.token_hex(6)
    student_email = 'managed-' + run_id + '@school.local'
    student_password = 'Fixture-' + secrets.token_urlsafe(18)
    changed_password = 'Changed-' + secrets.token_urlsafe(18)
    note = 'Managed account private journal ' + run_id
    key = 'strobot.original.course.v3'
    api = LocalApi(api_url)
    results, errors, api_events = [], [], []
    state = {'studentEmail': student_email, 'studentPassword': student_password,
             'changedPassword': changed_password}

    def checkpoint():
        descriptor = os.open(args.state, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(state, stream)

    def passed(name):
        checkpoint()
        require(not errors, 'Uncaught browser errors occurred')
        results.append({'name': name, 'status': 'passed'})
        print('PASS', name, flush=True)

    def sanitize(value):
        text = str(value)
        sensitive = [admin_password, student_password, changed_password]
        sensitive += [v for k, v in state.items() if 'token' in k.lower() and isinstance(v, str)]
        for secret in sensitive:
            if secret:
                text = text.replace(secret, '[private]')
        return text

    try:
        options = api.call('/v1/auth/options')
        require(options == {'registrationEnabled': False, 'managedAccountsEnabled': True,
                            'emailDeliveryEnabled': False}, 'Managed-only auth options are not active')
        api.call('/v1/auth/register', method='POST', status=403, body={
            'email': 'blocked-' + run_id + '@example.test', 'password': student_password,
            'firstName': 'Blocked', 'lastName': 'Registration'})
        admin_login = api.call('/v1/auth/login', method='POST',
                               body={'email': admin_email, 'password': admin_password})
        state['adminToken'] = admin_login['tokens']['accessToken']
        state['adminId'] = admin_login['user']['id']
        require(admin_login['user']['isEmailVerified'] is True, 'Operator identity was not attested')
        settings = api.call('/v1/admin/ai/settings', token=state['adminToken'])
        require(isinstance(settings, dict), 'Administrator AI settings returned no metadata')
        require('apiKey' not in settings and 'ciphertext' not in settings,
                'AI settings metadata exposed a secret')
        passed('managed mode disables public signup and email flows; operator can read actual AI settings')

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=args.chromium, headless=True,
                args=['--no-sandbox', '--disable-dev-shm-usage'])
            allowed = {urllib.parse.urlsplit(base).netloc, urllib.parse.urlsplit(api_url).netloc}

            def context(viewport=None):
                result = browser.new_context(viewport=viewport or {'width': 1440, 'height': 1000})
                def route_request(route):
                    url = urllib.parse.urlsplit(route.request.url)
                    if url.netloc == urllib.parse.urlsplit(base).netloc and url.path.endswith('/src/config/backend.config.js'):
                        route.fulfill(status=200, content_type='text/javascript', body=
                            'export const BACKEND_CONFIG={apiBaseUrl:' + json.dumps(api_url) + '};'
                            'export function resolveBackendUrl(){return BACKEND_CONFIG.apiBaseUrl;}')
                    elif url.netloc in allowed:
                        route.continue_()
                    elif url.scheme in ['http', 'https']:
                        route.fulfill(status=200, content_type='text/html', body='<html><body>External service blocked</body></html>')
                    else:
                        route.continue_()
                result.route('**/*', route_request)
                result.on('response', lambda response: api_events.append({
                    'method': response.request.method,
                    'path': urllib.parse.urlsplit(response.url).path,
                    'status': response.status,
                }) if urllib.parse.urlsplit(response.url).netloc == urllib.parse.urlsplit(api_url).netloc else None)
                return result

            def page_for(session):
                page = session.new_page()
                page.set_default_timeout(15000)
                page.on('pageerror', lambda error: errors.append(sanitize(error)))
                return page

            def ui_login(page, email, password):
                page.locator('#login-email').fill(email)
                page.locator('#login-password').fill(password)
                with page.expect_response(lambda response: response.request.method == 'POST'
                        and response.url == api_url + '/v1/auth/login') as capture:
                    page.locator('#account-login button[type="submit"]').click()
                response = capture.value
                require(response.status == 200, 'UI login did not return success')
                payload = response.json()['data']
                expect(page.locator('#account-signed-in')).to_be_visible()
                return payload

            admin_session = context()
            admin = page_for(admin_session)
            admin.goto(public + 'account.html', wait_until='domcontentloaded')
            expect(admin.locator('[data-auth-mode="register"]')).to_be_hidden()
            ui_login(admin, admin_email, admin_password)
            expect(admin.locator('#account-role-label')).to_have_text('Quản trị hệ thống')
            expect(admin.locator('#account-management')).to_be_visible()
            admin.locator('[data-management-mode="ai"]').click()
            expect(admin.locator('#account-ai-setup')).to_be_visible()
            expect(admin.locator('#account-ai-setup')).to_contain_text('Cấu hình agent AI')
            admin.locator('[data-management-mode="users"]').click()
            admin.locator('.account-create-student summary').click()
            form = admin.locator('#account-create-student')
            for field, value in {'email': student_email, 'password': student_password,
                                 'firstName': 'Fixture', 'lastName': 'Managed Learner'}.items():
                form.locator('[name="' + field + '"]').fill(value)
            form.locator('input[type="checkbox"]').check()
            with admin.expect_response(lambda response: response.request.method == 'POST'
                    and response.url == api_url + '/v1/users/students') as capture:
                form.locator('button[type="submit"]').click()
            require(capture.value.status in (200, 201), 'Managed student creation was rejected')
            created = capture.value.json()['data']
            state['studentId'] = created['id']
            require(created['isEmailVerified'] is True, 'Managed student identity did not become confirmed')
            require(all(role.get('group') == 'STUDENT' for role in created.get('roles', [])),
                    'Managed student gained a staff role')
            expect(admin.locator('#account-management-content')).to_contain_text(student_email)
            expect(admin.locator('#account-create-student [name="password"]')).to_have_value('')
            require(not admin.evaluate('''secret => [...Object.values(localStorage), ...Object.values(sessionStorage)]
                .some(value => value.includes(secret))''', student_password), 'Student creation persisted its password')
            passed('real administrator UI creates a confirmed forced-student account without SMTP')

            learner_session = context({'width': 390, 'height': 844})
            learner = page_for(learner_session)
            learner.goto(public + 'account.html', wait_until='domcontentloaded')
            login = ui_login(learner, student_email, student_password)
            state['studentToken'] = login['tokens']['accessToken']
            expect(learner.locator('#account-role-label')).to_have_text('Học sinh')
            expect(learner.locator('#account-student-dashboard')).to_be_visible()
            expect(learner.locator('#account-management')).to_be_hidden()
            require(learner.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),
                    'Student layout overflows the phone viewport')
            api.call('/v1/admin/ai/settings', token=state['studentToken'], status=403)
            api.call('/v1/users/students', method='POST', token=state['studentToken'], status=403,
                body={'email': 'forbidden-' + run_id + '@school.local', 'password': student_password,
                      'firstName': 'Forbidden', 'lastName': 'Account'})
            learner.goto(public + 'course.learning.html?course=arduino&lesson=led', wait_until='domcontentloaded')
            expect(learner.locator('#main')).to_have_attribute('aria-busy', 'false')
            learner.locator('#tabBtnLab').click()
            details = learner.locator('#journal').locator('xpath=ancestor::details[1]')
            if details.get_attribute('open') is None:
                details.locator(':scope > summary').click()
            learner.locator('#journal').fill(note)
            def saved_note():
                snapshot = api.call('/v1/learner-state', token=state['studentToken'])
                return json.loads(snapshot['values'].get(key, '{}')).get('arduino', {}).get('led', {}).get('note') == note
            eventually(saved_note, 'Managed student journal did not reach PostgreSQL', page=learner)
            learner.goto(public + 'account.html', wait_until='domcontentloaded')
            expect(learner.locator('#account-student-content')).to_contain_text('Arduino Uno')
            passed('confirmed student logs in on phone, has no admin authority and saves journal to the database')

            status_button = admin.locator('[data-student-status="' + state['studentId'] + '"]')
            admin.once('dialog', lambda dialog: dialog.accept())
            status_button.click()
            expect(status_button).to_have_text('Mở khóa học viên')
            locked_users = api.call('/v1/users?search=' + urllib.parse.quote(student_email),
                                    token=state['adminToken'])
            locked_rows = locked_users.get('data', []) if isinstance(locked_users, dict) else locked_users
            locked = next(row for row in locked_rows if row['id'] == state['studentId'])
            require(locked['isActive'] is False and locked['roles'] == [] and locked['permissions'] == [],
                    'Management classification accidentally restored inactive account permissions')
            require(locked.get('management', {}).get('studentOnly') is True,
                    'Locked student lost the protected management classification needed to unlock')
            api.call('/v1/auth/me', token=state['studentToken'], status=401)
            learner.evaluate('''async () => {
                const {accountService}=await import(new URL('../src/services/AccountService.js',location.href));
                try { await accountService.request('/v1/auth/me'); } catch {}
            }''')
            expect(learner.locator('#account-signed-in')).to_be_hidden()
            admin.once('dialog', lambda dialog: dialog.accept())
            status_button.click()
            expect(status_button).to_have_text('Khóa học viên')
            api.call('/v1/auth/me', token=state['studentToken'], status=401)
            passed('administrator lock immediately revokes student sessions; unlocking does not restore old tokens')

            admin.locator('[data-student-password="' + state['studentId'] + '"]').click()
            expect(admin.locator('#account-student-password-dialog')).to_be_visible()
            admin.locator('#student-new-password').fill(changed_password)
            admin.locator('#student-password-confirm').check()
            with admin.expect_response(lambda response: response.request.method == 'POST'
                    and response.url.endswith('/student-password')) as capture:
                admin.locator('#account-student-password button[type="submit"]').click()
            require(capture.value.status in (200, 201), 'Student password reset was rejected')
            expect(admin.locator('#account-student-password-dialog')).to_be_hidden()
            expect(admin.locator('#student-new-password')).to_have_value('')
            api.call('/v1/users/' + state['adminId'] + '/student-password', method='POST',
                     token=state['adminToken'], body={'newPassword': changed_password}, status=403)
            api.call('/v1/auth/login', method='POST', status=401,
                     body={'email': student_email, 'password': student_password})
            renewed = ui_login(learner, student_email, changed_password)
            state['newStudentToken'] = renewed['tokens']['accessToken']
            snapshot = api.call('/v1/learner-state', token=state['newStudentToken'])
            require(note in snapshot['values'].get(key, ''), 'Password reset lost saved learner data')
            require(not admin.evaluate('''secret => [...Object.values(localStorage), ...Object.values(sessionStorage)]
                .some(value => value.includes(secret))''', changed_password), 'Student password reset persisted its password')
            passed('password reset is student-only, invalidates old password and preserves saved learning data')
            browser.close()
        report = {'status': 'passed', 'results': results, 'browserErrors': errors,
                  'apiEvents': api_events, 'externalServices': 'blocked; no SMTP or provider calls'}
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print('PASS real managed-account lifecycle', flush=True)
        return 0
    except Exception as error:
        checkpoint()
        failure = sanitize(error)
        args.output.write_text(json.dumps({'status': 'failed', 'results': results,
            'browserErrors': errors, 'apiEvents': api_events, 'failure': failure,
            'failureType': type(error).__name__}, ensure_ascii=False, indent=2))
        print('FAIL', type(error).__name__, failure, flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
