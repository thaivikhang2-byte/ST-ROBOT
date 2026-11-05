#!/usr/bin/env python3
"""Verify real chat UI recovery with mocked HTTP responses; no paid AI requests.

Start `node start-web.cjs` first. Results and screenshots stay in /tmp.
"""
import argparse
import json
from pathlib import Path
import sys
import traceback
from urllib.parse import urlparse
from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base', default='http://127.0.0.1:5500')
parser.add_argument('--chromium', default='/usr/bin/chromium')
parser.add_argument('--output', default='/tmp/strobot-chat-recovery-results.json')
args = parser.parse_args()
results = []
QUESTION = 'Bộ đếm có count = 33; presses = 3; chạy count += presses. Sau lượt này count bằng bao nhiêu?'


def require(value, message):
    if not value:
        raise AssertionError(message)


def prepare(browser, mobile=False):
    context = browser.new_context(viewport={'width': 375 if mobile else 1440, 'height': 812 if mobile else 900})
    page = context.new_page()
    errors, requests = [], []
    fixture = {'status': 502, 'body': {'error': 'Kết nối trả lời bị gián đoạn. Vui lòng gửi lại câu hỏi sau.'}}
    page.on('pageerror', lambda error: errors.append(str(error)))

    def route_request(route):
        url = urlparse(route.request.url)
        if url.path == '/api/home-chat':
            requests.append(route.request.post_data_json)
            if fixture.get('hold'):
                fixture['held'] = route
                return
            if fixture.get('abort'):
                route.abort('failed')
                return
            route.fulfill(status=fixture['status'], content_type='application/json',
                          body=fixture.get('raw', json.dumps(fixture['body'], ensure_ascii=False)))
        elif url.netloc == urlparse(args.base).netloc:
            route.continue_()
        else:
            route.abort()

    page.route('**/*', route_request)
    page.goto(args.base.rstrip('/') + '/frontend/public/quiz.html', wait_until='domcontentloaded')
    page.locator('#chatTriggerBtn').click()
    expect(page.locator('#supportChatWindow')).to_be_visible()
    return context, page, fixture, requests, errors


def send(page, question=QUESTION):
    page.locator('#chatInputField').fill(question)
    page.locator('#chatSubmitBtn').click()


def finished(page, state='failed'):
    expect(page.locator(f'#chatMessageContainer .msg[data-state="{state}"]').last).to_be_visible()
    expect(page.locator('#chatSubmitBtn')).to_be_enabled()
    expect(page.locator('#chatForm')).not_to_have_attribute('aria-busy', 'true')


def retry_without_duplicate(browser):
    context, page, fixture, requests, errors = prepare(browser)
    try:
        send(page)
        finished(page)
        expect(page.locator('#chatInputField')).to_have_value(QUESTION)
        expect(page.locator('.chat-retry')).to_have_text('Thử lại')
        require(requests == [{'question': QUESTION, 'history': []}], 'Initial failed request changed payload')
        fixture.update(status=200, body={'reply': 'count = 33 + 3 = 36.'})
        page.locator('.chat-retry').click()
        finished(page, 'complete')
        expect(page.locator('#chatMessageContainer .msg--user')).to_have_count(1)
        expect(page.locator('#chatMessageContainer .msg--assistant')).to_have_count(2)
        expect(page.locator('.chat-retry')).to_have_count(0)
        expect(page.locator('#chatInputField')).to_have_value('')
        require(len(requests) == 2 and requests[1] == requests[0], 'Retry duplicated failed exchange in model history')
        send(page, 'Vì sao cộng 3?')
        expect(page.locator('#chatMessageContainer .msg[data-state="complete"]')).to_have_count(2)
        require(requests[-1]['history'] == [{'role': 'user', 'content': QUESTION},
                                           {'role': 'assistant', 'content': 'count = 33 + 3 = 36.'}],
                'Only successful question/answer pairs should enter history')
        require(not errors, str(errors))
        return {'retry_requests': 2, 'duplicate_user_bubbles': 0, 'failed_history_entries': 0}
    finally:
        context.close()


def retry_keeps_new_draft(browser):
    context, page, fixture, requests, errors = prepare(browser)
    try:
        send(page)
        finished(page)
        draft = 'Câu hỏi tiếp theo của tôi đang viết dở'
        page.locator('#chatInputField').fill(draft)
        fixture.update(status=200, body={'reply': '36.'})
        page.locator('.chat-retry').click()
        finished(page, 'complete')
        expect(page.locator('#chatInputField')).to_have_value(draft)
        require(requests[-1]['question'] == QUESTION and len(requests) == 2, 'Retry sent draft instead of failed question')
        require(not errors, str(errors))
        return {'new_draft_preserved': True}
    finally:
        context.close()


def resubmit_failed_question(browser):
    context, page, fixture, requests, errors = prepare(browser)
    try:
        send(page)
        finished(page)
        fixture.update(status=200, body={'reply': '36.'})
        page.locator('#chatInputField').press('Enter')
        finished(page, 'complete')
        expect(page.locator('#chatMessageContainer .msg--user')).to_have_count(1)
        expect(page.locator('#chatMessageContainer .msg--assistant')).to_have_count(2)
        require(len(requests) == 2 and requests[0] == requests[1] and not errors,
                'Submitting the unchanged restored question duplicated the exchange')
        return {'restored_question_enter_reuses_exchange': True}
    finally:
        context.close()


def permanent_error_codes(browser):
    checked = []
    for status, code in [(503, 'AI_AUTH'), (503, 'AI_MODEL'), (429, 'AI_QUOTA')]:
        context, page, fixture, requests, errors = prepare(browser)
        try:
            message = 'Người quản trị cần kiểm tra cấu hình dịch vụ.'
            fixture.update(status=status, body={'error': message, 'code': code, 'retryable': False, 'requestId': 'test-request'})
            send(page)
            finished(page)
            expect(page.locator('#chatMessageContainer')).to_contain_text(message)
            expect(page.locator('.chat-retry')).to_have_count(0)
            expect(page.locator('#chatInputField')).to_have_value(QUESTION)
            require(len(requests) == 1 and not errors, 'Permanent error retried automatically or raised browser error')
            checked.append(code)
        finally:
            context.close()
    return {'non_retryable_codes': checked}


def transient_and_malformed(browser):
    cases = [(502, {'error': 'Dịch vụ trả lời đang gián đoạn.', 'code': 'AI_UNAVAILABLE', 'retryable': True}, None),
             (503, {'error': 'Trợ lý đang bận.', 'code': 'AI_BUSY', 'retryable': True}, None),
             (504, {'error': 'Trợ lý phản hồi quá lâu.', 'code': 'AI_TIMEOUT', 'retryable': True}, None),
             (200, None, 'null'), (200, {}, '<html>Gateway error</html>'), (200, {'reply': '  '}, None)]
    for status, body, raw in cases:
        context, page, fixture, requests, errors = prepare(browser)
        try:
            fixture.update(status=status, body=body)
            if raw is not None:
                fixture['raw'] = raw
            send(page)
            finished(page)
            expect(page.locator('.chat-retry')).to_be_visible()
            expect(page.locator('#chatInputField')).to_have_value(QUESTION)
            require(len(requests) == 1 and not errors, 'Malformed/transient response raised an error or auto-retried')
        finally:
            context.close()
    return {'transient_and_malformed_cases': len(cases), 'automatic_post_retries': 0}


def network_failure(browser):
    context, page, fixture, requests, errors = prepare(browser)
    try:
        fixture['abort'] = True
        send(page)
        finished(page)
        expect(page.locator('#chatMessageContainer')).to_contain_text('Kiểm tra mạng rồi thử lại.')
        expect(page.locator('.chat-retry')).to_be_visible()
        require(not errors, str(errors))
        return {'network_error_preserves_question': True}
    finally:
        context.close()


def busy_and_close(browser):
    context, page, fixture, requests, errors = prepare(browser)
    try:
        fixture['hold'] = True
        send(page)
        page.wait_for_function('document.querySelector("#chatForm").getAttribute("aria-busy") === "true"')
        expect(page.locator('#chatSubmitBtn')).to_be_disabled()
        expect(page.locator('.chat-quick-query').first).to_be_disabled()
        page.locator('#chatForm').dispatch_event('submit')
        page.wait_for_timeout(100)
        require(len(requests) == 1, 'Duplicate submit produced a second HTTP request')
        page.locator('#chatCloseBtn').click()
        expect(page.locator('#supportChatWindow')).to_be_hidden()
        fixture['held'].fulfill(status=200, content_type='application/json', body=json.dumps({'reply': '36.'}))
        expect(page.locator('#chatMessageContainer .msg[data-state="complete"]')).to_have_count(1)
        require(page.evaluate('document.activeElement.id') == 'chatTriggerBtn', 'Background reply stole focus from the closed chat')
        require(not errors, str(errors))
        return {'duplicate_submit_prevented': True, 'closed_panel_stays_closed': True, 'focus_preserved': True}
    finally:
        context.close()


def timeout_and_waiting(browser):
    context, page, fixture, requests, errors = prepare(browser)
    try:
        page.clock.install()
        fixture['hold'] = True
        send(page)
        expect(page.locator('#chatForm')).to_have_attribute('aria-busy', 'true')
        page.clock.fast_forward(15001)
        expect(page.locator('#chatMessageContainer')).to_contain_text('Trợ lý đang kết nối')
        page.clock.fast_forward(60001)
        finished(page)
        expect(page.locator('#chatMessageContainer')).to_contain_text('Chờ phản hồi quá lâu.')
        expect(page.locator('.chat-retry')).to_be_visible()
        expect(page.locator('#chatInputField')).to_have_value(QUESTION)
        require(len(requests) == 1 and not errors, 'Client timeout retried automatically or raised browser error')
        fixture['held'].abort('failed')
        return {'waiting_status_seconds': 15, 'client_timeout_seconds': 75, 'automatic_post_retries': 0}
    finally:
        context.close()


def mobile_layout(browser):
    context, page, fixture, requests, errors = prepare(browser, True)
    try:
        send(page)
        finished(page)
        expect(page.locator('.chat-retry')).to_be_visible()
        dimensions = page.evaluate('({width: innerWidth, body: document.body.scrollWidth, html: document.documentElement.scrollWidth})')
        require(max(dimensions['body'], dimensions['html']) <= dimensions['width'], 'Mobile chat causes page overflow')
        expect(page.locator('#chatInputField')).to_be_visible()
        expect(page.locator('#chatSubmitBtn')).to_be_visible()
        page.screenshot(path='/tmp/strobot-chat-recovery-mobile.png', full_page=True)
        require(not errors, str(errors))
        return {'viewport': dimensions, 'retry_visible': True, 'screenshot': '/tmp/strobot-chat-recovery-mobile.png'}
    finally:
        context.close()


checks = [retry_without_duplicate, retry_keeps_new_draft, resubmit_failed_question, permanent_error_codes, transient_and_malformed,
          network_failure, busy_and_close, timeout_and_waiting, mobile_layout]
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox'])
    try:
        for check in checks:
            try:
                details = check(browser)
                results.append({'name': check.__name__, 'status': 'passed', 'details': details})
                print('PASS', check.__name__, flush=True)
            except Exception as error:
                results.append({'name': check.__name__, 'status': 'failed', 'details': str(error)})
                traceback.print_exc()
            Path(args.output).write_text(json.dumps({'passed': sum(row['status'] == 'passed' for row in results),
                                                      'failed': sum(row['status'] == 'failed' for row in results),
                                                      'live_ai_requests': 0, 'results': results}, ensure_ascii=False, indent=2))
    finally:
        browser.close()
sys.exit(any(row['status'] == 'failed' for row in results))
