#!/usr/bin/env python3
"""Exercise ST-Robot with a real locally built official micro:bit Python Editor.

Example:
  python3 tests/microbit-lab-smoke.py \
      --editor-build /tmp/python-editor/build --base http://127.0.0.1:5500

Build the official microbit/python-editor-v3 source before running this test.
The required build directory prevents a protocol fixture from being mistaken
for the real editor. Provider-origin assets are served from that build. All
other external requests, including the simulator, are blocked deliberately.
This verifies editing and lesson persistence, not simulator execution or live
provider availability. No repository data is seeded or changed by this test.
"""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import mimetypes
from pathlib import Path
import sys
import traceback
from urllib.parse import parse_qs, unquote, urlparse

from playwright.sync_api import sync_playwright, expect


parser = argparse.ArgumentParser()
parser.add_argument('--base', default='http://127.0.0.1:5500')
parser.add_argument('--chromium', default='/usr/bin/chromium')
parser.add_argument('--editor-build', type=Path, required=True,
                    help='Actual build directory from the official Python Editor source')
parser.add_argument('--output', default='/tmp/strobot-microbit-lab-results.json')
args = parser.parse_args()
BUILD = args.editor_build.resolve()
if not (BUILD / 'index.html').is_file() or not (BUILD / 'assets').is_dir():
    parser.error('--editor-build must contain the built index.html and assets directory')
BASE = args.base.rstrip('/')
PUBLIC = BASE + '/frontend/public/'
EDITOR_ORIGIN = 'https://python.microbit.org'
STORAGE_PREFIX = 'strobot.microbit.editor.v1.'
UPSTREAM_SERVICE_WORKER_ERROR = 'Failed to get a ServiceWorkerRegistration: The user denied permission to use Service Worker.'
results = []


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def lessons(page):
    return page.evaluate('''() => window.STROBOT_CURRICULUM.find(course => course.id === 'microbit').lessons''')


def python_source(lesson):
    if 'MicroPython' in lesson['lang']:
        return lesson['code']
    return next(variant['code'] for variant in lesson.get('codeVariants', [])
                if 'MicroPython' in variant.get('lang', ''))


def goto_lesson(page, lesson_id):
    page.goto(PUBLIC + 'course.learning.html?course=microbit&lesson=' + lesson_id + '&view=lab',
              wait_until='domcontentloaded')
    expect(page.locator('#courseSelect')).to_have_value('microbit')
    expect(page.locator('#labView')).to_be_visible()
    expect(page.locator('#practiceFrame')).to_be_visible()


def real_editor(page, expected_code=None):
    iframe = page.locator('#practiceFrame')
    iframe.scroll_into_view_if_needed()
    source = urlparse(iframe.get_attribute('src'))
    require(source.scheme == 'https' and source.netloc == 'python.microbit.org'
            and source.path == '/v/3/' and parse_qs(source.query).get('controller') == ['1'],
            'Default micro:bit iframe does not use the official Python Editor controller')
    editor = page.frame_locator('#practiceFrame').locator('.cm-content').first
    editor.wait_for(state='visible', timeout=60000)
    page.wait_for_function('''() => ['ready', 'saved'].includes(
        document.getElementById('microbitEditorStatus').dataset.state)''', timeout=30000)
    if expected_code is not None:
        # Lesson scripts are small. CodeMirror exposes the whole script as text
        # at this viewport; only an optional final newline is layout-dependent.
        actual = editor.locator('.cm-line').evaluate_all('(lines) => lines.map(line => line.textContent).join("\\n")')
        require(actual.rstrip('\n') == expected_code.rstrip('\n'),
                'Actual editable source differs from this lesson: ' + repr(actual))
    return editor


def saved_record(page, lesson_id):
    return page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', STORAGE_PREFIX + lesson_id)


def source_from_record(record):
    return base64.b64decode(record['project']['files']['main.py'], validate=True).decode('utf-8')


def edit_source(page, editor, code, lesson_id):
    editor.click()
    editor.press('Control+a')
    editor.press('Backspace')
    editor.press_sequentially(code, delay=3)
    page.wait_for_function('''({key, code}) => {
        const raw = localStorage.getItem(key);
        if (!raw) return false;
        const record = JSON.parse(raw);
        const bytes = Uint8Array.from(atob(record.project.files['main.py']), character => character.charCodeAt(0));
        return new TextDecoder().decode(bytes) === code;
    }''', arg={'key': STORAGE_PREFIX + lesson_id, 'code': code}, timeout=30000)
    expect(page.locator('#microbitEditorStatus')).to_have_attribute('data-state', 'saved')
    expect(page.locator('#microbitEditorStatus')).to_contain_text('Đã lưu')


def downloaded_source(page, lesson_id):
    expect(page.locator('#microbitDownloadBtn')).to_be_enabled()
    with page.expect_download() as download_info:
        page.locator('#microbitDownloadBtn').click()
    download = download_info.value
    require(download.suggested_filename == f'microbit-{lesson_id}.py', 'Downloaded source has the wrong lesson filename')
    return Path(download.path()).read_bytes().decode('utf-8')


def actual_starter_edit_reload(page):
    goto_lesson(page, 'matrix')
    matrix = next(lesson for lesson in lessons(page) if lesson['id'] == 'matrix')
    initial = python_source(matrix)
    expect(page.locator('#sampleCodeBox')).to_have_text(initial)
    editor = real_editor(page, initial)
    code = '# Mã đã sửa trực tiếp trong phòng lab — kiểm tra tiếng Việt\nfrom microbit import *\ndisplay.show(Image.SMILE)\nsleep(750)\n'
    edit_source(page, editor, code, 'matrix')
    require(source_from_record(saved_record(page, 'matrix')) == code, 'Authentic editor save changed UTF-8 source')
    require(downloaded_source(page, 'matrix') == code, 'Saved Python download is not the actual edited source')
    page.reload(wait_until='domcontentloaded')
    real_editor(page, code)
    require(downloaded_source(page, 'matrix') == code, 'Reload replaced the learner code with a starter')
    page.screenshot(path='/tmp/strobot-microbit-edited-restored.png', full_page=True)
    return {'official_editor_dom': '.cm-content', 'lesson': 'matrix',
            'starter_matches_lesson': True, 'real_keyboard_edit': True,
            'authentic_workspacesave': True, 'saved_utf8_download_exact': True,
            'reload_restores_edited_source': True}


def lesson_isolation_and_confirmed_reset(page):
    goto_lesson(page, 'matrix')
    bank = {lesson['id']: lesson for lesson in lessons(page)}
    matrix_code = '# Bài ma trận: giữ riêng\nfrom microbit import *\ndisplay.show(Image.DIAMOND)\n'
    button_code = '# Bài nút nhấn: không thay bài ma trận\nfrom microbit import *\ndisplay.show(Image.HEART)\nsleep(650)\n'
    edit_source(page, real_editor(page, python_source(bank['matrix'])), matrix_code, 'matrix')
    matrix_record = saved_record(page, 'matrix')
    page.locator('#lessonList button').nth(next(index for index, lesson in enumerate(lessons(page))
                                              if lesson['id'] == 'buttons')).click()
    page.locator('#tabBtnLab').click()
    edit_source(page, real_editor(page, python_source(bank['buttons'])), button_code, 'buttons')
    button_record = saved_record(page, 'buttons')
    require(saved_record(page, 'matrix') == matrix_record, 'Changing another lesson overwrote matrix work')
    page.locator('#microbitResetBtn').click()
    expect(page.locator('#microbitResetDialog')).to_be_visible()
    page.locator('#microbitCancelReset').click()
    require(saved_record(page, 'buttons') == button_record, 'Canceling reset changed the saved project')
    require(downloaded_source(page, 'buttons') == button_code, 'Canceling reset lost the current source')
    page.locator('#microbitResetBtn').click()
    page.locator('#microbitConfirmReset').click()
    expect(page.locator('#microbitResetDialog')).to_be_hidden()
    real_editor(page, python_source(bank['buttons']))
    require(downloaded_source(page, 'buttons') == python_source(bank['buttons']), 'Reset did not restore this lesson starter')
    require(saved_record(page, 'matrix') == matrix_record, 'Reset cleared a different lesson project')
    page.locator('#lessonList button').nth(next(index for index, lesson in enumerate(lessons(page))
                                              if lesson['id'] == 'matrix')).click()
    page.locator('#tabBtnLab').click()
    real_editor(page, matrix_code)
    require(downloaded_source(page, 'matrix') == matrix_code, 'Switching back lost the other lesson edit')
    return {'separate_matrix_and_buttons_projects': True, 'cancel_reset_keeps_code': True,
            'confirmed_reset_restores_current_starter': True, 'reset_preserves_other_lesson': True}


def main():
    started_at = datetime.now(timezone.utc).isoformat()
    with sync_playwright() as runtime:
        browser = runtime.chromium.launch(executable_path=args.chromium, headless=True,
                                          args=['--no-sandbox', '--disable-dev-shm-usage'])

        def checked(name, check):
            context = browser.new_context(viewport={'width': 1600, 'height': 1200}, accept_downloads=True)
            context.add_init_script('''
                window.__microbitTestMessages = [];
                window.addEventListener('message', event => {
                    if (event.origin === 'https://python.microbit.org' && event.data?.type === 'pyeditor') {
                        window.__microbitTestMessages.push(event.data);
                        window.__microbitTestMessages = window.__microbitTestMessages.slice(-8);
                    }
                });
            ''')
            errors = []
            blocked = set()
            fulfilled = set()
            missing = set()
            popup_urls = []

            def route_request(route):
                parsed = urlparse(route.request.url)
                if parsed.netloc == urlparse(BASE).netloc or parsed.scheme in ('data', 'blob'):
                    route.continue_()
                    return
                if parsed.scheme == 'https' and parsed.netloc == 'python.microbit.org':
                    requested = unquote(parsed.path)
                    relative = 'index.html' if requested.rstrip('/') == '/v/3' else requested.lstrip('/')
                    # Some official deployments use a /v/3 base, while the
                    # default OSS build refers to root /assets and /workers.
                    if relative.startswith('v/3/'):
                        relative = relative[len('v/3/'):]
                    target = (BUILD / relative).resolve()
                    if BUILD not in target.parents or not target.is_file():
                        missing.add(requested)
                        route.fulfill(status=404, content_type='text/plain', body='Asset absent from official local build')
                        return
                    fulfilled.add(str(target.relative_to(BUILD)))
                    content_type = mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
                    route.fulfill(status=200, content_type=content_type, body=target.read_bytes(),
                                  headers={'Access-Control-Allow-Origin': '*'})
                    return
                blocked.add(parsed.netloc)
                route.abort()

            context.route('**/*', route_request)
            page = context.new_page()
            page.set_default_timeout(10000)
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('popup', lambda popup: popup_urls.append(popup.url))
            try:
                details = check(page)
                # Official v3.1.17 index.ts calls getRegistration() without a
                # rejection handler when its PWA flag is off. Chromium can deny
                # that call in a third-party iframe. The same exception was
                # reproduced both with and without our iframe sandbox. Keep it
                # visible as an upstream issue after the functional assertions;
                # every other page error still fails the test.
                upstream_errors = [error for error in errors if error == UPSTREAM_SERVICE_WORKER_ERROR]
                unexpected_errors = [error for error in errors if error != UPSTREAM_SERVICE_WORKER_ERROR]
                require(not unexpected_errors, 'Unexpected uncaught browser errors: ' + repr(unexpected_errors))
                require(not missing, 'Official local editor build is missing requested assets: ' + repr(sorted(missing)))
                require(not popup_urls, 'Typing or changing lessons opened a new browser tab: ' + repr(popup_urls))
                results.append({'name': name, 'status': 'passed', 'details': details,
                                'official_build_assets_served': sorted(fulfilled),
                                'blocked_external_hosts': sorted(blocked), 'popups': len(popup_urls),
                                'browser_errors': errors,
                                'known_upstream_service_worker_errors': upstream_errors})
                print('PASS', name, flush=True)
                if upstream_errors:
                    print(f'UPSTREAM ISSUE ({len(upstream_errors)} occurrences): {UPSTREAM_SERVICE_WORKER_ERROR}', flush=True)
            except Exception as error:
                details = ''.join(traceback.format_exception_only(type(error), error)).strip()
                results.append({'name': name, 'status': 'failed', 'details': details,
                                'page_errors': errors, 'missing_build_assets': sorted(missing),
                                'editor_messages': page.evaluate('window.__microbitTestMessages'),
                                'editor_status': page.locator('#microbitEditorStatus').text_content()})
                print('FAIL', name, details, flush=True)
                try:
                    page.screenshot(path=f'/tmp/strobot-microbit-failure-{len(results)}.png', full_page=True)
                except Exception:
                    pass
            finally:
                context.close()

        checked('real official editor receives lesson source, saves UTF-8 edits and restores after reload', actual_starter_edit_reload)
        checked('switching lessons isolates projects and confirmed reset preserves other lesson work', lesson_isolation_and_confirmed_reset)
        browser.close()
    output = {'started_at_utc': started_at, 'finished_at_utc': datetime.now(timezone.utc).isoformat(),
              'passed': sum(item['status'] == 'passed' for item in results),
              'failed': sum(item['status'] == 'failed' for item in results),
              'editor_build': str(BUILD),
              'editor_index_sha256': hashlib.sha256((BUILD / 'index.html').read_bytes()).hexdigest(),
              'actual_editor_tested': True, 'simulator_tested': False, 'live_provider_tested': False,
              'known_upstream_service_worker_errors': sum(len(item.get('known_upstream_service_worker_errors', [])) for item in results),
              'results': results}
    Path(args.output).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({key: output[key] for key in ('passed', 'failed', 'known_upstream_service_worker_errors', 'simulator_tested', 'live_provider_tested')}), flush=True)
    return 1 if output['failed'] else 0


if __name__ == '__main__':
    sys.exit(main())
