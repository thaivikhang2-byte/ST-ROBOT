#!/usr/bin/env python3
"""Login UX stays unchanged without public timing controls. APIs are local fixtures."""
import argparse
import json
import os
import urllib.parse
from playwright.sync_api import expect, sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:5519')
    parser.add_argument('--chromium', default='/usr/bin/chromium' if os.path.exists('/usr/bin/chromium') else None)
    args = parser.parse_args()
    base = args.base.rstrip('/')
    assert urllib.parse.urlsplit(base).hostname in ['127.0.0.1', 'localhost']
    api = 'http://127.0.0.1:5997/api'
    secret_values = ['fixture-person@example.test', 'Fixture-Secret-Password', 'fixture-secret-access', 'fixture-secret-refresh', 'fixture-private-owner', 'fixture-private-name']
    profile = {'id': secret_values[4], 'email': secret_values[0], 'firstName': secret_values[5], 'isEmailVerified': True, 'permissions': ['learning:read', 'learning:update'], 'roles': [{'group': 'STUDENT', 'scopeType': 'SELF'}]}
    auth = {'user': profile, 'tokens': {'accessToken': secret_values[2], 'refreshToken': secret_values[3], 'expiresIn': 900}}
    request_id = '123e4567-e89b-42d3-a456-426614174000'
    # Emulate the pre-timing public module contract without requiring old Git
    # history in a shallow CI checkout. The real service still performs auth.
    legacy_service = '''
        import * as impl from './AccountService.js?timing-implementation';
        export const AccountService = impl.AccountService;
        export const ACCOUNT_SESSION_KEY = impl.ACCOUNT_SESSION_KEY;
        export const ACCOUNT_CONNECTION_KEY = impl.ACCOUNT_CONNECTION_KEY;
        export const ACCOUNT_CONNECTION_EVENT = impl.ACCOUNT_CONNECTION_EVENT;
        export const ACCOUNT_LOGOUT_CHANNEL = impl.ACCOUNT_LOGOUT_CHANNEL;
        export const accountService = new Proxy(impl.accountService, {
            get(target, key) {
                if (['loginTiming','getLoginTimingReport','subscribeLoginTiming'].includes(key)) return undefined;
                const value = Reflect.get(target, key);
                return typeof value === 'function' ? value.bind(target) : value;
            }
        });
    '''
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])

        def fixture(mode='fast', debug=False, legacy=False):
            context = browser.new_context(viewport={'width': 390, 'height': 844})
            page = context.new_page()
            page.clock.install()
            errors, requests, health, logins = [], [], [], []
            state = {'mode': mode}
            page.on('pageerror', lambda error: errors.append(str(error)))
            cors = {'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS'}

            def respond(route, data, status=200, identifier=request_id):
                body = {'success': status < 400, 'data': data, 'meta': {'requestId': identifier},
                        'message': ' '.join(secret_values), 'error': {'code': secret_values[0]}}
                route.fulfill(status=status, content_type='application/json', headers=cors, body=json.dumps(body))

            def handle(route):
                request = route.request
                url = urllib.parse.urlsplit(request.url)
                if url.path.endswith('/src/config/backend.config.js'):
                    route.fulfill(status=200, content_type='text/javascript', body='export const BACKEND_CONFIG={apiBaseUrl:' + json.dumps(api) + '};export function resolveBackendUrl(){return BACKEND_CONFIG.apiBaseUrl;}')
                    return
                if legacy and url.path.endswith('/src/services/AccountService.js') and url.query != 'timing-implementation':
                    route.fulfill(status=200, content_type='text/javascript', body=legacy_service)
                    return
                if url.netloc != '127.0.0.1:5997':
                    if url.netloc == urllib.parse.urlsplit(base).netloc:
                        route.continue_()
                    else:
                        route.fulfill(status=200, content_type='text/html', body='<p>External calls blocked</p>')
                    return
                if request.method == 'OPTIONS':
                    route.fulfill(status=204, headers=cors)
                    return
                path = url.path.removeprefix('/api')
                requests.append((request.method, path))
                if path == '/system/health/live':
                    if state['mode'] == 'slow-connection':
                        health.append(route)
                    else:
                        respond(route, {'status': 'ok'})
                elif path == '/v1/auth/options':
                    respond(route, {'registrationEnabled': False, 'approvalRegistrationEnabled': True, 'emailDeliveryEnabled': False, 'managedAccountsEnabled': True})
                elif path == '/v1/auth/login':
                    if state['mode'] == 'slow-auth':
                        logins.append(route)
                    elif state['mode'] in ['error', 'bad-password']:
                        respond(route, None, 503 if state['mode'] == 'error' else 401, secret_values[0])
                    else:
                        respond(route, auth)
                elif path == '/v1/learner-state':
                    respond(route, {'revision': 0, 'values': {}, 'updatedAt': None})
                else:
                    respond(route, {})

            context.route('**/*', handle)
            page.goto(base + '/frontend/public/account.html' + ('?diagnostics=login' if debug else ''), wait_until='domcontentloaded')
            return context, page, errors, requests, health, logins, state, respond

        def submit(page):
            page.locator('#login-email').fill(secret_values[0])
            page.locator('#login-password').fill(secret_values[1])
            page.locator('#account-login button[type="submit"]').click()

        def no_diagnostics(page):
            expect(page.locator('[id^="account-login-diagnostics"]')).to_have_count(0)
            expect(page.get_by_text('Chi tiết thời gian đăng nhập', exact=True)).to_have_count(0)
            expect(page.get_by_text('Sao chép chi tiết', exact=True)).to_have_count(0)
            text = page.locator('body').inner_text()
            for field in ['clientBuild', 'authenticationMs', 'connectionMs', 'totalMs', 'timing-v1']:
                assert field not in text, field

        def close_fixture(context):
            context.unroute_all(behavior='wait')
            context.close()

        # Normal controls and feedback remain identical, including a stale debug URL.
        for mode, debug in [('fast', False), ('bad-password', False), ('error', False), ('fast', True), ('bad-password', True)]:
            context, page, errors, requests, *_ = fixture(mode, debug=debug)
            no_diagnostics(page)
            submit(page)
            if mode == 'fast':
                expect(page.locator('#account-signed-in')).to_be_visible()
            else:
                expect(page.locator('#account-message')).to_have_attribute('data-kind', 'error')
                expect(page.locator('#account-login button[type="submit"]')).to_have_text('Đăng nhập')
                expect(page.locator('#account-login button[type="submit"]')).to_be_enabled()
                expect(page.locator('[data-cancel-login]')).to_be_hidden()
            no_diagnostics(page)
            assert len([item for item in requests if item[1] == '/v1/auth/login']) == 1
            assert not errors, errors
            close_fixture(context)
        print('PASS fast login, password/server errors and stale debug URLs have no diagnostic UI', flush=True)

        for mode in ['slow-auth', 'slow-connection']:
            context, page, errors, requests, health, logins, state, respond = fixture(mode, debug=True)
            submit(page)
            expect(page.locator('#account-login button[type="submit"]')).to_have_text('Đang đăng nhập…')
            expect(page.locator('#account-login button[type="submit"]')).to_be_disabled()
            expect(page.locator('[data-cancel-login]')).to_be_visible()
            expect(page.locator('[data-cancel-login]')).to_be_enabled()
            if mode == 'slow-connection':
                expect(page.locator('#account-server-status')).to_contain_text('Đang kết nối')
            page.clock.fast_forward(8100)
            no_diagnostics(page)
            expect(page.locator('#account-login button[type="submit"]')).to_have_text('Đang đăng nhập…')
            if mode == 'slow-auth':
                assert logins
                respond(logins.pop(), auth)
            else:
                assert health and not logins
                state['mode'] = 'fast'
                respond(health.pop(), {'status': 'ok'})
            expect(page.locator('#account-signed-in')).to_be_visible()
            no_diagnostics(page)
            assert len([item for item in requests if item[1] == '/v1/auth/login']) == 1
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
            assert not errors, errors
            close_fixture(context)
        print('PASS clocked slow connection/authentication preserve existing form controls without reports', flush=True)

        context, page, errors, requests, health, logins, state, respond = fixture('slow-auth', debug=True)
        submit(page)
        expect(page.locator('[data-cancel-login]')).to_be_visible()
        page.clock.fast_forward(8100)
        no_diagnostics(page)
        page.locator('[data-cancel-login]').click()
        expect(page.locator('#account-message')).to_contain_text('Đã hủy chờ đăng nhập')
        expect(page.locator('#account-login button[type="submit"]')).to_have_text('Đăng nhập')
        expect(page.locator('#account-login button[type="submit"]')).to_be_enabled()
        expect(page.locator('[data-cancel-login]')).to_be_hidden()
        no_diagnostics(page)
        assert len([item for item in requests if item[1] == '/v1/auth/login']) == 1
        assert not errors, errors
        # Finish the intentionally held fixture route after browser cancellation.
        assert len(logins) == 1
        logins.pop().abort()
        close_fixture(context)
        print('PASS cancelling slow login restores the same controls and never reveals diagnostics', flush=True)

        context, page, errors, requests, *_ = fixture('fast', debug=True, legacy=True)
        submit(page)
        expect(page.locator('#account-signed-in')).to_be_visible()
        no_diagnostics(page)
        assert not errors, errors
        close_fixture(context)
        print('PASS cached older AccountService still logs in without diagnostic dependencies', flush=True)
        browser.close()


if __name__ == '__main__':
    main()
