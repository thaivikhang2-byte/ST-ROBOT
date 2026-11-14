#!/usr/bin/env python3
"""Exercise real account/database integration against disposable local services.

Start the frontend and the Nest API with MAIL_PROVIDER=file, then run:
  python3 tests/account-fullstack-smoke.py --base http://127.0.0.1:5500 \
    --api http://127.0.0.1:3000/api --outbox /tmp/strobot-test-mail

Creates unique fixture accounts; never reads application .env files or calls AI
providers. API endpoint configuration is replaced only inside browser routing.
Use a disposable database. Reports contain assertions, not account credentials.
"""
import argparse
import json
import os
import pathlib
import re
import secrets
import subprocess
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request

from playwright.sync_api import expect, sync_playwright


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def eventually(callback, message, timeout=25, page=None):
    deadline = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < deadline:
        try:
            value = callback()
            if value:
                return value
        except Exception as error:
            last_error = type(error).__name__
        # Sync Playwright dispatches intercepted requests while its API loop is
        # running. Pure urllib polling plus time.sleep would leave the browser's
        # routed autosave request paused and falsely report a database failure.
        if page is not None:
            page.wait_for_timeout(150)
        else:
            time.sleep(0.15)
    raise AssertionError(message + (" (" + last_error + ")" if last_error else ""))


class LocalApi:
    def __init__(self, base):
        self.base = base.rstrip('/')

    def call(self, path, *, method='GET', body=None, token=None, status=200):
        headers = {'Accept': 'application/json'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        if body is not None:
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(self.base + path,
            data=None if body is None else json.dumps(body).encode(),
            headers=headers, method=method)
        # Tests target loopback; do not send fixture bearer tokens to a proxy.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            response = opener.open(request, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        actual = response.status
        payload = json.loads(response.read())
        accepted = status if isinstance(status, tuple) else (status,)
        require(actual in accepted,
            f'{method} {path.split("?", 1)[0]} returned HTTP {actual}, expected {accepted}')
        if actual < 400:
            require(payload.get('success') is True and 'data' in payload,
                    'API did not return the standard success envelope')
            return payload['data']
        return payload


def verification_token(outbox, email):
    def find():
        for file in sorted(outbox.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True):
            mail = json.loads(file.read_text())
            if mail.get('to') != email or 'verify' not in mail.get('subject', '').lower():
                continue
            match = re.search(r'Single-use token:\s*([a-f0-9]{64})', mail.get('text', ''))
            if match:
                return match.group(1)
        return None
    return eventually(find, 'No verification mail for fixture account')


def fill_form(page, selector, values):
    form = page.locator(selector)
    for name, value in values.items():
        form.locator('[name="' + name + '"]').fill(value)
    form.locator('button[type="submit"]').click()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:5500')
    parser.add_argument('--api', default='http://127.0.0.1:3000/api')
    parser.add_argument('--outbox', required=True, type=pathlib.Path)
    parser.add_argument('--chromium', default='/usr/bin/chromium')
    parser.add_argument('--output', default='/tmp/strobot-account-fullstack-results.json')
    parser.add_argument('--fixture-state', default='/tmp/strobot-account-fullstack-fixture.private.json',
                        help='Private disposable fixture checkpoint for diagnosing/resuming failed local runs')
    parser.add_argument('--resume-fixture', action='store_true',
                        help='Reuse credentials from the private checkpoint instead of creating another account')
    parser.add_argument('--manager-only', action='store_true',
                        help='Verify manager UI using the existing private fixture checkpoint')
    parser.add_argument('--fixture-db-env', type=pathlib.Path,
                        help='Optional private NODE_ENV=test database config for temporary manager fixture authority')
    args = parser.parse_args()
    require(not args.manager_only or (args.resume_fixture and args.fixture_db_env),
            'Manager-only verification requires the disposable fixture checkpoint and database config')
    for candidate in [args.base, args.api]:
        require(urllib.parse.urlsplit(candidate).hostname in ['localhost', '127.0.0.1', '::1'],
                'This test only supports disposable loopback services')
    base = args.base.rstrip('/')
    public = base + '/frontend/public/'
    api = LocalApi(args.api)
    run_id = secrets.token_hex(6)
    password = 'Fixture-' + secrets.token_urlsafe(18)
    email_a = 'sync-a-' + run_id + '@example.test'
    email_b = 'sync-b-' + run_id + '@example.test'
    guest_note = 'Guest journal remains on this browser ' + run_id
    note_a = 'Account A journal, kept across devices ' + run_id
    note_b = 'Account B separate journal ' + run_id
    storage_key = 'strobot.original.course.v3'
    results, errors = [], []
    fixtures = {}
    api_events = []
    if args.resume_fixture:
        previous = json.loads(pathlib.Path(args.fixture_state).read_text())
        require(previous.get('api') == args.api and previous.get('base') == base,
                'Fixture checkpoint belongs to a different test deployment')
        run_id, password = previous['runId'], previous['password']
        email_a, email_b = previous['emailA'], previous['emailB']
        guest_note = 'Guest journal remains on this browser ' + run_id
        note_a = 'Account A journal, kept across devices ' + run_id
        note_b = 'Account B separate journal ' + run_id
        fixtures.update(previous.get('fixtures', {}))

    def checkpoint():
        path = pathlib.Path(args.fixture_state)
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, 'w') as file:
            json.dump({'base': base, 'api': args.api, 'runId': run_id, 'password': password,
                       'emailA': email_a, 'emailB': email_b, 'fixtures': fixtures}, file)

    def checked(name, callback):
        if args.manager_only and name != 'temporary manager fixture sees scoped summaries without private journals':
            return
        before = len(errors)
        callback()
        checkpoint()
        require(len(errors) == before, 'Uncaught browser error: ' + '; '.join(errors[before:]))
        results.append({'name': name, 'status': 'passed'})
        print('PASS', name, flush=True)

    def account_module(page, code, argument=None):
        return page.evaluate('''async ({code, argument}) => {
            const {accountService} = await import(new URL('../src/services/AccountService.js', location.href));
            await accountService.ready();
            return await (new Function('accountService', 'argument', 'return (async () => {' + code + '})()'))(accountService, argument);
        }''', {'code': code, 'argument': argument})

    def wait_user(page, email):
        eventually(lambda: page.evaluate('''async email => {
            const {accountService} = await import(new URL('../src/services/AccountService.js', location.href));
            await accountService.ready(); return accountService.user?.email === email;
        }''', email), 'Browser did not authenticate the expected fixture account')
        expect(page.locator('#account-signed-in')).to_be_visible()

    def open_lesson(page):
        page.goto(public + 'course.learning.html?course=arduino&lesson=led', wait_until='domcontentloaded')
        expect(page.locator('#main')).to_have_attribute('aria-busy', 'false')
        page.locator('#tabBtnLab').click()
        details = page.locator('#journal').locator('xpath=ancestor::details[1]')
        if details.get_attribute('open') is None:
            details.locator(':scope > summary').click()

    def server_note(token):
        state = api.call('/v1/learner-state', token=token)
        raw = state['values'].get(storage_key, '{}')
        return json.loads(raw).get('arduino', {}).get('led', {}).get('note', '')

    def manager_fixture(assignment_id=None):
        """Operator-only fixture setup, never an application privilege endpoint."""
        require(args.fixture_db_env is not None, 'Disposable manager fixture database config required')
        payload = {'config': str(args.fixture_db_env.resolve()), 'userId': fixtures['a_id'],
                   'email': email_a, 'assignmentId': assignment_id}
        setup = r'''
const fs = require('node:fs');
const {PrismaClient} = require('./dist/database/client');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const cfg = JSON.parse(fs.readFileSync(input.config, 'utf8'));
const target = new URL(cfg.DATABASE_URL || '');
if (cfg.NODE_ENV !== 'test' || !['localhost','127.0.0.1','[::1]'].includes(target.hostname)
    || !target.pathname.endsWith('_test') || !/^sync-a-[a-f0-9]+@example\.test$/.test(input.email))
  throw new Error('Disposable local fixture database required');
Object.assign(process.env, cfg);
const db = new PrismaClient();
(async () => {
  const result = await db.$transaction(async tx => {
    const user = await tx.user.findUniqueOrThrow({where:{id:input.userId}});
    if (user.email !== input.email || !user.is_email_verified || !user.rbac_migrated)
      throw new Error('Unexpected fixture user');
    const role = await tx.role.findUniqueOrThrow({where:{name:'superadmin'}});
    if (!role.is_active || role.group !== 'MANAGER') throw new Error('Fixture role unavailable');
    let id = input.assignmentId;
    if (id) {
      const assignment = await tx.userRoleAssignment.findUniqueOrThrow({where:{id}});
      if (assignment.user_id !== user.id || assignment.role_id !== role.id)
        throw new Error('Fixture assignment mismatch');
      await tx.userRoleAssignment.update({where:{id},data:{revoked_at:new Date()}});
    } else {
      const assignment = await tx.userRoleAssignment.create({data:{user_id:user.id,role_id:role.id,
        scope_type:'SYSTEM',scope_id:''}});
      id = assignment.id;
    }
    await tx.authorizationState.update({where:{id:'default'},data:{version:{increment:1}}});
    await tx.auditLog.create({data:{user_id:user.id,resource:'identity',resource_id:user.id,
      action:input.assignmentId?'test.fixture.manager_revoked':'test.fixture.manager_granted'}});
    return {assignmentId:id};
  });
  console.log(JSON.stringify(result));
})().catch(() => {process.exitCode=1}).finally(() => db.$disconnect());
'''
        backend = pathlib.Path(__file__).resolve().parents[1] / 'backend'
        result = subprocess.run(['node', '-e', setup], input=json.dumps(payload),
                                text=True, capture_output=True, cwd=backend, timeout=30)
        require(result.returncode == 0, 'Disposable manager fixture authority setup failed')
        return json.loads(result.stdout)['assignmentId']

    try:
        api.call('/v1/learner-state', status=401)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=args.chromium,
                headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
            allowed = {urllib.parse.urlsplit(base).netloc, urllib.parse.urlsplit(args.api).netloc}

            def create_context(viewport=None, configured=True):
                context = browser.new_context(viewport=viewport or {'width': 1440, 'height': 1000},
                                              accept_downloads=True)
                def route_request(route):
                    url = urllib.parse.urlsplit(route.request.url)
                    if url.netloc == urllib.parse.urlsplit(base).netloc and url.path.endswith('/src/config/backend.config.js'):
                        config = json.dumps(args.api.rstrip('/') if configured else '')
                        route.fulfill(status=200, content_type='text/javascript', body=
                            'export const BACKEND_CONFIG = Object.freeze({apiBaseUrl:' + config + '});'
                            'export function resolveBackendUrl(){return BACKEND_CONFIG.apiBaseUrl;}')
                    elif url.netloc in allowed:
                        route.continue_()
                    elif url.scheme in ['http', 'https']:
                        # No simulators, trackers, paid AI, or external services during this test.
                        route.fulfill(status=200, content_type='text/html', body='<html><body>Local test</body></html>')
                    else:
                        route.continue_()
                context.route('**/*', route_request)
                context.on('response', lambda response: api_events.append({
                    'method': response.request.method,
                    'path': urllib.parse.urlsplit(response.url).path,
                    'status': response.status,
                }) if urllib.parse.urlsplit(response.url).netloc == urllib.parse.urlsplit(args.api).netloc else None)
                return context

            context = create_context()
            page = context.new_page()
            page.set_default_timeout(15000)
            page.on('pageerror', lambda error: errors.append(str(error)))

            def unconfigured_frontend():
                isolated = create_context({'width': 390, 'height': 844}, configured=False)
                offline = isolated.new_page()
                offline.set_default_timeout(15000)
                offline.on('pageerror', lambda error: errors.append(str(error)))
                offline.goto(public + 'account.html', wait_until='domcontentloaded')
                expect(offline.locator('#account-server-status')).to_contain_text('chưa được mở')
                expect(offline.locator('#account-login button[type="submit"]')).to_be_disabled()
                open_lesson(offline)
                offline.locator('#journal').fill('Offline guest fixture')
                offline.reload(wait_until='domcontentloaded')
                expect(offline.locator('#main')).to_have_attribute('aria-busy', 'false')
                expect(offline.locator('#journal')).to_have_value('Offline guest fixture')
                isolated.close()
            checked('unconfigured backend leaves guest learning functional', unconfigured_frontend)

            def register_verify():
                page.goto(public + 'account.html', wait_until='domcontentloaded')
                page.evaluate('''({key, note}) => localStorage.setItem(key, JSON.stringify({
                    last:'arduino', arduino:{led:{note, choice:null, done:false}}
                }))''', {'key': storage_key, 'note': guest_note})
                checkpoint()
                if args.resume_fixture:
                    fill_form(page, '#account-login', {'email': email_a, 'password': password})
                else:
                    page.locator('[data-auth-mode="register"]').click()
                    fill_form(page, '#account-register', {'email': email_a, 'password': password,
                        'firstName': 'Fixture', 'lastName': 'Learner A'})
                wait_user(page, email_a)
                # Permissioned writes must not bypass verification.
                already_verified = account_module(page, 'return accountService.user?.isEmailVerified === true;')
                if not already_verified:
                    result = account_module(page, '''try {
                        await accountService.request('/v1/learner-state', {method:'PUT', body:{revision:0,values:{}}});
                        return 0;
                    } catch(error) { return error.status; }''')
                    require(result == 403, 'Unverified account could write learner state')
                    page.locator('#account-show-verify').click()
                    fill_form(page, '#account-resend', {'email': email_a})
                    token = verification_token(args.outbox, email_a)
                    fill_form(page, '#account-verify', {'token': token})
                eventually(lambda: page.evaluate('''async () => {
                    const {accountService} = await import(new URL('../src/services/AccountService.js', location.href));
                    return accountService.user?.isEmailVerified === true;
                }'''), 'Browser profile did not become verified')
                login = api.call('/v1/auth/login', method='POST', body={'email': email_a, 'password': password})
                fixtures['a_token'] = login['tokens']['accessToken']
                fixtures['a_id'] = login['user']['id']
                state = api.call('/v1/learner-state', token=fixtures['a_token'])
                if not args.resume_fixture:
                    require(storage_key not in state['values'], 'Guest journal was automatically attached to a new account')
                require(page.evaluate('key => localStorage.getItem(key)', storage_key).find(guest_note) >= 0,
                        'Guest journal was destroyed at registration')
                # Tokens may be retained for this tab, never inside learner snapshots/localStorage.
                require(page.evaluate('''() => !Object.keys(localStorage).some(k => {
                    const v=localStorage.getItem(k)||''; return v.includes('refreshToken') || v.includes('accessToken');
                })'''), 'Account token was persisted in localStorage')
                page.set_viewport_size({'width': 1024, 'height': 900})
                require(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),
                        'Account navigation overflows at a 1024px desktop width')
                page.set_viewport_size({'width': 1440, 'height': 1000})
            checked('registration, email verification and explicit guest separation', register_verify)

            def save_account_a():
                open_lesson(page)
                expect(page.locator('#journal')).to_have_value('')
                page.locator('#journal').fill(note_a)
                eventually(lambda: server_note(fixtures['a_token']) == note_a,
                           'Journal did not reach the database', page=page)
                page.reload(wait_until='domcontentloaded')
                expect(page.locator('#main')).to_have_attribute('aria-busy', 'false')
                expect(page.locator('#journal')).to_have_value(note_a)
                page.goto(public + 'account.html', wait_until='domcontentloaded')
                wait_user(page, email_a)
                api.call('/v1/admin/dashboard', token=fixtures['a_token'], status=403)
                api.call('/v1/learner-state/management', token=fixtures['a_token'], status=403)
                page.locator('#account-logout').click()
                expect(page.locator('#account-signed-in')).to_be_hidden()
                open_lesson(page)
                expect(page.locator('#journal')).to_have_value(guest_note)
            checked('journal database persistence, refresh, logout and manager access guard', save_account_a)

            def second_account():
                registered = api.call('/v1/auth/register', method='POST', status=(200, 201), body={
                    'email': email_b, 'password': password, 'firstName': 'Fixture', 'lastName': 'Learner B'})
                fixtures['b_id'] = registered['user']['id']
                api.call('/v1/auth/resend-verification', method='POST', status=(200, 201), body={'email': email_b})
                api.call('/v1/auth/verify-email', method='POST', status=(200, 201),
                         body={'token': verification_token(args.outbox, email_b)})
                login = api.call('/v1/auth/login', method='POST', body={'email': email_b, 'password': password})
                fixtures['b_token'] = login['tokens']['accessToken']
                page.goto(public + 'account.html', wait_until='domcontentloaded')
                fill_form(page, '#account-login', {'email': email_b, 'password': password})
                wait_user(page, email_b)
                open_lesson(page)
                expect(page.locator('#journal')).to_have_value('')
                page.locator('#journal').fill(note_b)
                eventually(lambda: server_note(fixtures['b_token']) == note_b,
                           'Second account journal did not synchronize', page=page)
                require(server_note(fixtures['a_token']) == note_a, 'Second account changed the first account journal')
                page.goto(public + 'account.html', wait_until='domcontentloaded')
                wait_user(page, email_b)
                page.locator('#account-logout').click()
                expect(page.locator('#account-signed-in')).to_be_hidden()
                fill_form(page, '#account-login', {'email': email_a, 'password': password})
                wait_user(page, email_a)
                open_lesson(page)
                expect(page.locator('#journal')).to_have_value(note_a)
            checked('account switching isolates journals and restores each owner', second_account)

            def other_device():
                other = create_context({'width': 390, 'height': 844})
                mobile = other.new_page()
                mobile.set_default_timeout(15000)
                mobile.on('pageerror', lambda error: errors.append(str(error)))
                mobile.goto(public + 'account.html', wait_until='domcontentloaded')
                fill_form(mobile, '#account-login', {'email': email_a, 'password': password})
                wait_user(mobile, email_a)
                require(mobile.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),
                        'Mobile account page overflows horizontally')
                open_lesson(mobile)
                expect(mobile.locator('#journal')).to_have_value(note_a)
                other.close()
            checked('fresh mobile browser loads the same account journal', other_device)

            def api_revisions():
                token = fixtures['a_token']
                state = api.call('/v1/learner-state', token=token)
                saved = api.call('/v1/learner-state', method='PUT', token=token,
                    body={'revision': state['revision'], 'values': state['values']})
                require(saved['revision'] == state['revision'] + 1, 'Revision did not increment')
                api.call('/v1/learner-state', method='PUT', token=token, status=409,
                    body={'revision': state['revision'], 'values': state['values']})
                api.call('/v1/learner-state', method='PUT', token=token, status=400,
                    body={'revision': saved['revision'], 'values': {}, 'userId': fixtures['b_id']})
                api.call('/v1/learner-state', method='PUT', token=token, status=400,
                    body={'revision': saved['revision'], 'values': {'strobot.account.session.v1': 'private'}})
                require(server_note(fixtures['b_token']) == note_b, 'Rejected owner override affected another account')
                # No provider calls: this route reports only local configuration.
                agent = api.call('/v1/ai/agent/status?mode=EDUCATIONAL', token=token)
                require(isinstance(agent, dict), 'Agent configuration status is not a structured response')
            checked('optimistic revisions, allowlist, owner isolation and local agent status', api_revisions)

            def conflict_resolution():
                # The API fixture advanced the revision while this editor retained
                # its prior snapshot. A local edit must not overwrite that newer copy.
                draft_note = 'Unsent conflicting draft ' + run_id
                page.locator('#journal').fill(draft_note)
                eventually(lambda: page.evaluate('''async () => {
                    const {learnerSync} = await import(new URL('../src/services/LearnerSyncService.js', location.href));
                    return learnerSync.status.conflict === true;
                }'''), 'Stale editor did not expose its conflict state')
                require(server_note(fixtures['a_token']) == note_a,
                        'A stale editor silently overwrote the newer server revision')
                expect(page.locator('#journal')).to_have_value(draft_note)
                page.goto(public + 'account.html', wait_until='domcontentloaded')
                wait_user(page, email_a)
                expect(page.locator('#account-sync-export')).to_be_visible()
                expect(page.locator('#account-sync-use-server')).to_be_visible()
                page.once('dialog', lambda dialog: dialog.accept())
                page.locator('#account-sync-use-server').click()
                eventually(lambda: page.evaluate('''async () => {
                    const {learnerSync} = await import(new URL('../src/services/LearnerSyncService.js', location.href));
                    return learnerSync.status.status === 'synced';
                }'''), 'Explicit server-copy selection did not resolve the conflict')
                open_lesson(page)
                expect(page.locator('#journal')).to_have_value(note_a)
                require(server_note(fixtures['b_token']) == note_b,
                        'Conflict resolution changed a different learner account')
            checked('stale editor keeps its draft and requires explicit conflict resolution', conflict_resolution)

            if args.fixture_db_env:
                def manager_ui():
                    assignment = manager_fixture()
                    try:
                        page.goto(public + 'account.html', wait_until='domcontentloaded')
                        if args.manager_only:
                            fill_form(page, '#account-login', {'email': email_a, 'password': password})
                        wait_user(page, email_a)
                        account_module(page, 'await accountService.reloadProfile(); return true;')
                        expect(page.locator('#account-management')).to_be_visible()
                        expect(page.locator('#account-management-content .account-metrics')).to_be_visible()
                        page.locator('[data-management-mode="learning"]').click()
                        expect(page.locator('#account-management-content')).to_contain_text('Dữ liệu người học tự báo cáo')
                        expect(page.locator('#account-management-content table tbody tr').first).to_be_visible()
                        content = page.locator('#account-management-content').inner_text()
                        require(note_a not in content and note_b not in content,
                                'Manager summary exposed private journal text')
                        summaries = account_module(page,
                            'return await accountService.request("/v1/learner-state/management?limit=100");')
                        rows = summaries if isinstance(summaries, list) else summaries.get('data')
                        require(isinstance(rows, list), 'Manager summaries did not contain real rows')
                        own = next((row for row in rows if row['userId'] == fixtures['a_id']), None)
                        require(own is not None and own['source'] == 'learner-self-report',
                                'Manager did not see the actual synchronized fixture snapshot')
                        require('values' not in own and 'journal' not in own,
                                'Manager response exposed a raw learner snapshot')
                        page.locator('[data-management-mode="users"]').click()
                        expect(page.locator('#account-management-content table')).to_be_visible()
                        page.locator('[data-management-mode="audit"]').click()
                        expect(page.locator('#account-management-content table')).to_be_visible()
                        page.set_viewport_size({'width': 390, 'height': 844})
                        require(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),
                                'Manager page overflows on a phone')
                    finally:
                        manager_fixture(assignment)
                    account_module(page, 'await accountService.reloadProfile(); return true;')
                    expect(page.locator('#account-management')).to_be_hidden()
                    result = account_module(page, '''try {
                        await accountService.request('/v1/learner-state/management'); return 0;
                    } catch(error) {return error.status;}''')
                    require(result == 403, 'Revoked manager authority remained usable')
                checked('temporary manager fixture sees scoped summaries without private journals', manager_ui)

            require(not errors, 'Unexpected browser errors occurred')
            browser.close()
        report = {'status': 'passed', 'results': results, 'browserErrors': errors, 'apiEvents': api_events,
                  'externalServices': 'blocked; no paid AI calls'}
        pathlib.Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print('PASS all account full-stack checks', flush=True)
        return 0
    except Exception as error:
        checkpoint()
        report = {'status': 'failed', 'results': results, 'browserErrors': errors, 'apiEvents': api_events,
                  'failure': str(error), 'failureType': type(error).__name__}
        pathlib.Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print('FAIL', type(error).__name__, str(error), flush=True)
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
