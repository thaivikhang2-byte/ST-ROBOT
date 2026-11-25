#!/usr/bin/env python3
"""Approval, account, progress and lab journey on disposable loopback services.

Build backend first, then pass a private JSON test environment. This script
creates and drops only its randomly named PostgreSQL database and owns its API
and static-server processes. A synthetic encrypted provider verifies central
agent availability; provider generation is never requested.

  python3 tests/product-journey-smoke.py --env-file /private/test-env.json

Requires PostgreSQL/Redis loopback fixtures, Chromium and Python Playwright.
Reports contain assertion names, never passwords, tokens or private work.
"""
import argparse
import base64
import json
import os
import pathlib
import secrets
import socket
import subprocess
import tempfile
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request

from playwright.sync_api import expect, sync_playwright


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def eventually(callback, message, *, page=None, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if callback():
                return
        except (OSError, ValueError, AssertionError):
            pass
        if page is None:
            time.sleep(0.15)
        else:
            page.wait_for_timeout(150)
    raise AssertionError(message)


class LocalApi:
    def __init__(self, base, address='198.51.100.1'):
        self.base, self.address = base.rstrip('/'), address
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def call(self, path, *, method='GET', body=None, token=None, status=200, timeout=15):
        headers = {'Accept': 'application/json', 'X-Forwarded-For': self.address}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        if body is not None:
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(self.base + path, method=method, headers=headers,
            data=None if body is None else json.dumps(body).encode())
        try:
            response = self.opener.open(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            actual, payload = response.status, json.loads(response.read())
        accepted = status if isinstance(status, tuple) else (status,)
        require(actual in accepted, 'Unexpected HTTP status for ' + method + ' ' + path.split('?')[0]
                + ': ' + str(actual))
        if actual < 400:
            require(payload.get('success') is True and 'data' in payload, 'Missing successful application envelope')
            return payload['data']
        return payload


DATABASE_HELPER = r'''
const fs = require('node:fs');
const {Client} = require('pg');
const input = JSON.parse(fs.readFileSync(0,'utf8'));
const source = new URL(process.env.DATABASE_URL || '');
const assert = value => { if(!value) throw new Error('Disposable product fixture guard failed') };
assert(process.env.NODE_ENV==='test' && ['localhost','127.0.0.1','[::1]'].includes(source.hostname));
assert(source.pathname.endsWith('_test') && /^strobot_product_[a-f0-9]{16}_test$/.test(input.database));
(async()=>{
 const db = new Client({connectionString:source.href});
 try {
  await db.connect();
  if(input.operation==='create') await db.query(`CREATE DATABASE "${input.database}"`);
  else if(input.operation==='drop') await db.query(`DROP DATABASE "${input.database}" WITH (FORCE)`);
  else throw new Error('Unknown disposable fixture operation');
  console.log('{}');
 } finally { await db.end(); }
})().catch(()=>{ console.error('Disposable product database operation failed');process.exitCode=1; });
'''


class OwnedProcess:
    def __init__(self, command, cwd, env, log):
        descriptor = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'wb') as output:
            self.process = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                stdout=output, stderr=subprocess.STDOUT)

    def stop(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=12)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)


def free_port(port):
    require(1024 <= port <= 65535, 'An unprivileged fixture port is required')
    with socket.socket() as probe:
        probe.settimeout(0.2)
        require(probe.connect_ex(('127.0.0.1', port)) != 0,
                'Fixture port belongs to another process; it will not be stopped')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', required=True, type=pathlib.Path)
    parser.add_argument('--api-port', type=int, default=3400)
    parser.add_argument('--web-port', type=int, default=5526)
    parser.add_argument('--chromium', default='/usr/bin/chromium' if pathlib.Path('/usr/bin/chromium').is_file() else None)
    parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('/tmp/strobot-product-journey-results.json'))
    args = parser.parse_args()
    repo = pathlib.Path(__file__).resolve().parents[1]
    backend = repo / 'backend'
    cfg = json.loads(args.env_file.read_text())
    target = urllib.parse.urlsplit(cfg.get('DATABASE_URL', ''))
    require(cfg.get('NODE_ENV') == 'test' and target.scheme in {'postgres', 'postgresql'}
            and target.hostname in {'localhost', '127.0.0.1', '::1'} and target.path.endswith('_test'),
            'Only a disposable loopback PostgreSQL fixture is supported')
    redis = urllib.parse.urlsplit(cfg.get('REDIS_URL', 'redis://localhost:6379'))
    require(redis.hostname in {'localhost', '127.0.0.1', '::1'}, 'Redis must be a loopback fixture')
    for entry in ['dist/main.js', 'dist/setup/prisma/seed.js', 'dist/setup/scripts/initialize-admin.js']:
        require((backend / entry).is_file(), 'Build backend and initialization scripts before this regression')
    free_port(args.api_port)
    free_port(args.web_port)
    require(args.api_port != args.web_port, 'API and frontend ports must differ')
    run_id = secrets.token_hex(8)
    database = 'strobot_product_' + run_id + '_test'
    database_url = urllib.parse.urlunsplit(target._replace(path='/' + database))
    api_url = 'http://127.0.0.1:' + str(args.api_port) + '/api'
    base = 'http://127.0.0.1:' + str(args.web_port)
    public = base + '/frontend/public/'
    admin_email, admin_password = 'operator-' + run_id + '@school.local', secrets.token_urlsafe(30)
    student_a = {'email': 'learner-a-' + run_id + '@school.local', 'password': secrets.token_urlsafe(30),
                 'firstName': 'Fixture A', 'lastName': 'Student'}
    student_b = {'email': 'learner-b-' + run_id + '@school.local', 'password': secrets.token_urlsafe(30),
                 'firstName': 'Fixture B', 'lastName': 'Student'}
    note_a = 'Private student A journal ' + run_id
    lab_code, lab_notes = '// private-workspace-' + run_id + '\nvoid setup() {}\nvoid loop() {}', 'Private lab checkpoint ' + run_id
    diagram_bytes = json.dumps({'version': 1, 'author': run_id, 'editor': 'wokwi', 'parts': [], 'connections': []}).encode()
    dummy_key = 'synthetic-provider-never-dispatched-' + secrets.token_urlsafe(24)
    private_values = [admin_password, student_a['password'], student_b['password'], dummy_key,
                      cfg.get('JWT_SECRET', ''), cfg.get('JWT_REFRESH_SECRET', ''),
                      cfg.get('AI_CREDENTIALS_MASTER_KEY', ''), database_url]
    env = {**os.environ, **{str(key): str(value) for key, value in cfg.items()}}
    for name in list(env):
        if name.startswith(('INITIAL_ADMIN_', 'BOOTSTRAP_ADMIN_')):
            env.pop(name)
    env.pop('NODE_OPTIONS', None)
    owned_env = {**env, 'DATABASE_URL': database_url, 'PORT': str(args.api_port),
        'APP_PORT': str(args.api_port), 'CORS_ORIGIN': base, 'TRUST_PROXY': '1',
        'MANAGED_ACCOUNTS_ENABLED': 'true', 'FEATURE_REGISTRATION_ENABLED': 'false',
        'STUDENT_APPROVAL_REGISTRATION_ENABLED': 'true',
        'MAIL_PROVIDER': 'disabled', 'AI_VAULT_STORAGE': 'database',
        'AI_ADMIN_ALLOW_LOCAL_HTTP': 'true', 'AI_GATEWAY_ENABLED': 'true', 'FEATURE_AI_ENABLED': 'true',
        'AI_APPROVED_BASE_URLS': 'https://product-provider.invalid/v1', 'AI_FALLBACK_ENABLED': 'false',
        'VIDEO_WORKER_ENABLED': 'false', 'BACKUP_ENABLED': 'false', 'SWAGGER_ENABLED': 'false'}
    api = LocalApi(api_url)
    results, browser_errors, events, processes = [], [], [], []
    created, started, stage = False, time.monotonic(), 'fixture initialization'

    def run(command, environment, input_data=None):
        result = subprocess.run(command, cwd=backend, env=environment,
            input=None if input_data is None else json.dumps(input_data), capture_output=True,
            text=True, timeout=120)
        require(result.returncode == 0, 'Private fixture subprocess failed: ' + command[-1])
        return result

    def database_operation(operation):
        run(['node', '-e', DATABASE_HELPER], env, {'operation': operation, 'database': database})

    def passed(name):
        require(not browser_errors, 'Unhandled browser application error')
        results.append({'name': name, 'status': 'passed'})
        print('PASS', name, flush=True)

    def assert_private_aggregate(value):
        serialized = json.dumps(value)
        require(not any(private in serialized for private in [note_a, lab_code, lab_notes, dummy_key]),
                'Administrative aggregate exposed private learner content')
        require(not any(key in serialized for key in ['password_hash', 'refreshToken', 'ciphertext']),
                'Administrative aggregate exposed credential material')

    def rows_of(value):
        return value if isinstance(value, list) else value.get('data', [])

    with tempfile.TemporaryDirectory(prefix='strobot-product-journey-') as temporary:
        directory = pathlib.Path(temporary)
        try:
            database_operation('create')
            created = True
            run(['node', 'scripts/apply-disposable-test-migrations.cjs'], owned_env)
            run(['node', '--max-old-space-size=128', 'dist/setup/prisma/seed.js'], owned_env)
            repeated_seed = run(['node', '--max-old-space-size=128', 'dist/setup/prisma/seed.js'], owned_env)
            require('Database defaults already initialized for this seed version.' in repeated_seed.stdout,
                    'Compiled startup did not skip already initialized database defaults')
            run(['node', '--max-old-space-size=128', 'dist/setup/scripts/initialize-admin.js'],
                {**owned_env, 'INITIAL_ADMIN_ENABLED': 'true', 'INITIAL_ADMIN_EMAIL': admin_email,
                 'INITIAL_ADMIN_PASSWORD': admin_password})
            processes.append(OwnedProcess(['node', 'dist/main.js'], backend, owned_env, directory / 'api.private.log'))
            # Reuse the audited frontend-only server: backend files, environment
            # files and repository metadata must never be served by this fixture.
            processes.append(OwnedProcess(['node', '-e',
                "require('./start-web.cjs').createFrontendServer().listen(Number(process.argv[1]), '127.0.0.1')",
                str(args.web_port)], repo, env, directory / 'frontend.private.log'))
            eventually(lambda: api.call('/system/health/ready', timeout=2).get('status') == 'ok',
                       'Owned backend did not become ready', timeout=60)
            options = api.call('/v1/auth/options')
            require(options.get('approvalRegistrationEnabled') is True and options.get('registrationMode') == 'approval',
                    'Managed approval registration mode is unavailable')
            operator = api.call('/v1/auth/login', method='POST', body={'email': admin_email, 'password': admin_password})
            admin_token = operator['tokens']['accessToken']
            private_values.extend(operator['tokens'][key] for key in ['accessToken', 'refreshToken'])

            # Once-only operator setup. The .invalid endpoint is never contacted.
            limits = {'requestsPerMinute': 20, 'tokensPerDay': 50000, 'maxConcurrent': 2}
            provider = {'id': 'product-fixture', 'type': 'openai-compatible', 'enabled': True,
                'accountGroup': 'product-fixture', 'privacyGroup': 'product-fixture',
                'models': ['fixture-agent'], 'selection': 'priority', 'maxRetries': 0,
                'limits': limits, 'timeoutMs': 1000, 'priority': 0,
                'endpoints': [{'id': 'fixture-endpoint', 'baseUrl': 'https://product-provider.invalid/v1',
                               'enabled': True, 'capabilities': ['chat', 'tools']}]}
            vault = api.call('/v1/admin/ai/vault', token=admin_token)
            vault = api.call('/v1/admin/ai/providers/product-fixture/config', method='PUT', token=admin_token,
                             body={'expectedRevision': vault['revision'], 'provider': provider})
            api.call('/v1/admin/ai/providers/product-fixture/credentials', method='POST', status=(200, 201),
                token=admin_token, body={'expectedRevision': vault['revision'], 'id': 'fixture-credential',
                    'apiKey': dummy_key, 'enabled': True, 'endpointIds': ['fixture-endpoint'], 'limits': limits})
            api.call('/v1/admin/ai/models', method='POST', status=(200, 201), token=admin_token,
                body={'providerId': 'product-fixture', 'modelId': 'fixture-agent', 'enabled': True,
                    'isDefault': True, 'premium': False, 'capabilities': ['chat', 'tools'],
                    'allowedTools': [], 'maxInputTokens': 32768, 'maxOutputTokens': 2048, 'contextTokens': 65536})
            api.call('/v1/admin/ai/settings', method='PATCH', token=admin_token, body={'enabled': True})
            passed('fresh managed deployment supports approval registration and central agent configuration')

            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(executable_path=args.chromium, headless=True,
                    args=['--no-sandbox', '--disable-dev-shm-usage'])
                own_origins = {urllib.parse.urlsplit(base).netloc, urllib.parse.urlsplit(api_url).netloc}

                def context(address, viewport=None):
                    session = browser.new_context(viewport=viewport or {'width': 1440, 'height': 1000},
                        extra_http_headers={'X-Forwarded-For': address})

                    def route_request(route):
                        parsed = urllib.parse.urlsplit(route.request.url)
                        if parsed.netloc == urllib.parse.urlsplit(base).netloc and parsed.path.endswith('/src/config/backend.config.js'):
                            route.fulfill(content_type='text/javascript', body=
                                'export const BACKEND_CONFIG={apiBaseUrl:' + json.dumps(api_url) + '};'
                                'export function resolveBackendUrl(){return BACKEND_CONFIG.apiBaseUrl;}')
                        elif parsed.netloc == urllib.parse.urlsplit(api_url).netloc:
                            require(not (route.request.method == 'POST' and parsed.path.endswith('/ai/agent/chat')),
                                    'Product journey must not call AI generation')
                            route.continue_()
                        elif parsed.netloc in own_origins:
                            route.continue_()
                        elif parsed.scheme in {'http', 'https'}:
                            route.fulfill(content_type='text/html', body='<html><body>External lab fixture</body></html>')
                        else:
                            route.continue_()
                    session.route('**/*', route_request)
                    session.on('response', lambda response: events.append({'method': response.request.method,
                        'path': urllib.parse.urlsplit(response.url).path, 'status': response.status})
                        if urllib.parse.urlsplit(response.url).netloc == urllib.parse.urlsplit(api_url).netloc else None)
                    return session

                def page_for(session):
                    page = session.new_page()
                    page.set_default_timeout(20000)
                    page.on('pageerror', lambda _error: browser_errors.append('unhandled application error'))
                    return page

                def ui_login(page, credentials):
                    page.goto(public + 'account.html', wait_until='domcontentloaded')
                    page.locator('#login-email').fill(credentials['email'])
                    page.locator('#login-password').fill(credentials['password'])
                    with page.expect_response(lambda response: response.request.method == 'POST'
                            and response.url == api_url + '/v1/auth/login') as capture:
                        page.locator('#account-login button[type="submit"]').click()
                    require(capture.value.status == 200, 'UI login failed')
                    payload = capture.value.json()['data']
                    private_values.extend(payload['tokens'][key] for key in ['accessToken', 'refreshToken'])
                    expect(page.locator('#account-signed-in')).to_be_visible()
                    return payload

                stage = 'student phone registration and pending restrictions'
                learner_session = context('198.51.100.10', {'width': 390, 'height': 844})
                learner = page_for(learner_session)
                learner.goto(public + 'account.html', wait_until='domcontentloaded')
                register_tab = learner.locator('[data-auth-mode="register"]')
                expect(register_tab).to_be_visible()
                register_tab.click()
                registration = learner.locator('#account-register')
                for name, value in student_a.items():
                    registration.locator('[name="' + name + '"]').fill(value)
                with learner.expect_response(lambda response: response.request.method == 'POST'
                        and response.url == api_url + '/v1/auth/student-requests') as capture:
                    registration.locator('button[type="submit"]').click()
                require(capture.value.status == 202, 'Student signup did not enter pending approval')
                response = capture.value.json()['data']
                require(response.get('status') == 'pending' and 'tokens' not in response,
                        'Pending request unexpectedly issued an authenticated session')
                expect(learner.locator('#account-message')).to_contain_text('duyệt')
                expect(learner.locator('#account-signed-in')).to_be_hidden()
                LocalApi(api_url, '198.51.100.11').call('/v1/auth/login', method='POST', status=401,
                    body={'email': student_a['email'], 'password': student_a['password']})
                api.call('/v1/learner-state', status=401)
                api.call('/v1/ai/agent/status?mode=EDUCATIONAL', status=401)
                passed('student self-registers on a phone and remains unauthenticated until approval')

                stage = 'administrator approval'
                admin_session = context('198.51.100.20')
                admin = page_for(admin_session)
                admin.on('dialog', lambda dialog: dialog.accept())
                ui_login(admin, {'email': admin_email, 'password': admin_password})
                expect(admin.locator('#account-management')).to_be_visible()
                expect(admin.locator('#account-ai-setup')).to_be_hidden()
                pending = api.call('/v1/users/student-overview?status=pending&page=1&limit=20', token=admin_token)
                row = next((item for item in rows_of(pending) if item['email'] == student_a['email']), None)
                require(row and row['approvalPending'] is True and row['isActive'] is False,
                        'Pending learner is absent from administrator overview')
                student_id = row['id']
                assert_private_aggregate(pending)
                pending_tab = admin.locator('[data-student-filter="pending"]')
                if pending_tab.count():
                    pending_tab.click()
                expect(admin.locator('#account-management-content')).to_contain_text(student_a['email'])
                approve = admin.locator('[data-student-approve="' + student_id + '"]')
                with admin.expect_response(lambda response: response.request.method == 'POST'
                        and response.url == api_url + '/v1/users/' + student_id + '/approve-student') as capture:
                    approve.click()
                require(capture.value.status in (200, 201), 'Administrator approval failed')
                approved = capture.value.json()['data']
                require(approved.get('isEmailVerified') is True and approved.get('isActive') is True,
                        'Approved student identity did not become usable')
                require(approved.get('roles') and all(role.get('group') == 'STUDENT' for role in approved['roles']),
                        'Approval granted a staff role')
                passed('administrator starts in learner management and approves a student identity')

                stage = 'approved student dashboard and central agent'
                login_a = ui_login(learner, student_a)
                token_a = login_a['tokens']['accessToken']
                expect(learner.locator('#account-student-dashboard')).to_be_visible()
                expect(learner.locator('#account-management')).to_be_hidden()
                expect(learner.locator('#account-ai-setup')).to_be_hidden()
                require(learner.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),
                        'Student dashboard overflows the phone viewport')
                require(api.call('/v1/ai/agent/status?mode=EDUCATIONAL', token=token_a).get('available') is True,
                        'Student cannot use centrally configured agent metadata')
                api.call('/v1/admin/ai/vault', token=token_a, status=403)
                api.call('/v1/users/student-overview', token=token_a, status=403)
                passed('approved student has a personal dashboard and agent availability without key setup')

                stage = 'student lab workspace and completion synchronization'
                course_url = public + 'course.learning.html?course=arduino&lesson=led&view=lab&lab=wokwi'
                learner.goto(course_url, wait_until='domcontentloaded')
                expect(learner.locator('#main')).to_have_attribute('aria-busy', 'false')
                learner.locator('#tabBtnLab').click()
                expect(learner.locator('#labWorkSave')).to_be_enabled()
                details = learner.locator('#journal').locator('xpath=ancestor::details[1]')
                if details.get_attribute('open') is None:
                    details.locator(':scope > summary').click()
                learner.locator('#journal').fill(note_a)
                code_details = learner.locator('#labWorkCode').locator('xpath=ancestor::details[1]')
                if code_details.get_attribute('open') is None:
                    code_details.locator(':scope > summary').click()
                learner.locator('#labWorkCode').fill(lab_code)
                learner.locator('#labWorkNotes').fill(lab_notes)
                learner.locator('#labWorkFiles').set_input_files([
                    {'name': 'sketch.ino', 'mimeType': 'text/plain', 'buffer': lab_code.encode()},
                    {'name': 'diagram.json', 'mimeType': 'application/json', 'buffer': diagram_bytes},
                ])
                expect(learner.locator('#labWorkFileList')).to_contain_text('diagram.json')
                learner.locator('#labWorkSave').click()
                learner.locator('#labButtons button[data-lab-key="local"]').click()
                learner.locator('#prediction').fill('The LED should light with a closed forward circuit.')
                learner.locator('#practiceSource').select_option('local-model')
                learner.locator('#localLab').get_by_role('button', name='Thử mạch', exact=True).click()
                last_result = learner.evaluate('record().modelEvidence.summary')
                learner.locator('#labWorkExperiment').click()
                require(last_result in learner.locator('#labWorkNotes').input_value(),
                        'Local worksheet did not receive the most recent model result')
                learner.locator('#observation').fill('With the circuit closed and forward polarity the LED lights.')
                learner.locator('#explanation').fill('The forward circuit allows current through the resistor and LED.')
                learner.locator('#transfer').fill('Reverse polarity stops current; restoring forward polarity lights it.')
                quiz_details = learner.locator('#quizForm').locator('xpath=ancestor::details[1]')
                if quiz_details.get_attribute('open') is None:
                    quiz_details.locator(':scope > summary').click()
                answer = learner.evaluate('course.lessons.find(item => item.id === "led").answer')
                learner.locator('#quizForm input[name="answer"][value="' + str(answer) + '"]').check()
                learner.locator('#quizForm button[type="submit"]').click()
                learner.get_by_role('button', name='Xác nhận hoàn thành bài', exact=True).click()
                learner.locator('#labButtons button[data-lab-key="wokwi"]').click()

                def saved_work():
                    snapshot = api.call('/v1/learner-state', token=token_a)
                    state = json.loads(snapshot['values'].get('strobot.original.course.v3', '{}'))
                    record = state.get('arduino', {}).get('led', {})
                    work = record.get('labWork', {}).get('wokwi', {})
                    return (record.get('note') == note_a and record.get('done') is True
                            and work.get('version') == 2 and work.get('code') == lab_code and work.get('notes') == lab_notes
                            and {file['name']: file['dataBase64'] for file in work.get('files', [])}
                            == {'sketch.ino': base64.b64encode(lab_code.encode()).decode(), 'diagram.json': base64.b64encode(diagram_bytes).decode()})
                eventually(saved_work, 'Completed practice and lab checkpoint did not reach PostgreSQL', page=learner)
                expect(learner.locator('#labWorkStatus')).to_contain_text('Đã đồng bộ')
                passed('student completion, journal and lab checkpoint persist through real synchronization')

                stage = 'second device restoration'
                second_device = context('198.51.100.30')
                learner_again = page_for(second_device)
                login_a_second_device = ui_login(learner_again, student_a)
                token_a_second_device = login_a_second_device['tokens']['accessToken']
                expect(learner_again.locator('#account-student-content [data-course-id="arduino"] progress')).to_have_attribute('value', '1')
                expect(learner_again.locator('#account-resume-study')).to_have_attribute('href',
                    'course.learning.html?course=arduino&lesson=timing')
                learner_again.goto(course_url, wait_until='domcontentloaded')
                expect(learner_again.locator('#main')).to_have_attribute('aria-busy', 'false')
                learner_again.locator('#tabBtnLab').click()
                expect(learner_again.locator('#labWorkSave')).to_be_enabled()
                details = learner_again.locator('#journal').locator('xpath=ancestor::details[1]')
                if details.get_attribute('open') is None:
                    details.locator(':scope > summary').click()
                expect(learner_again.locator('#journal')).to_have_value(note_a)
                expect(learner_again.locator('#labWorkCode')).to_have_value(lab_code)
                expect(learner_again.locator('#labWorkNotes')).to_have_value(lab_notes)
                expect(learner_again.locator('#labWorkFileList li')).to_have_count(2)
                with learner_again.expect_download() as native_download:
                    learner_again.locator('#labWorkFileList li').filter(has_text='diagram.json').get_by_role('button', name='Tải tệp', exact=True).click()
                require(pathlib.Path(native_download.value.path()).read_bytes() == diagram_bytes,
                        'Native diagram bytes changed across PostgreSQL and the second browser')
                passed('the same learner restores progress and lab work on another browser/device')

                stage = 'same-browser logout clears prior lab tabs and preserves saved work'
                account_tab = page_for(learner_session)
                ui_login(account_tab, student_a)
                guest_writes = []
                guest_guard = {'active': False}

                def track_guest_writes(request):
                    if (guest_guard['active'] and request.method == 'PUT'
                            and urllib.parse.urlsplit(request.url).path.endswith('/v1/learner-state')):
                        guest_writes.append('unexpected guest snapshot write')

                learner_session.on('request', track_guest_writes)
                with account_tab.expect_response(lambda response: response.request.method == 'POST'
                        and response.url == api_url + '/v1/auth/logout-current') as capture:
                    account_tab.locator('#account-logout').click()
                require(capture.value.status in (200, 201), 'Current-device logout failed')
                expect(account_tab.locator('#account-signed-in')).to_be_hidden()
                expect(learner.locator('#labWorkSignInNotice')).to_be_visible()
                expect(learner.locator('#labWorkSignIn')).to_have_attribute('href', 'account.html')
                expect(learner.locator('#labWorkSave')).to_be_hidden()
                expect(learner.locator('#labWorkSave')).to_be_disabled()
                expect(learner.locator('#labWorkCode')).to_have_value('')
                expect(learner.locator('#labWorkNotes')).to_have_value('')
                expect(learner.locator('#labWorkFileList li')).to_have_count(0)
                expect(learner.locator('#journal')).to_have_value('')
                guest_guard['active'] = True
                # Wait beyond workspace autosave debounce; no guest/background save may run.
                learner.wait_for_timeout(900)
                require(not guest_writes, 'A signed-out browser tab dispatched a late learner snapshot write')

                # Ordinary logout clears this browser's tabs, not an independent device session.
                expect(learner_again.locator('#labWorkSave')).to_be_enabled()
                own_after_logout = api.call('/v1/learner-state', token=token_a_second_device)
                after_state = json.loads(own_after_logout['values'].get('strobot.original.course.v3', '{}'))
                after_record = after_state.get('arduino', {}).get('led', {})
                require(after_record.get('note') == note_a and after_record.get('done') is True
                        and after_record.get('labWork', {}).get('wokwi', {}).get('code') == lab_code
                        and after_record.get('labWork', {}).get('wokwi', {}).get('notes') == lab_notes,
                        'Ordinary logout changed account-owned server work')
                learner_again.locator('#labWorkSave').click()
                expect(learner_again.locator('#labWorkStatus')).to_contain_text('Đã đồng bộ')
                require(not guest_writes, 'A guest tab wrote account-owned work before relogin')
                guest_guard['active'] = False
                learner_session.remove_listener('request', track_guest_writes)
                ui_login(learner, student_a)
                learner.goto(course_url, wait_until='domcontentloaded')
                expect(learner.locator('#main')).to_have_attribute('aria-busy', 'false')
                learner.locator('#tabBtnLab').click()
                expect(learner.locator('#labWorkSave')).to_be_enabled()
                expect(learner.locator('#labWorkCode')).to_have_value(lab_code)
                expect(learner.locator('#labWorkNotes')).to_have_value(lab_notes)
                expect(learner.locator('#journal')).to_have_value(note_a)
                passed('same-browser logout clears lab tabs while another device and saved account work stay usable')

                stage = 'separate student isolation'
                second = api.call('/v1/users/students', method='POST', status=(200, 201), token=admin_token, body=student_b)
                learner_b = page_for(context('198.51.100.40'))
                login_b = ui_login(learner_b, student_b)
                token_b = login_b['tokens']['accessToken']
                expect(learner_b.locator('#account-student-content [data-course-id="arduino"] progress')).to_have_attribute('value', '0')
                own_b = api.call('/v1/learner-state', token=token_b)
                require(note_a not in json.dumps(own_b) and lab_code not in json.dumps(own_b),
                        'Another student can read the first learner snapshot')
                learner_b.goto(course_url, wait_until='domcontentloaded')
                expect(learner_b.locator('#main')).to_have_attribute('aria-busy', 'false')
                learner_b.locator('#tabBtnLab').click()
                expect(learner_b.locator('#labWorkSave')).to_be_enabled()
                expect(learner_b.locator('#labWorkCode')).to_have_value('')
                expect(learner_b.locator('#labWorkNotes')).to_have_value('')
                expect(learner_b.locator('#labWorkFileList li')).to_have_count(0)
                api.call('/v1/users/' + second['id'] + '/approve-student', method='POST', token=token_b, status=403)
                passed('a separate student account cannot read or approve another learner workspace')

                stage = 'administrator private activity summaries'
                overview = api.call('/v1/users/student-overview?status=all&page=1&limit=20', token=admin_token)
                assert_private_aggregate(overview)
                row_a = next(item for item in rows_of(overview) if item['id'] == student_id)
                require(row_a['progressSummary']['source'] == 'learner-self-report'
                        and row_a['progressSummary']['completed'] == 1 and row_a['lastLearningAt'],
                        'Administrator cannot see completed practice and cross-device activity metadata')
                require(row_a['lastLoginAt'], 'Administrator overview lacks a login timestamp')
                admin.locator('[data-student-filter="all"]').click()
                learner_row = admin.locator('#account-management-content tbody tr').filter(has_text=student_a['email'])
                expect(learner_row).to_contain_text('1/30')
                require(note_a not in admin.locator('#account-management-content').inner_text()
                        and lab_code not in admin.locator('#account-management-content').inner_text(),
                        'Administrator UI exposed private learner work')
                require(not any(event['method'] == 'POST' and event['path'].endswith('/ai/agent/chat') for event in events),
                        'UI unexpectedly dispatched provider generation')
                for private in private_values:
                    if isinstance(private, str) and private:
                        require(private not in (directory / 'api.private.log').read_text(errors='replace'),
                                'Backend logs exposed fixture credential material')
                passed('administrator sees login/activity summaries without private work or credentials')
                browser.close()
            stage = 'complete'
        except Exception as error:
            # Raw browser/subprocess errors may include private field values.
            args.output.write_text(json.dumps({'status': 'failed', 'stage': stage,
                'errorType': type(error).__name__,
                'frames': [{'file': pathlib.Path(frame.filename).name, 'line': frame.lineno,
                            'function': frame.name} for frame in traceback.extract_tb(error.__traceback__)],
                'results': results}, indent=2) + '\n')
            raise
        finally:
            for process in reversed(processes):
                process.stop()
            if created:
                database_operation('drop')
    report = {'status': 'passed', 'results': results, 'providerGenerationRequests': 0,
              'elapsedSeconds': round(time.monotonic() - started, 2)}
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('FAIL', type(error).__name__, '(private details withheld; inspect the named stage in the result report)', flush=True)
        raise SystemExit(1)
