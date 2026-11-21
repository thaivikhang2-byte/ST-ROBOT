#!/usr/bin/env python3
"""Check first-page controller loading in Chromium with loopback-only API fixtures."""
import argparse
import http.server
import json
import pathlib
import threading
import urllib.parse
from playwright.sync_api import expect, sync_playwright


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chromium', default='/usr/bin/chromium' if pathlib.Path('/usr/bin/chromium').exists() else None)
    parser.add_argument('--base', help='Existing loopback static server; otherwise a disposable server is started')
    parser.add_argument('--baseline-app', type=pathlib.Path, help='Optional earlier eager app.js for a decoded-byte comparison')
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parents[1]

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *values, **options):
            super().__init__(*values, directory=str(root), **options)

        def log_message(self, *_):
            pass

    server = None
    if args.base:
        base = args.base.rstrip('/')
        require(urllib.parse.urlsplit(base).hostname in ['localhost', '127.0.0.1'], 'Static fixture must use loopback')
    else:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = 'http://127.0.0.1:' + str(server.server_port)
    public = base + '/frontend/public/'
    baseline = args.baseline_app.read_text() if args.baseline_app else None
    measurements = {}
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=args.chromium, headless=True,
                args=['--no-sandbox', '--disable-dev-shm-usage'])

            def new_page(*, eager=False, restore=False):
                context = browser.new_context()
                if restore:
                    context.add_init_script("""sessionStorage.setItem('strobot.account.session.v1', JSON.stringify({
                        version: 1, baseUrl: 'http://localhost:3000/api', refreshToken: 'fixture-refresh',
                        profile: {id:'fixture-student',email:'fixture@example.test'}
                    }));""")
                page = context.new_page()
                errors, requests, pending = [], [], []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('request', lambda request: requests.append(urllib.parse.urlsplit(request.url).path))

                def api_response(route, data):
                    route.fulfill(status=200, content_type='application/json', headers={
                        'Access-Control-Allow-Origin': base,
                        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
                    }, body=json.dumps({'success': True, 'data': data}))

                def fixture(route):
                    address = urllib.parse.urlsplit(route.request.url)
                    if address.path.endswith('/src/app.js') and eager:
                        route.fulfill(status=200, content_type='text/javascript', body=baseline)
                    elif '/api/' in address.path:
                        if restore and address.path.endswith('/auth/refresh') and route.request.method == 'POST':
                            pending.append(route)
                            return
                        if address.path.endswith('/health/live'):
                            data = {'status': 'ok'}
                        elif address.path.endswith('/learner-state'):
                            data = {'revision': 0, 'values': {}, 'updatedAt': None}
                        else:
                            data = {'registrationEnabled': False, 'emailDeliveryEnabled': False, 'managedAccountsEnabled': True}
                        api_response(route, data)
                    elif address.hostname not in ['localhost', '127.0.0.1']:
                        route.abort()
                    else:
                        route.continue_()

                page.route('**/*', fixture)
                return context, page, errors, requests, pending, api_response

            def metrics(page):
                return page.evaluate("""() => {
                    const scripts=performance.getEntriesByType('resource').filter(item =>
                        item.initiatorType === 'script' && item.name.includes('/frontend/src/'));
                    return {modules:scripts.length,decodedBytes:scripts.reduce((sum,item)=>sum+item.decodedBodySize,0)};
                }""")

            # Account fallback still initializes Home, while unrelated route modules stay unloaded.
            for eager in ([True, False] if baseline else [False]):
                context, page, errors, requests, _, _ = new_page(eager=eager)
                page.goto(public + 'account.html', wait_until='networkidle')
                expect(page.locator('#account-login button[type="submit"]')).to_be_enabled()
                expect(page.locator('#accountNavAction')).to_be_visible()
                require(not errors, 'Account first-page JavaScript errors: ' + repr(errors))
                measurements['eagerAccount' if eager else 'lazyAccount'] = metrics(page)
                if not eager:
                    controllers = [path.rsplit('/', 1)[-1] for path in requests if path.endswith('Controller.js')]
                    require(controllers == ['HomeController.js'], 'Account must load only its existing Home fallback: ' + repr(controllers))
                context.close()

            # Each route initializes its visible controls and keeps every other controller unloaded.
            for filename, controller, selector in [
                ('index.html', 'HomeController.js', '#featuredCourses .course-card'),
                ('kit.html', 'KitController.js', '#kitList .kit-item'),
                ('hoclieu.html', 'CatalogController.js', '#catalogCoursesGrid .course-card'),
                ('dangky.html', 'DangKyController.js', '#startLessonTitle'),
                ('gioithieu.html', 'GioiThieuController.js', 'h1'),
                ('assessment.html', 'AssessmentController.js', '#assessmentCreateForm'),
            ]:
                context, page, errors, requests, _, _ = new_page()
                page.goto(public + filename, wait_until='networkidle')
                expect(page.locator(selector).first).to_be_visible()
                controllers = [path.rsplit('/', 1)[-1] for path in requests if path.endswith('Controller.js')]
                require(controllers == [controller], filename + ' loaded unexpected route controllers: ' + repr(controllers))
                require(not errors, filename + ' JavaScript errors: ' + repr(errors))
                if filename == 'hoclieu.html':
                    page.locator('#catalogSearch').fill('no-matching-fixture-course')
                    expect(page.locator('#catalogCount')).to_contain_text('0 khóa học')
                context.close()

            # Quiz module/initialization remains behind the confirmed owner workspace gate.
            context, page, errors, requests, pending, reply = new_page(restore=True)
            page.goto(public + 'quiz.html', wait_until='domcontentloaded')
            page.wait_for_function("document.querySelector('#accountNavAction') !== null")
            for _ in range(100):
                if pending:
                    break
                page.wait_for_timeout(20)
            require(bool(pending), 'Quiz owner refresh was not requested')
            require(not any(path.endswith('/QuizController.js') for path in requests), 'Quiz imported before owner restoration')
            expect(page.locator('#quizCourseSelect option')).to_have_count(1)
            reply(pending.pop(), {'tokens': {'accessToken': 'fixture-access', 'refreshToken': 'fixture-next-refresh'},
                'user': {'id': 'fixture-student', 'email': 'fixture@example.test', 'isEmailVerified': True, 'roles': [], 'permissions': ['learning:read']}})
            page.wait_for_function("document.querySelectorAll('#quizCourseSelect option').length > 1")
            controllers = [path.rsplit('/', 1)[-1] for path in requests if path.endswith('Controller.js')]
            require(controllers == ['QuizController.js'], 'Quiz loaded unrelated controllers: ' + repr(controllers))
            require(not errors, 'Quiz JavaScript errors: ' + repr(errors))
            context.close()
            if baseline:
                require(measurements['lazyAccount']['modules'] < measurements['eagerAccount']['modules'], 'Account did not reduce module requests')
                require(measurements['eagerAccount']['decodedBytes'] > measurements['lazyAccount']['decodedBytes'],
                    'Account did not avoid unused route JavaScript')
            print(json.dumps(measurements))
            browser.close()
    finally:
        if server:
            server.shutdown()
            server.server_close()
            thread.join()
    print('PASS first-page lazy route loading, existing fallback, interactive route controls and quiz owner restoration gate')


if __name__ == '__main__':
    main()
