#!/usr/bin/env python3
"""Real chat/Tutor DOM and math-font checks with fixture replies, no paid calls."""
import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base', default='http://127.0.0.1:5500')
parser.add_argument('--chromium', default='/usr/bin/chromium')
parser.add_argument('--output', default='/tmp/strobot-ai-formatting-results.json')
args = parser.parse_args()
AI = 'https://st-robot-1.onrender.com'
QUESTION = r'Giải thích **I** và \frac{U}{R}; giữ count += presses.'
LONG = '+'.join(f'x_{{{index}}}' for index in range(1, 65))
REPLY = r'''**Công thức dòng điện:**

$$I = \frac{V_s - V_f}{R}$$

Điện trở \(R = 330\,\Omega\). Kiểm tra tiếng Việt: điện áp, cường độ dòng điện.

- Giữ đơn vị nhất quán.
- Đối chiếu kết quả.

```python
count += presses
formula = "$$I=\frac{U}{R}$$"
```

| Đại lượng | Giá trị |
| --- | --- |
| Điện trở | 330 Ω |

$$''' + LONG + '=0$$'
UNTRUSTED = r'''<script>window.__aiInjected=1</script>
<img src="https://ai-format-test.invalid/image" onerror="window.__aiInjected=1">
![ảnh](https://ai-format-test.invalid/markdown-image)
[x](javascript:alert(1))
$$\href{javascript:alert(1)}{x}$$
$$\includegraphics{https://ai-format-test.invalid/tex-image}$$
'''


def require(value, message):
    if not value:
        raise AssertionError(message)


def run_case(browser, kind, width):
    context = browser.new_context(viewport={'width': width, 'height': 900 if width > 400 else 812})
    page = context.new_page()
    errors, posts, fonts, forbidden = [], [], [], []
    mode = {'reply': REPLY}
    page.on('pageerror', lambda error: errors.append(str(error)))

    def record_response(response):
        if '/vendor/katex/fonts/' in response.url:
            fonts.append({'url': response.url, 'status': response.status})

    page.on('response', record_response)

    def route_request(route):
        parsed = urlparse(route.request.url)
        origin = f'{parsed.scheme}://{parsed.netloc}'
        if parsed.hostname == 'ai-format-test.invalid':
            forbidden.append(route.request.url)
            route.abort()
        elif origin == AI and parsed.path == '/health':
            route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'ai': {'keyConfigured': True}}))
        elif origin == AI and parsed.path in ['/api/home-chat', '/api/tutor']:
            posts.append({'path': parsed.path, 'body': route.request.post_data_json})
            route.fulfill(status=200, content_type='application/json', body=json.dumps({'reply': mode['reply']}, ensure_ascii=False))
        elif origin == args.base.rstrip('/'):
            route.continue_()
        else:
            route.abort()

    page.route('**/*', route_request)
    suffix = '/frontend/public/index.html' if kind == 'home' else '/frontend/public/course.learning.html?course=arduino'
    page.goto(args.base.rstrip('/') + suffix, wait_until='domcontentloaded')
    if kind == 'home':
        page.locator('#chatTriggerBtn').click()
        input_box = page.locator('#chatInputField')
        button = page.locator('#chatSubmitBtn')
        replies = page.locator('#chatMessageContainer .msg--assistant.ai-rich-text')
        users = page.locator('#chatMessageContainer .msg--user')
        expected_path = '/api/home-chat'
        panel = page.locator('#supportChatWindow')
    else:
        input_box = page.locator('#tutorQuestion')
        button = page.locator('#tutorSend')
        replies = page.locator('#tutorMessages .chat-message:not(.user) .ai-rich-text')
        users = page.locator('#tutorMessages .chat-message.user')
        expected_path = '/api/tutor'
        panel = page.locator('.ws-ai')
    input_box.fill(QUESTION)
    button.click()
    expect(replies).to_have_count(1)
    expect(button).to_be_enabled()
    rich = replies.first
    expect(rich.locator('.katex')).to_have_count(3)
    require(rich.locator('.mfrac').count() >= 1, 'Reported fraction was not visually typeset')
    require(rich.locator('msub').count() >= 2, 'Subscripts were not represented in accessible math')
    expect(rich.locator('strong')).to_contain_text('Công thức dòng điện:')
    expect(rich.locator('pre code')).to_have_text('count += presses\nformula = "$$I=\\frac{U}{R}$$"\n')
    expect(rich.locator('pre code')).to_have_attribute('translate', 'no')
    expect(rich.locator('table')).to_have_count(1)
    require('điện áp, cường độ dòng điện' in rich.inner_text(), 'Vietnamese reply text changed')
    require('**I**' in users.first.inner_text() and users.first.locator('strong,.katex').count() == 0,
            'User question must remain literal text')
    require(posts[0]['path'] == expected_path and posts[0]['body']['question'] == QUESTION and posts[0]['body']['history'] == [],
            'Rendering changed the request or original question')
    if kind == 'tutor':
        require(posts[0]['body']['course'] == 'arduino' and posts[0]['body']['lesson'] == 'led', 'Tutor lost its current lesson')
    page.evaluate('document.fonts.ready')
    require(fonts and all(font['status'] == 200 for font in fonts), 'Local KaTeX fonts did not load successfully')
    require(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Math pushed the whole page outside the viewport')
    dimensions = rich.locator('.ai-math--display').last.evaluate('(e)=>({client:e.clientWidth,scroll:e.scrollWidth})')
    require(dimensions['scroll'] > dimensions['client'], 'Long formula should scroll within its own container')
    if kind == 'home':
        page.locator('#chatMessageContainer').evaluate('(e)=>{e.scrollTop=0}')
    else:
        page.locator('#tutorMessages').evaluate('(e)=>{e.scrollTop=0}')
    panel.screenshot(path=f'/tmp/strobot-ai-math-{kind}-{width}.png')
    page.evaluate("document.dispatchEvent(new CustomEvent('toggle-theme'))")
    expect(page.locator('body')).to_have_class(re.compile('dark-mode'))
    require(rich.locator('.katex-html').first.evaluate('(e)=>getComputedStyle(e).visibility') != 'hidden', 'Dark mode hid mathematics')
    mode['reply'] = UNTRUSTED
    input_box.fill('Cho ví dụ tiếp theo.')
    button.click()
    expect(replies).to_have_count(2)
    expect(button).to_be_enabled()
    require(posts[1]['body']['history'] == [{'role': 'user', 'content': QUESTION}, {'role': 'assistant', 'content': REPLY[:4000]}],
            'Outgoing history must keep original raw reply, not rendered HTML')
    hostile = replies.last
    require(hostile.locator('script,img,iframe,object,embed').count() == 0, 'Untrusted AI reply created active content')
    require(hostile.locator('a[href^="javascript:"]').count() == 0, 'Unsafe reply link reached the DOM')
    require(page.evaluate('window.__aiInjected') is None and not forbidden, 'Reply executed code or attempted external image calls')
    require(not errors, 'Browser error: '+str(errors))
    result = {'kind': kind, 'width': width, 'math_expressions': 3, 'local_font_requests': len(fonts),
              'raw_history_preserved': True, 'unsafe_callouts': 0, 'page_errors': errors}
    context.close()
    return result


results = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox'])
    for kind in ['home', 'tutor']:
        for width in [375, 1440]:
            results.append(run_case(browser, kind, width))
    browser.close()
Path(args.output).write_text(json.dumps({'cases': results, 'paid_requests': 0, 'responses': 'fixtures only'}, ensure_ascii=False, indent=2))
print(f'PASS {len(results)} home/Tutor desktop/mobile cases: real math fonts, literal code/user text, bounded overflow, dark mode, safe DOM and unchanged raw request/history; no paid requests')
