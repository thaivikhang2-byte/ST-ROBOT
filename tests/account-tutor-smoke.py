#!/usr/bin/env python3
"""Exercise lesson tutor routing with isolated browser/API fixtures; no AI calls."""
import argparse
import base64
import json
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base', default='http://127.0.0.1:5500')
parser.add_argument('--chromium', default='/usr/bin/chromium')
args = parser.parse_args()
base = args.base.rstrip('/')
api = 'https://account-tutor.fixture/api'
owner = '801c1c06-4236-4d99-9b02-234371f35755'
conversation = '6ff63b39-e413-40fb-ab4e-f27fb722381d'
user = {'id': owner, 'email': 'fixture@example.test', 'firstName': 'Fixture',
        'lastName': 'Learner', 'isEmailVerified': True, 'roles': [],
        'permissions': ['learning:read', 'learning:update', 'ai:chat']}
tokens = {'accessToken': 'fixture-access-only', 'refreshToken': 'fixture-refresh-only'}
saved = {'revision': 3, 'updatedAt': '2026-11-14T00:00:00.000Z', 'values': {
    'strobot.original.course.v3': json.dumps({'last': 'arduino', 'arduino': {
        'led': {'note': 'Existing own journal', 'done': False, 'choice': None}}})}}
agent_calls, vision_calls, errors = [], [], []
mode = {'error': False}
cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type'}


def require(value, message):
    if not value:
        raise AssertionError(message)


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.add_init_script('''if (location.origin === %s) sessionStorage.setItem('strobot.account.session.v1', JSON.stringify({
        version:1,baseUrl:%s,refreshToken:'fixture-refresh-only',profile:%s}));''' % (json.dumps(base), json.dumps(api), json.dumps(user)))

    def route_request(route):
        request = route.request
        parsed = urlsplit(request.url)
        origin = parsed.scheme + '://' + parsed.netloc
        if origin == base and parsed.path.endswith('/src/config/backend.config.js'):
            route.fulfill(content_type='text/javascript', body='export const BACKEND_CONFIG={apiBaseUrl:' + json.dumps(api) + '}; export function resolveBackendUrl(){return BACKEND_CONFIG.apiBaseUrl;}')
            return
        if origin == 'https://account-tutor.fixture':
            if request.method == 'OPTIONS':
                route.fulfill(status=204, headers=cors)
                return
            path = parsed.path.removeprefix('/api')
            status = 200
            if path == '/system/health/live':
                require(request.method == 'GET' and not request.headers.get('authorization') and not request.post_data,
                        'Connection check must not include account credentials')
                data = {'status': 'ok'}
            elif path == '/v1/auth/refresh':
                data = {'tokens': tokens}
            elif path == '/v1/auth/me':
                data = user
            elif path == '/v1/auth/logout-current':
                data = {'message': 'Session revoked'}
            elif path == '/v1/learner-state':
                if request.method == 'PUT':
                    body = request.post_data_json
                    require(body['revision'] == saved['revision'], 'Unexpected snapshot conflict in fixture')
                    saved.update(revision=saved['revision'] + 1, values=body['values'])
                data = saved
            elif path == '/v1/learner-state/activity':
                data = {'id': 'fixture-event'}
            elif path == '/v1/ai/agent/chat':
                body = request.post_data_json
                note = json.loads(saved['values']['strobot.original.course.v3'])['arduino']['led']['note']
                agent_calls.append({'body': body, 'savedNote': note})
                if mode['error']:
                    route.fulfill(status=503, content_type='application/json', headers=cors,
                        body=json.dumps({'success': False, 'message': 'Fixture provider not configured',
                            **({'error': {'code': mode['backendCode']}} if mode.get('backendCode') else {})}))
                    return
                data = {'message': 'AVR8js hợp thử LED; Wokwi phù hợp mạch có cảm biến.', 'conversationId': conversation,
                        'contextSources': {'source': 'postgresql-account', 'savedLearning': True, 'hasSnapshot': True,
                                           'snapshotRevision': saved['revision']}}
            else:
                raise AssertionError('Unexpected account API request: ' + path)
            route.fulfill(status=status, content_type='application/json', headers=cors, body=json.dumps({'success': True, 'data': data}))
        elif origin == 'https://st-robot-1.onrender.com':
            if request.method == 'OPTIONS':
                route.fulfill(status=204, headers=cors)
            elif parsed.path == '/health':
                route.fulfill(content_type='application/json', headers=cors, body='{"ok":true}')
            else:
                require(parsed.path == '/api/tutor', 'Unexpected public AI route')
                vision_calls.append({'body': request.post_data_json, 'headers': request.headers})
                route.fulfill(content_type='application/json', headers=cors, body=json.dumps({'reply': 'Ảnh đã gửi có một bàn thực hành.'}))
        elif origin == base:
            route.continue_()
        else:
            route.fulfill(content_type='text/html', body='<html><body>Fixture simulator</body></html>')

    context.route('**/*', route_request)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base + '/frontend/public/course.learning.html?course=arduino&lesson=led&view=lab&lab=wokwi')
    expect(page.locator('#main')).to_have_attribute('aria-busy', 'false')
    details = page.locator('#journal').locator('xpath=ancestor::details[1]')
    if details.get_attribute('open') is None:
        details.locator(':scope > summary').click()
    expect(page.locator('#journal')).to_have_value('Existing own journal')
    page.locator('#journal').fill('Own draft sent before tutor question')
    page.locator('#tutorLauncher').click()
    page.locator('#tutorQuestion').fill('Nên dùng nền tảng nào trong Lab?')
    page.locator('#tutorSend').click()
    expect(page.locator('#tutorMessages')).to_contain_text('Wokwi phù hợp')
    require(len(agent_calls) == 1 and not vision_calls, 'Signed-in text used the wrong tutor endpoint')
    request = agent_calls[0]
    require(request['savedNote'] == 'Own draft sent before tutor question', 'Tutor asked before progress synchronization')
    require(request['body']['courseSlug'] == 'arduino' and request['body']['lessonSlug'] == 'led'
            and request['body']['selectedPlatformKey'] == 'wokwi', 'Current lesson/lab scope was lost')
    require('educationalContext' not in request['body'] and 'history' not in request['body'], 'Account route should use server-owned state and conversation')
    expect(page.locator('#tutorStatus')).to_contain_text('dữ liệu học tập của tài khoản')

    mode['error'] = True
    page.locator('#tutorQuestion').fill('Còn bước tiếp theo?')
    page.locator('#tutorSend').click()
    expect(page.locator('#tutorStatus')).to_contain_text('Trợ lý tài khoản chưa sẵn sàng')
    require(not vision_calls, 'An account agent error silently fell back to guest chat')
    expect(page.locator('#tutorQuestion')).to_have_value('Còn bước tiếp theo?')
    for backend_code, guidance, client_code in [
        ('FEATURE_DISABLED', 'Agent tài khoản đang tắt', 'AI_UNAVAILABLE'),
        ('AI_MODEL_UNAVAILABLE', 'chưa có mô hình khả dụng', 'AI_MODEL'),
    ]:
        mode['backendCode'] = backend_code
        page.locator('#tutorSend').click()
        expect(page.locator('#tutorStatus')).to_contain_text(guidance)
        report = json.loads(page.locator('#tutorErrorDetails pre').text_content())
        require(report.get('backendCode') == backend_code and report.get('code') == client_code,
                'Tutor diagnostics dropped the backend configuration failure')
        require('Fixture provider not configured' not in json.dumps(report), 'Raw backend message leaked into diagnostics')
        expect(page.locator('#tutorQuestion')).to_have_value('Còn bước tiếp theo?')
    require(not vision_calls, 'A configuration failure fell back to guest chat')
    mode['error'] = False
    mode.pop('backendCode', None)

    image = page.evaluate('''() => {const c=document.createElement('canvas');c.width=80;c.height=60;
      const x=c.getContext('2d');x.fillStyle='#008080';x.fillRect(0,0,80,60);return c.toDataURL('image/png');}''')
    page.locator('#tutorImageInput').set_input_files({'name': 'lab.png', 'mimeType': 'image/png', 'buffer': base64.b64decode(image.split(',')[1])})
    expect(page.locator('#tutorAttachments figure')).to_have_count(1)
    page.locator('#tutorQuestion').fill('Nhìn ảnh này giúp tôi')
    page.locator('#tutorSend').click()
    expect(page.locator('#tutorMessages')).to_contain_text('Ảnh đã gửi có một bàn thực hành')
    require(len(vision_calls) == 1, 'Image question did not retain vision support')
    vision = vision_calls[0]
    require('authorization' not in vision['headers'], 'Account bearer token leaked to public vision API')
    require(vision['body']['educationalContext']['source'] == 'browser-self-report', 'Image context falsely claimed database authority')
    require(vision['body']['educationalContext']['currentLesson']['journal']['note'] == 'Own draft sent before tutor question', 'Current own journal absent from vision context')
    expect(page.locator('#tutorStatus')).to_contain_text('ghi chép tự học gửi từ thiết bị')

    # The ordinary website chat also uses account data after login, without
    # inheriting the lesson tutor's conversation or leaking replies after logout.
    page.goto(base + '/frontend/public/index.html')
    page.locator('#chatTriggerBtn').click()
    page.locator('#chatInputField').fill('Tiến độ của tôi và nên học Lab nào tiếp?')
    page.locator('#chatSubmitBtn').click()
    expect(page.locator('#chatMessageContainer .msg--assistant[data-state="complete"]')).to_contain_text('Wokwi phù hợp')
    home = agent_calls[-1]['body']
    require(home['message'] == 'Tiến độ của tôi và nên học Lab nào tiếp?' and home['mode'] == 'EDUCATIONAL',
            'Homepage chat did not use the authenticated educational agent')
    require('courseSlug' not in home and 'lessonSlug' not in home and 'conversationId' not in home,
            'Homepage chat inherited the lesson tutor conversation or scope')
    expect(page.locator('.chat-context-source')).to_contain_text('dữ liệu học tập của tài khoản')
    require(len(vision_calls) == 1, 'Homepage authenticated chat fell back to the legacy AI')
    mode.update(error=True, backendCode='FEATURE_DISABLED')
    page.locator('#chatInputField').fill('Kiểm tra cấu hình agent')
    page.locator('#chatSubmitBtn').click()
    expect(page.locator('#chatMessageContainer')).to_contain_text('Agent tài khoản đang tắt')
    report = json.loads(page.locator('.chat-error-report').text_content())
    require(report.get('backendCode') == 'FEATURE_DISABLED', 'Homepage diagnostics dropped the backend failure')
    mode['error'] = False
    page.evaluate('''async () => {
        const {accountService} = await import(new URL('../src/services/AccountService.js', location.href));
        await accountService.signOut();
    }''')
    expect(page.locator('#chatMessageContainer')).not_to_contain_text('Wokwi phù hợp')
    expect(page.locator('#chatMessageContainer')).to_contain_text('Đăng nhập')
    require(not errors, 'Unexpected browser errors: ' + '; '.join(errors))
    browser.close()

print('PASS account tutor scope+sync+source, unavailable-agent no-fallback, and vision context with zero bearer leakage; no paid AI calls')
