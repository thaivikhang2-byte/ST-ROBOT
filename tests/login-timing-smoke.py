#!/usr/bin/env python3
"""Clocked login diagnosis UI checks. All account APIs are local fixtures."""
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
    fields = {'clientBuild', 'operation', 'outcome', 'stage', 'connectionMs', 'authenticationMs', 'clientMs', 'totalMs', 'httpStatus', 'errorCode', 'requestId'}

    def private_report(report):
        assert report['clientBuild'] == 'timing-v1' and report['operation'] == 'login'
        assert set(report) <= fields
        text = json.dumps(report)
        for value in secret_values + ['password', 'accessToken', 'refreshToken', 'Authorization', 'profile']:
            assert value not in text, value

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
            page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedLoginTiming=text;}}})")
            return context, page, errors, requests, health, logins, state, respond

        def submit(page):
            page.locator('#login-email').fill(secret_values[0])
            page.locator('#login-password').fill(secret_values[1])
            page.locator('#account-login button[type="submit"]').click()

        # No diagnostic controls appear for a normal fast login or password error.
        for mode in ['fast', 'bad-password']:
            context, page, errors, requests, *_ = fixture(mode)
            submit(page)
            if mode == 'fast':
                expect(page.locator('#account-signed-in')).to_be_visible()
            else:
                expect(page.locator('#account-message')).to_have_attribute('data-kind', 'error')
            expect(page.locator('#account-login-diagnostics')).to_be_hidden()
            assert len([item for item in requests if item[1] == '/v1/auth/login']) == 1
            assert not errors, errors
            context.close()
        print('PASS ordinary fast login and bad-password UX remain unchanged', flush=True)

        for mode in ['slow-auth', 'slow-connection']:
            context, page, errors, requests, health, logins, state, respond = fixture(mode)
            submit(page)
            if mode == 'slow-auth':
                expect(page.locator('#account-server-status')).to_contain_text('Đang xác thực')
            else:
                expect(page.locator('#account-server-status')).to_contain_text('Đang kết nối')
            page.clock.fast_forward(8100)
            details = page.locator('#account-login-diagnostics')
            expect(details).to_be_visible()
            assert details.get_attribute('open') is None
            details.locator(':scope > summary').click()
            active = json.loads(page.locator('#account-login-diagnostics-data').inner_text())
            private_report(active)
            assert active['stage'] == ('authentication' if mode == 'slow-auth' else 'connection')
            if mode == 'slow-auth':
                assert logins
                respond(logins.pop(), auth)
            else:
                assert health and not logins
                state['mode'] = 'fast'
                respond(health.pop(), {'status': 'ok'})
            expect(page.locator('#account-signed-in')).to_be_visible()
            expect(page.locator('#account-login-diagnostics-data')).to_contain_text('succeeded')
            before_copy = len(requests)
            page.locator('#account-login-diagnostics-copy').click()
            expect(page.locator('#account-login-diagnostics-status')).to_contain_text('Đã sao chép')
            copied = json.loads(page.evaluate('window.copiedLoginTiming'))
            private_report(copied)
            assert copied['requestId'] == request_id and copied['totalMs'] >= 8000
            assert copied['connectionMs' if mode == 'slow-connection' else 'authenticationMs'] >= 8000
            assert len(requests) == before_copy, 'copying timing must not make another request'
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
            assert not errors, errors
            context.close()
        print('PASS clocked slow connection/authentication remain distinct and copy only safe totals', flush=True)

        for mode in ['error', 'fast']:
            context, page, errors, requests, *_ = fixture(mode, debug=(mode == 'fast'))
            submit(page)
            expect(page.locator('#account-login-diagnostics')).to_be_visible()
            page.locator('#account-login-diagnostics > summary').click()
            page.locator('#account-login-diagnostics-copy').click()
            expect(page.locator('#account-login-diagnostics-status')).to_contain_text('Đã sao chép')
            copied = json.loads(page.evaluate('window.copiedLoginTiming'))
            private_report(copied)
            assert copied['outcome'] == ('failed' if mode == 'error' else 'succeeded')
            assert copied['errorCode'] == ('SERVER_ERROR' if mode == 'error' else None)
            if mode == 'error':
                assert 'requestId' not in copied
            assert not errors, errors
            context.close()
        print('PASS infrastructure failure and explicit diagnostics query enable safe reports', flush=True)

        context, page, errors, requests, *_ = fixture('fast', debug=True, legacy=True)
        submit(page)
        expect(page.locator('#account-signed-in')).to_be_visible()
        expect(page.locator('#account-login-diagnostics')).to_be_hidden()
        assert not errors, errors
        context.close()
        print('PASS cached older AccountService still logs in with diagnostics disabled', flush=True)
        browser.close()


if __name__ == '__main__':
    main()
