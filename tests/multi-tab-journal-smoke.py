#!/usr/bin/env python3
"""Verify independent lesson tabs preserve journals and expose overlapping edits.

All external services and account requests are disabled in this local browser
test. Account-owned and guest merge contracts also run in learner-sync.mjs.
"""
import argparse
import json
import pathlib
import tempfile
import urllib.parse

from playwright.sync_api import expect, sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:5500')
    parser.add_argument('--chromium', default='/usr/bin/chromium')
    args = parser.parse_args()
    base = args.base.rstrip('/')
    allowed = urllib.parse.urlsplit(base).netloc
    if urllib.parse.urlsplit(base).hostname not in ['localhost', '127.0.0.1', '::1']:
        raise ValueError('Use a local disposable frontend')
    public = base + '/frontend/public/'
    key = 'strobot.original.course.v3'
    errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.chromium, headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage'])
        context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)

        def route(route):
            target = urllib.parse.urlsplit(route.request.url)
            if target.netloc == allowed and target.path.endswith('/src/config/backend.config.js'):
                route.fulfill(status=200, content_type='text/javascript', body=
                    "export const BACKEND_CONFIG={apiBaseUrl:''};export function resolveBackendUrl(){return '';}")
            elif target.netloc == allowed or target.scheme not in ['http', 'https']:
                route.continue_()
            else:
                route.fulfill(status=200, content_type='text/html', body='<p>External lab disabled for test</p>')
        context.route('**/*', route)

        def page():
            result = context.new_page()
            result.on('pageerror', lambda error: errors.append(str(error)))
            result.set_default_timeout(10000)
            return result

        def open_lesson(tab, course='arduino', lesson='led'):
            tab.goto(public + f'course.learning.html?course={course}&lesson={lesson}', wait_until='domcontentloaded')
            expect(tab.locator('#main')).to_have_attribute('aria-busy', 'false')
            tab.locator('#tabBtnLab').click()
            details = tab.locator('#journal').locator('xpath=ancestor::details[1]')
            if details.get_attribute('open') is None:
                details.locator(':scope > summary').click()

        first, second = page(), page()
        open_lesson(first)
        first.evaluate('''key => localStorage.setItem(key, JSON.stringify({last:'arduino',
            arduino:{led:{note:'original',choice:null,done:false}}}))''', key)
        open_lesson(first)
        open_lesson(second)
        expect(first.locator('#journal')).to_have_value('original')
        expect(second.locator('#journal')).to_have_value('original')

        first.locator('#journal').fill('Journal from first tab')
        second.locator('#prediction').fill('Prediction from second tab')
        first.locator('#observation').fill('Observation from first tab')
        saved = first.evaluate('key => JSON.parse(localStorage.getItem(key))', key)
        assert saved['arduino']['led']['note'] == 'Journal from first tab'
        assert saved['arduino']['led']['prediction'] == 'Prediction from second tab'
        assert saved['arduino']['led']['observation'] == 'Observation from first tab'

        second.locator('#journal').fill('Overlapping second-tab draft')
        expect(second.locator('#tabConflictRecovery')).to_be_visible()
        expect(second.locator('#saveNotice')).to_contain_text('tab khác')
        saved = first.evaluate('key => JSON.parse(localStorage.getItem(key))', key)
        assert saved['arduino']['led']['note'] == 'Journal from first tab'
        expect(second.locator('#journal')).to_have_value('Overlapping second-tab draft')

        # An asynchronous refresh must not replace an explicitly unsaved draft.
        second.evaluate("document.dispatchEvent(new CustomEvent('strobot:learner-data-updated'))")
        expect(second.locator('#journal')).to_have_value('Overlapping second-tab draft')
        first.locator('#journal').fill('Newer saved first-tab journal')

        with second.expect_download() as pending:
            second.locator('#tabConflictRecovery button').first.click()
        with tempfile.TemporaryDirectory(prefix='strobot-tab-draft-') as directory:
            target = pathlib.Path(directory) / 'draft.json'
            pending.value.save_as(target)
            draft = json.loads(target.read_text())
            assert draft['records']['led']['note'] == 'Overlapping second-tab draft'

        second.once('dialog', lambda dialog: dialog.accept())
        second.locator('#tabConflictRecovery button').nth(1).click()
        expect(second.locator('#tabConflictRecovery')).to_be_hidden()
        expect(second.locator('#journal')).to_have_value('Newer saved first-tab journal')
        saved = first.evaluate('key => JSON.parse(localStorage.getItem(key))', key)
        assert saved['arduino']['led']['prediction'] == 'Prediction from second tab'

        third = page()
        open_lesson(third, 'microbit', 'matrix')
        third.locator('#journal').fill('Independent course journal')
        first.locator('#transfer').fill('Another change in the first course')
        saved = third.evaluate('key => JSON.parse(localStorage.getItem(key))', key)
        assert saved['microbit']['matrix']['note'] == 'Independent course journal'
        assert saved['arduino']['led']['note'] == 'Newer saved first-tab journal'
        assert saved['arduino']['led']['prediction'] == 'Prediction from second tab'
        assert saved['arduino']['led']['transfer'] == 'Another change in the first course'
        assert not errors, errors
        browser.close()
    print('PASS simultaneous tabs: disjoint merge, overlap protection, draft export, explicit recovery and independent courses')


if __name__ == '__main__':
    main()
