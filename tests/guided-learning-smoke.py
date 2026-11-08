#!/usr/bin/env python3
"""Browser checks for guided practice, real model interaction and local backup restore.
External frames/AI are blocked; this verifies the website, not provider availability.
"""
import argparse
import json
import pathlib
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--base', default='http://127.0.0.1:5500')
parser.add_argument('--chromium', default='/usr/bin/chromium')
args = parser.parse_args()
base = args.base.rstrip('/')
errors, external = [], []
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    page = context.new_page()
    page.set_default_timeout(8000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    def route(request_route):
        url = request_route.request.url
        if urlparse(url).netloc == urlparse(base).netloc:
            request_route.continue_()
        else:
            external.append(url)
            request_route.abort()
    context.route('**/*', route)
    page.goto(base + '/frontend/public/course.learning.html?course=arduino', wait_until='domcontentloaded')
    expect(page.locator('#lessonList button')).to_have_count(6)
    courses = page.evaluate('COURSES')
    checked = []
    for course in courses:
        page.locator('#courseSelect').select_option(course['id'])
        for index, lesson in enumerate(course['lessons']):
            page.locator('#lessonList button').nth(index).click()
            # Entering/reopening a lesson must not manufacture a model interaction.
            assert page.evaluate('record().modelEvidence || null') is None
            page.locator('#tabBtnLab').click()
            expect(page.locator('#practiceSteps')).to_be_visible()
            expect(page.locator('#labGuide')).to_be_visible()
            expect(page.locator('#exercise')).to_be_visible()
            page.locator('#labButtons button[data-lab-key="local"]').click()
            expect(page.locator('#labButtons button[data-lab-key="local"]')).to_have_attribute('aria-pressed','true')
            expect(page.locator('#localLab')).to_be_visible()
            bench = page.locator('.lesson-bench')
            expect(bench).to_have_attribute('data-bench-course', course['id'])
            expect(bench).to_have_attribute('data-bench-lesson', lesson['id'])
            page.locator('#prediction').fill('Tôi dự đoán kết quả khi thử đầu vào mặc định của ' + lesson['title'])
            expect(page.locator('#labButtons button[data-lab-key="local"]')).to_have_attribute('aria-pressed','true')
            expect(page.locator('#localLab')).to_be_visible()
            buttons = bench.locator('button')
            assert buttons.count(), course['id'] + '/' + lesson['id'] + ': no interactive controls'
            for button_index in range(buttons.count()):
                button = buttons.nth(button_index)
                if button.is_enabled():
                    button.click()
                if page.evaluate('!!record().modelEvidence'):
                    break
            evidence = page.evaluate('record().modelEvidence || null')
            assert evidence and evidence['kind'] == 'local-model' and evidence['lessonId'] == lesson['id'], (course['id'], lesson['id'])
            assert evidence['actions'] and evidence['summary'].strip()
            assert evidence['prediction'] == page.locator('#prediction').input_value()
            assert page.evaluate('record().done') is False, 'An interaction cannot automatically award completion'
            checked.append(course['id'] + '/' + lesson['id'])
    assert len(checked) == 30
    print('PASS all 30 lesson models: no fabricated startup evidence, real interaction, correct lesson identity', flush=True)

    # A filled old-style journal is no longer treated as practical evidence by itself.
    page.goto(base + '/frontend/public/course.learning.html?course=arduino', wait_until='domcontentloaded')
    page.evaluate('localStorage.removeItem("strobot.original.course.v3")')
    page.reload(wait_until='domcontentloaded')
    page.locator('#tabBtnLab').click()
    selector_before=page.locator('#labButtons').bounding_box()
    page.locator('#practiceFrame').dispatch_event('error')
    expect(page.locator('#platformHelp')).to_contain_text('Khung lab tải chưa thành công')
    selector_after=page.locator('#labButtons').bounding_box()
    assert abs(selector_before['y']-selector_after['y'])<1, 'Async frame errors moved the platform choices'
    page.locator('#labButtons button[data-lab-key="local"]').click()
    page.locator('button[onclick="focusPracticePart(frameKey===\'local\'?\'localLab\':\'frameHost\')"]').click()
    expect(page.locator('#localLab')).to_be_focused()
    page.locator('button[onclick="focusPracticePart(\'observation\')"]').click()
    expect(page.locator('#observation')).to_be_focused()
    answer = page.evaluate('lesson().answer')
    page.evaluate('document.getElementById("quizForm").parentElement.open=true')
    page.locator(f'#quizOptions input[value="{answer}"]').check()
    page.locator('#quizForm button[type=submit]').click()
    for field, value in {
        'observation': 'Với 330 Ω tôi quan sát I = 9,09 mA.',
        'explanation': 'Nguồn và LED giữ nguyên; điện trở hạn chế dòng qua LED.',
        'transfer': 'Đổi lên 1000 Ω được 3 mA, nhỏ hơn vì điện trở tăng.',
    }.items():
        page.locator('#' + field).fill(value)
    page.locator('#practiceSource').select_option('local-model')
    page.locator('.lesson-bench').get_by_role('button', name='Thử mạch', exact=True).click()
    page.locator('#prediction').fill('Tôi chọn 330 Ω; tăng điện trở lên 1000 Ω sẽ làm dòng giảm.')
    page.locator('#assessment button[onclick="markLessonComplete()"]').click()
    expect(page.locator('#notice')).to_contain_text('trước khi chạy')
    assert page.evaluate('record().done') is False
    page.locator('.lesson-bench').get_by_role('button', name='Thử mạch', exact=True).click()
    page.locator('.lesson-bench').get_by_label('Điện trở nối tiếp (Ω)').fill('1000')
    page.locator('.lesson-bench').get_by_role('button', name='Thử mạch', exact=True).click()
    expect(page.locator('.lesson-bench-output')).to_contain_text('I = 3 mA')
    page.locator('#assessment button[onclick="markLessonComplete()"]').click()
    expect(page.locator('#progressText')).to_contain_text('1/6')
    expect(page.locator('#completionStatus')).to_contain_text('tự xác nhận')
    page.reload(wait_until='domcontentloaded')
    expect(page.locator('#progressText')).to_contain_text('1/6')
    assert page.evaluate('record().modelEvidence.summary').startswith('R = 1000 Ω')
    page.locator('#tabBtnLab').click()
    print('PASS completion gates: prediction before model, correct quiz and structured self-report, reload persistence', flush=True)

    # Export, cancel, invalid file and restore are exercised through the UI.
    with page.expect_download() as download_info:
        page.locator('#exportNotes').click()
    backup_text = pathlib.Path(download_info.value.path()).read_text()
    backup = json.loads(backup_text)
    assert backup['schemaVersion'] == 2 and backup['records']['led']['done']
    before = page.evaluate('localStorage.getItem("strobot.original.course.v3")')
    page.locator('#importNotes').set_input_files({'name': 'bad.json', 'mimeType': 'application/json', 'buffer': b'{"course":"arduino","records":{"unknown":{"done":true}}}'})
    expect(page.locator('#notice')).to_contain_text('Tệp chưa được khôi phục')
    assert before == page.evaluate('localStorage.getItem("strobot.original.course.v3")')
    page.locator('#importNotes').set_input_files({'name': 'backup.json', 'mimeType': 'application/json', 'buffer': backup_text.encode()})
    expect(page.locator('#portfolioImportDialog')).to_be_visible()
    page.locator('#portfolioImportDialog').get_by_role('button', name='Giữ bản hiện tại', exact=True).click()
    assert before == page.evaluate('localStorage.getItem("strobot.original.course.v3")')
    page.locator('#prediction').fill('Bản mới để thử khôi phục')
    page.evaluate('''() => {state.microbit={matrix:{note:'ghi chú khóa khác',choice:null,done:false}};save();}''')
    page.locator('#importNotes').set_input_files({'name': 'backup.json', 'mimeType': 'application/json', 'buffer': backup_text.encode()})
    page.locator('#confirmImportNotes').click()
    expect(page.locator('#portfolioImportDialog')).to_be_hidden()
    assert page.evaluate('record().prediction') == backup['records']['led']['prediction']
    assert page.evaluate('state.microbit.matrix.note') == 'ghi chú khóa khác'
    assert page.evaluate('record().completionSource') == 'imported-self-report'
    assert page.evaluate('record().verified || false') is False
    print('PASS backup: real download, malformed rejection without mutation, cancel and selective restore', flush=True)

    for width in [375, 1440]:
        page.set_viewport_size({'width': width, 'height': 1000})
        page.locator('#tabBtnLab').click()
        page.locator('#labButtons button[data-lab-key="local"]').click()
        page.locator('#prediction').scroll_into_view_if_needed()
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), f'Page overflow at {width}'
        page.screenshot(path=f'/tmp/strobot-guided-{width}.png')
    # Existing notes/completions stay readable; no destructive migration.
    page.evaluate('''() => { localStorage.setItem('strobot.original.course.v3',JSON.stringify({arduino:{led:{note:'Ghi chú phiên bản trước',choice:1,done:true}},last:'arduino'})); }''')
    page.reload(wait_until='domcontentloaded')
    expect(page.locator('#progressText')).to_contain_text('1/6')
    assert page.evaluate('record().note') == 'Ghi chú phiên bản trước'
    page.locator('button[onclick="prepareTutorQuestion(\'hint\')"]').click()
    assert 'bước tiếp theo' in page.locator('#tutorQuestion').input_value()
    assert not any('/api/tutor' in url or '/api/home-chat' in url for url in external), 'Prompt buttons sent an unsolicited AI request'
    assert not errors, errors
    print('PASS mobile/desktop layout, old records preserved and learner-controlled AI prompts', flush=True)
    browser.close()
