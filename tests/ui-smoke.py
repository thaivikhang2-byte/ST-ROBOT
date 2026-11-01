#!/usr/bin/env python3
"""Local UI regression checks; all external calls are blocked and AI is mocked.
Run: python3 tests/ui-smoke.py --base http://127.0.0.1:8000
Requires Python Playwright, pypdf and Chromium, and checkout served at BASE.
No backend or credentials required. Results are written outside the checkout.
"""
import argparse
import io
import json
import pathlib
import re
import sys
import traceback
import unicodedata
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, expect
from pypdf import PdfReader

parser = argparse.ArgumentParser()
parser.add_argument('--base', default='http://127.0.0.1:8000')
parser.add_argument('--output', default='/tmp/strobot-ui-smoke-results.json')
parser.add_argument('--chromium', default='/usr/bin/chromium')
args = parser.parse_args()
BASE = args.base.rstrip('/')
PUBLIC = BASE + '/frontend/public/'
results = []
api_requests = []
blocked = set()
page_errors = []
reply_mode = {'home': 'ok', 'tutor': 'ok'}


def require(value, message):
    if not value:
        raise AssertionError(message)


def readable_text(value):
    """Ignore layout whitespace while retaining Vietnamese diacritics and words."""
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFC', value)).strip().casefold()


def checked(name, fn):
    previous_errors = len(page_errors)
    try:
        details = fn()
        require(len(page_errors) == previous_errors, 'Uncaught browser errors: ' + repr(page_errors[previous_errors:]))
        results.append({'name': name, 'status': 'passed', 'details': details})
        print('PASS', name, flush=True)
    except Exception as error:
        details = ''.join(traceback.format_exception_only(type(error), error)).strip()
        results.append({'name': name, 'status': 'failed', 'details': details})
        print('FAIL', name, details, flush=True)
        try:
            page.screenshot(path='/tmp/strobot-smoke-failure-' + str(len(results)) + '.png', full_page=True)
        except Exception:
            pass


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    page = context.new_page()
    page.set_default_timeout(7000)
    page.on('pageerror', lambda e: page_errors.append(str(e)))

    def route_request(route):
        request = route.request
        parsed = urlparse(request.url)
        if parsed.path in ['/api/home-chat', '/api/tutor']:
            kind = 'home' if parsed.path.endswith('home-chat') else 'tutor'
            if request.method == 'OPTIONS':
                route.fulfill(status=204, headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'})
                return
            require(request.method == 'POST', 'AI must POST')
            data = request.post_data_json
            api_requests.append({'kind': kind, 'data': data})
            status = 200 if reply_mode[kind] == 'ok' else 503
            body = {'reply': 'Phản hồi AI kiểm thử: mạch điện và thuật toán.'} if status == 200 else {'error': 'Dịch vụ AI kiểm thử đang bận.'}
            route.fulfill(status=status, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(body))
        elif parsed.netloc == urlparse(BASE).netloc or parsed.scheme in ['data', 'blob']:
            route.continue_()
        else:
            blocked.add(parsed.netloc)
            route.abort()

    context.route('**/*', route_request)

    def goto(name):
        page.goto(PUBLIC + name, wait_until='domcontentloaded')
        page.evaluate('() => document.fonts.ready.then(() => true)')

    def no_overflow():
        sizes = page.evaluate('''() => ({w: innerWidth, body: document.body.scrollWidth, html: document.documentElement.scrollWidth})''')
        require(max(sizes['body'], sizes['html']) <= sizes['w'] + 1, 'Horizontal page overflow: ' + repr(sizes))
        return sizes

    def home_catalog():
        goto('index.html')
        slides = page.locator('#heroCarousel .hc-slide')
        expect(slides).to_have_count(4)
        expect(page.locator('#heroCarousel .hc-slide.is-active')).to_have_count(1)
        expect(page.locator('#heroCarousel .hc-dot')).to_have_count(4)
        for target in (1, 2, 3, 0):
            page.locator('#heroCarousel [data-hc="next"]').click()
            expect(slides.nth(target)).to_have_class(re.compile(r'.*is-active.*'))
            expect(slides.nth(target)).to_have_attribute('aria-hidden', 'false')
        page.locator('#heroCarousel [data-hc="prev"]').click()
        expect(slides.nth(3)).to_have_attribute('aria-hidden', 'false')
        page.locator('#heroCarousel .hc-dot').nth(1).click()
        expect(slides.nth(1)).to_have_attribute('aria-hidden', 'false')
        page.locator('#heroCarousel .hc-dot').nth(1).press('ArrowRight')
        expect(slides.nth(2)).to_have_attribute('aria-hidden', 'false')
        page.locator('#heroCarousel [data-hc="toggle"]').click()
        expect(page.locator('#heroCarousel [data-hc="toggle"]')).to_have_attribute('aria-pressed', 'true')
        page.locator('#heroCarousel [data-hc="toggle"]').click()
        expect(page.locator('#heroCarousel [data-hc="toggle"]')).to_have_attribute('aria-pressed', 'false')
        expect(page.locator('#featuredCourses .course-card')).to_have_count(3)
        featured = page.locator('#featuredCourses a.course-link').evaluate_all('(links) => links.map(a => new URL(a.href).searchParams.get("course"))')
        require(featured == ['arduino', 'vex-iq', 'microbit'], 'Original featured curriculum entries changed')
        for i in range(3):
            expect(page.locator('#featuredCourses .course-card').nth(i)).to_contain_text('6 bài học')
        goto('hoclieu.html')
        cards = page.locator('#catalogCoursesGrid .course-card')
        expect(cards).to_have_count(5)
        expect(page.locator('#catalogCount')).to_have_text('5 khóa học')
        expected_ids = ['arduino', 'vex-iq', 'microbit', 'lego-spike', 'vex-vr']
        actual_ids = page.locator('#catalogCoursesGrid a.course-link').evaluate_all('(links) => links.map(a => new URL(a.href).searchParams.get("course"))')
        require(actual_ids == expected_ids, 'Catalog must expose all five original learning courses')
        page.locator('#catalogSearch').fill('arduino')
        expect(cards).to_have_count(1)
        expect(cards.first).to_contain_text('Arduino Uno')
        page.locator('#catalogSearch').fill('')
        for course_id in expected_ids:
            page.locator('#catalogCategoryFilter').select_option(course_id)
            expect(cards).to_have_count(1)
            href = page.locator('#catalogCoursesGrid a.course-link').get_attribute('href')
            require(parse_qs(urlparse(href).query).get('course') == [course_id], 'Catalog category selected wrong course')
        page.locator('#catalogCategoryFilter').select_option('')
        page.locator('#catalogSearch').fill('khoa-hoc-khong-ton-tai-987654321')
        expect(cards).to_have_count(0)
        expect(page.locator('#catalogCount')).to_contain_text('Không tìm thấy khóa học phù hợp')
        page.locator('#catalogSearch').fill('')
        expect(cards).to_have_count(5)
        # Follow an actual rendered catalog link into the original lesson application.
        page.locator('#catalogCoursesGrid a.course-link').nth(4).click()
        expect(page.locator('#courseSelect')).to_have_value('vex-vr')
        expect(page.locator('#lessonList button')).to_have_count(6)
        return {'carousel_slides': 4, 'controls': ['next', 'previous', 'dots', 'arrow key', 'pause/resume'], 'featured': 3, 'catalog_courses': 5, 'category_filters': 5, 'search_and_empty_state': True, 'catalog_to_learning': True}

    checked('home carousel and featured courses, full catalog and filters', home_catalog)

    def root_redirects():
        verified = []
        paths = ['index.html', 'gioithieu.html', 'kit.html', 'hoclieu.html', 'quiz.html', 'dangky.html', 'course.learning.html']
        for name in paths:
            page.goto(BASE + '/' + name + '?course=microbit&smoke=retained#smoke-anchor', wait_until='domcontentloaded')
            page.wait_for_url('**/frontend/public/' + name + '**')
            target = urlparse(page.url)
            require(target.path == '/frontend/public/' + name, 'Wrong canonical redirect for ' + name)
            query = parse_qs(target.query)
            require(query.get('course') == ['microbit'] and query.get('smoke') == ['retained'], 'Redirect lost query parameters for ' + name)
            require(target.fragment == 'smoke-anchor', 'Redirect lost hash for ' + name)
            if name == 'course.learning.html':
                expect(page.locator('#courseSelect')).to_have_value('microbit')
                expect(page.locator('#lessonList button')).to_have_count(6)
            else:
                expect(page.locator('#themeToggleBtn')).to_be_visible()
            verified.append(name)
        return {'canonical_redirects': verified, 'course_query_retained': True, 'hash_retained': True}

    checked('seven root entry pages redirect and retain query parameters/hash', root_redirects)

    def responsive_home_catalog():
        layouts = {}
        goto('index.html')
        font_details = page.evaluate('''async () => {
            const weights = [400, 500, 600, 700, 800];
            await Promise.all(weights.map(weight => document.fonts.load(`${weight} 16px "Be Vietnam Pro"`, 'Khóa học tiếng Việt')));
            return {
                family: getComputedStyle(document.body).fontFamily,
                weights: weights.map(weight => ({weight, available: document.fonts.check(`${weight} 16px "Be Vietnam Pro"`)})),
                faces: [...document.fonts].filter(font => font.family.includes('Be Vietnam Pro')).map(font => ({weight: font.weight, status: font.status}))
            };
        }''')
        require('Be Vietnam Pro' in font_details['family'], 'Reference font family is not applied')
        require(all(font['available'] for font in font_details['weights']), 'A local Be Vietnam Pro font weight is unavailable')
        require(len(font_details['faces']) == 5 and all(font['status'] == 'loaded' for font in font_details['faces']), 'Local font faces did not load: ' + repr(font_details))
        for width in [360, 390, 768, 1024, 1280]:
            page.set_viewport_size({'width': width, 'height': 900})
            for name, host, card_count in [('index.html', '#featuredCourses', 3), ('hoclieu.html', '#catalogCoursesGrid', 5)]:
                goto(name)
                expect(page.locator(host + ' .course-card')).to_have_count(card_count)
                expect(page.locator('main')).to_be_visible()
                sizes = no_overflow()
                # The complete card box, including its title and entry action, must fit the viewport.
                bounds = page.locator(host + ' .course-card').evaluate_all('(cards) => cards.map(c => { const r=c.getBoundingClientRect(); return {left:r.left,right:r.right}; })')
                require(all(b['left'] >= -1 and b['right'] <= width + 1 for b in bounds), 'Course card spills outside viewport: ' + repr(bounds))
                layouts[str(width) + ':' + name] = sizes
        page.set_viewport_size({'width': 1440, 'height': 1000})
        return {'local_fonts': font_details, 'responsive_layouts': layouts}

    checked('home and catalog responsive layouts at five viewport widths', responsive_home_catalog)

    def kits():
        goto('kit.html')
        expect(page.locator('.kit-item')).to_have_count(4)
        require(page.locator('.kit-item:visible').count() == 4, 'All original kit cards must initially show')
        page.locator('#kitSearch').fill('arduino')
        page.locator('#kitSearch').press('End')
        expect(page.locator('.kit-item:visible')).to_have_count(1)
        expect(page.locator('.kit-item:visible')).to_contain_text('Arduino')
        page.locator('#kitSearch').fill('')
        page.locator('#kitSearch').press('Backspace')
        expect(page.locator('.kit-item:visible')).to_have_count(4)
        for filter_name, expected_count in [('basic', 2), ('competition', 1), ('creative', 1), ('all', 4)]:
            page.locator('.filter-tab-btn[data-filter="' + filter_name + '"]').click()
            expect(page.locator('.kit-item:visible')).to_have_count(expected_count)
        page.locator('.btn-show-kit-detail[data-id="arduino"]').click()
        expect(page.locator('#kitDetailsModal')).to_be_visible()
        expect(page.locator('#kitDetailsModal')).to_contain_text('ATmega328P')
        # Prefer user-facing close button; native/custom modal may use either selector.
        close = page.locator('#kitDetailsModal button[aria-label*="Đóng"], #kitDetailsModal .btn-close, #kitDetailsModal [data-modal-close]').first
        close.click()
        expect(page.locator('#kitDetailsModal')).to_be_hidden()
        no_overflow()
        return {'original_kits': 4, 'filters': 4, 'modal': 'opened and closed'}

    checked('kit search, filters and original details modal', kits)

    def quiz():
        goto('quiz.html')
        page.locator('#btnInitQuiz').click()
        expect(page.locator('#quizActiveGame')).to_be_visible()
        count = 0
        while page.locator('#quizActiveGame').is_visible() and count < 100:
            expect(page.locator('#targetQuestionPlaceholder')).to_contain_text('Câu hỏi')
            expect(page.locator('#feedbackBox')).to_be_hidden()
            expect(page.locator('#forwardBtn')).to_be_hidden()
            options = page.locator('#answerOptionsArea button')
            require(options.count() >= 2, 'Quiz options missing')
            options.first.click()
            expect(page.locator('#feedbackBox')).to_be_visible()
            expect(page.locator('#forwardBtn')).to_be_visible()
            count += 1
            page.locator('#forwardBtn').click()
        require(0 < count < 100, 'Quiz failed to finish with actual questions')
        expect(page.locator('#quizSummaryArea')).to_be_visible()
        expect(page.locator('#totalScoreText')).to_contain_text('/ ' + str(count))
        page.locator('#btnRestartQuiz').click()
        expect(page.locator('#quizActiveGame')).to_be_visible()
        expect(page.locator('#targetQuestionPlaceholder')).to_contain_text('Câu hỏi 1:')
        # Complete restarted round so intro return is exercised through visible UI.
        for _ in range(count):
            page.locator('#answerOptionsArea button').first.click()
            page.locator('#forwardBtn').click()
        page.locator('#btnBackIntro').click()
        expect(page.locator('#quizIntroArea')).to_be_visible()
        no_overflow()
        return {'questions_per_round': count, 'completed_rounds': 2, 'intro_return': True}

    checked('quiz complete round, feedback, restart and intro return', quiz)

    def registration():
        goto('dangky.html')
        enter = page.locator('#enterCourseLink')
        expect(enter).to_be_hidden()
        page.locator('#registerForm button[type=submit]').click()
        expect(enter).to_be_hidden()
        form = page.locator('#registerForm')
        fields = form.locator('input[required]')
        require(fields.count() >= 2, 'Original name/contact form fields missing')
        fields.nth(0).fill('Học viên kiểm thử')
        fields.nth(1).fill('student@example.invalid')
        for course in ['arduino', 'vex-iq', 'lego-spike']:
            form.locator('select').select_option(course)
            expect(enter).to_be_hidden()
            form.locator('button[type=submit]').click()
            expect(enter).to_be_visible()
            expect(page.locator('#submissionSuccessMsg')).to_be_visible()
            require('course=' + course in enter.get_attribute('href'), 'Wrong course entry link')
        fields.nth(0).fill('Học viên đã sửa')
        expect(enter).to_be_hidden()
        no_overflow()
        return {'original_course_entries': 3, 'native_validation': True, 'edit_hides_entry': True}

    checked('registration validation and course entry links', registration)

    def home_ai():
        goto('index.html')
        page.locator('#chatTriggerBtn').click()
        expect(page.locator('#supportChatWindow')).to_be_visible()
        page.locator('#chatInputField').fill('Giải thích mạch điện?')
        page.locator('#chatSubmitBtn').click()
        expect(page.locator('#chatMessageContainer')).to_contain_text('Phản hồi AI kiểm thử')
        home_requests = [x['data'] for x in api_requests if x['kind'] == 'home']
        require(home_requests[-1]['question'] == 'Giải thích mạch điện?', 'Home AI payload changed')
        require(home_requests[-1]['history'] == [], 'Initial AI history should be empty')
        page.locator('.chat-quick-query').first.click()
        expect(page.locator('#chatSubmitBtn')).to_be_enabled()
        page.wait_for_function('document.querySelectorAll("#chatMessageContainer .msg").length >= 5')
        home_requests = [x['data'] for x in api_requests if x['kind'] == 'home']
        require(len(home_requests[-1]['history']) == 2, 'Home AI follow-up history lost')
        reply_mode['home'] = 'error'
        page.locator('#chatInputField').fill('Câu hỏi khi dịch vụ bận')
        page.locator('#chatSubmitBtn').click()
        expect(page.locator('#chatMessageContainer')).to_contain_text('Dịch vụ AI kiểm thử đang bận.')
        expect(page.locator('#chatSubmitBtn')).to_be_enabled()
        expect(page.locator('#chatInputField')).to_have_value('Câu hỏi khi dịch vụ bận')
        page.locator('#chatCloseBtn').click()
        expect(page.locator('#supportChatWindow')).to_be_hidden()
        reply_mode['home'] = 'ok'
        return {'mocked_requests': len(home_requests) + 1, 'history': True, 'error_recovery': True}

    checked('home AI request, history, quick query, error recovery and closing', home_ai)

    def learning():
        goto('course.learning.html?course=arduino')
        expect(page.locator('#lessonList button')).to_have_count(6)
        expected_ids = ['arduino', 'vex-iq', 'microbit', 'lego-spike', 'vex-vr']
        data = page.evaluate('COURSES')
        require([c['id'] for c in data] == expected_ids, 'Original five courses changed')
        require(all(len(c['lessons']) == 6 for c in data), 'Original six lessons per course changed')
        checks = 0
        code_variants_checked = 0
        for c in data:
            page.locator('#courseSelect').select_option(c['id'])
            expect(page.locator('#lessonList button')).to_have_count(6)
            for i, lesson_data in enumerate(c['lessons']):
                page.locator('#lessonList button').nth(i).click()
                expect(page.locator('#lessonTitle')).to_have_text(lesson_data['title'])
                require(page.locator('#theoryContent').inner_text().strip(), 'Missing lesson theory')
                lesson_key = c['id'] + '/' + lesson_data['id']
                required_sections = ['objectives', 'concepts', 'example', 'misconceptions', 'self-check', 'sources']
                for name in required_sections:
                    expect(page.locator('#theoryContent [data-theory-section="' + name + '"]')).to_have_count(1)
                require(len(lesson_data['objectives']) >= 2, 'Lesson lacks measurable objectives: ' + lesson_key)
                objectives = page.locator('#theoryContent [data-theory-section="objectives"]').text_content()
                for objective in lesson_data['objectives']:
                    require(objective in objectives, 'Learning objective was not rendered: ' + lesson_key)
                require(len(lesson_data['concepts']) >= 2, 'Lesson lacks structured explanation: ' + lesson_key)
                concepts = readable_text(page.locator('#theoryContent [data-theory-section="concepts"]').text_content())
                for concept in lesson_data['concepts']:
                    require(readable_text(concept['title']) in concepts, 'Concept heading missing: ' + lesson_key)
                    require(readable_text(concept['body']) in concepts, 'Concept explanation missing: ' + lesson_key)
                for field, section in [('example', 'example'), ('misconceptions', 'misconceptions'), ('selfCheck', 'self-check')]:
                    values = lesson_data[field] if isinstance(lesson_data[field], list) else [lesson_data[field]]
                    require(values, 'Missing practical teaching section: ' + lesson_key + '/' + section)
                    rendered = readable_text(page.locator('#theoryContent [data-theory-section="' + section + '"]').text_content())
                    for value in values:
                        require(readable_text(value) in rendered, 'Teaching content did not render: ' + lesson_key + '/' + section)
                source_links = page.locator('#theoryContent [data-theory-section="sources"] a')
                expect(source_links).to_have_count(len(lesson_data['sources']))
                require(source_links.count() >= 1, 'Lesson has no reference material: ' + lesson_key)
                for index, source in enumerate(lesson_data['sources']):
                    href = source_links.nth(index).get_attribute('href')
                    require(href == source['url'] and urlparse(href).scheme == 'https', 'Invalid reference URL: ' + lesson_key)
                    require(not re.search(r'youtu(?:be|\.be)', href, re.I), 'YouTube is not allowed in teaching references')
                require(page.locator('#sampleCodeBox').text_content() == lesson_data['code'], 'Primary sample code did not load/reset: ' + lesson_key)
                selector = page.locator('#codeVariantSelect')
                variants = lesson_data.get('codeVariants', [])
                if c['id'] == 'microbit':
                    require(any('micropython' in v['lang'].casefold() for v in variants), 'This micro:bit lesson lacks a MicroPython alternative: ' + lesson_key)
                if variants:
                    expect(selector).to_be_visible()
                    expect(selector).to_have_value('primary')
                    for variant in variants:
                        selector.select_option(variant['id'])
                        require(page.locator('#sampleCodeBox').text_content() == variant['code'], 'Selected code dialect did not render: ' + lesson_key + '/' + variant['id'])
                        expect(page.locator('#codeLangLabel')).to_have_text(variant['lang'])
                        # Intercept the clipboard at its browser API boundary; no OS permissions are needed.
                        page.evaluate('''() => {
                            window.__copiedSample = null;
                            Object.defineProperty(navigator, 'clipboard', {
                                configurable: true,
                                value: { writeText: async text => { window.__copiedSample = text; } }
                            });
                        }''')
                        page.locator('button[onclick="copySampleCode()"]').click()
                        require(page.evaluate('window.__copiedSample') == variant['code'], 'Copy used the wrong selected code: ' + lesson_key)
                        code_variants_checked += 1
                    # Keep the variant selected so the next lesson also verifies primary reset.
                else:
                    expect(selector).to_be_hidden()
                require(page.locator('#quizOptions input').count() >= 2, 'Missing lesson quiz')
                require('lesson=' + lesson_data['id'] in page.url, 'Lesson deep link lost')
                checks += 1
            page.locator('#tabBtnLab').click()
            expect(page.locator('#labView')).to_be_visible()
            expect(page.locator('#theoryView')).to_be_hidden()
            page.locator('#labButtons button').last.click()
            expect(page.locator('#localLab')).to_be_visible()
            require(page.locator('#benchCanvas').count() == 1, 'Local bench canvas missing')
            require(page.locator('#benchResult').inner_text().strip(), 'Local bench did not execute')
            require('Lỗi' not in page.locator('#benchResult').inner_text(), 'Initial local bench error')
            page.locator('#localLab button').last.click()
            require(page.locator('#benchResult').inner_text().strip(), 'Local bench run result missing')
            page.locator('#tabBtnTheory').click()
            expect(page.locator('#theoryView')).to_be_visible()
            expect(page.locator('#labView')).to_be_hidden()
        require(code_variants_checked >= 6, 'MicroPython alternatives are missing from some micro:bit lessons')
        return {'original_courses': len(data), 'rendered_lessons': checks, 'structured_theory_lessons': checks, 'code_variants_rendered_and_copied': code_variants_checked, 'official_reference_links': sum(len(l['sources']) for c in data for l in c['lessons']), 'interactive_local_benches': len(data)}

    checked('all original learning courses, lesson content, tabs and local lab benches', learning)

    def lab_platforms():
        goto('course.learning.html?course=arduino')
        registry = page.evaluate('window.STROBOT_LAB_PLATFORMS')
        assignments = page.evaluate('window.STROBOT_COURSE_LABS')
        original_urls = {
            'circuit': 'https://www.falstad.com/circuit/circuitjs.html',
            'avr': 'https://www.falstad.com/circuit/avr8js/',
            'makecode': 'https://makecode.microbit.org/#editor',
            'gears': 'https://gears.aposteriori.com.sg/'
        }
        defaults = {'arduino': 'avr', 'microbit': 'makecode', 'vex-iq': 'gears', 'lego-spike': 'gears', 'vex-vr': 'gears'}
        additions = {'wokwi', 'phet', 'scratch', 'arcade'}
        require(set(registry) == set(original_urls) | additions | {'local'}, 'Original labs or official embed additions missing; external-only editor added')
        for key, url in original_urls.items():
            require(registry[key]['url'] == url and registry[key]['mode'] == 'embed', 'Original lab changed: ' + key)
            require(registry[key]['embedSupport'] == 'existing', 'Original lab can be disabled by a new verification gate: ' + key)
        # Local fixture tests the iframe integration only, not provider availability.
        # There are no live external requests or paid AI calls in this suite.
        frame_urls = {cfg.get('embedUrl') or cfg.get('url') for cfg in registry.values() if cfg['mode'] == 'embed'}
        def iframe_fixture(route):
            request = route.request
            if request.resource_type == 'document' and request.frame.parent_frame is not None and request.url.split('#')[0] in {u.split('#')[0] for u in frame_urls}:
                route.fulfill(status=200, content_type='text/html', body='<html><title>Lab integration fixture</title><body><canvas id="labFixture"></canvas></body></html>')
            else:
                route.fallback()
        page.route('**/*', iframe_fixture)
        popups = []
        on_popup = lambda popup: popups.append(popup)
        page.on('popup', on_popup)
        checks = 0
        for course_id, keys in assignments.items():
            require(len(keys) >= 4 and len(set(keys)) == len(keys) and keys[-1] == 'local', 'Missing course lab choices: ' + course_id)
            page.locator('#courseSelect').select_option(course_id)
            page.locator('#tabBtnLab').click()
            default = defaults[course_id]
            expect(page.locator('#practiceFrame')).to_have_attribute('src', original_urls[default])
            expect(page.locator('#labButtons button[data-lab-key="' + default + '"]')).to_have_attribute('aria-pressed', 'true')
            expect(page.locator('#localLab')).to_be_hidden()
            expect(page.locator('#labExternalBtn, #labActivity, #labProviderDocs, #labBoxDesc, #frameNote')).to_have_count(0)
            expect(page.locator('#labView a')).to_have_count(0)
            require('Hướng dẫn nền tảng' not in page.locator('#labView').inner_text(), 'Platform help returned')
            expect(page.locator('#labButtons button')).to_have_count(len(keys))
            for key in keys:
                cfg = registry[key]
                button = page.locator('#labButtons button[data-lab-key="' + key + '"]')
                button.click()
                expect(button).to_have_attribute('aria-pressed', 'true')
                expect(page.locator('#labButtons button[aria-pressed="true"]')).to_have_count(1)
                if key == 'local':
                    expect(page.locator('#localLab')).to_be_visible()
                    expect(page.locator('#practiceFrame')).to_have_count(0)
                    require(page.locator('#benchResult').inner_text().strip(), 'In-page bench did not run')
                else:
                    frame = page.locator('#practiceFrame')
                    expect(frame).to_have_attribute('src', cfg.get('embedUrl') or cfg['url'])
                    expect(frame).to_have_attribute('title', cfg['name'])
                    expect(frame).to_have_attribute('allow', 'fullscreen; clipboard-write')
                    if key in original_urls:
                        require(frame.get_attribute('sandbox') is None, 'New restrictions changed the original iframe: ' + key)
                    else:
                        require(cfg['embedSupport'] == 'official' and cfg['embedUrl'].startswith('https://'), 'New platform lacks official embed route')
                        permissions = set((frame.get_attribute('sandbox') or '').split())
                        require('allow-scripts' in permissions, 'Embedded simulator cannot execute')
                        require(not permissions.intersection({'allow-popups', 'allow-popups-to-escape-sandbox', 'allow-top-navigation', 'allow-top-navigation-by-user-activation'}), 'New lab opens another tab or leaves the website')
                    page.locator('#labReloadBtn').click()
                    expect(page.locator('#practiceFrame')).to_have_attribute('src', cfg.get('embedUrl') or cfg['url'])
                checks += 1
            # The next lesson must reopen the original lab, rather than replacing it with a local-only screen.
            page.locator('#lessonList button').nth(1).click()
            page.locator('#tabBtnLab').click()
            expect(page.locator('#practiceFrame')).to_have_attribute('src', original_urls[default])
        page.locator('#courseSelect').select_option('arduino')
        page.locator('#tabBtnLab').click()
        original = page.evaluate('JSON.parse(JSON.stringify(labs.wokwi))')
        page.evaluate("labs.wokwi.mode='external';renderLabButtons();selectLabPlatform('wokwi')")
        expect(page.locator('#labButtons button[data-lab-key="wokwi"]')).to_have_count(0)
        expect(page.locator('#labExternalBtn')).to_have_count(0)
        page.evaluate("labs.wokwi.mode='embed';labs.wokwi.embedSupport='unknown';renderLabButtons()")
        expect(page.locator('#labButtons button[data-lab-key="wokwi"]')).to_have_count(0)
        page.evaluate('(cfg)=>{labs.wokwi=cfg;renderLabButtons()}', original)
        page.locator('#labButtons button[data-lab-key="wokwi"]').click()
        page.locator('#practiceFrame').dispatch_event('error')
        expect(page.locator('#labButtons button[data-lab-key="wokwi"]')).to_have_count(0)
        expect(page.locator('#practiceFrame')).to_have_attribute('src', original_urls['avr'])
        page.evaluate('(cfg)=>{labs.wokwi=cfg;renderLabButtons()}', original)
        require(len(popups) == 0, 'A lab choice opened a separate tab')
        page.remove_listener('popup', on_popup)
        page.set_viewport_size({'width': 390, 'height': 844})
        mobile_layouts = {}
        for course_id in assignments:
            page.locator('#courseSelect').select_option(course_id)
            page.locator('#tabBtnLab').click()
            mobile_layouts[course_id] = no_overflow()
        page.set_viewport_size({'width': 1440, 'height': 1000})
        page.unroute('**/*', iframe_fixture)
        return {'original_platforms_restored': 4, 'original_course_defaults_restored': 5, 'official_embed_additions': 4, 'selections_checked': checks, 'external_editor_choices': 0, 'popups': 0, 'failed_addition_returns_to_original_lab': True, 'mobile_lab_layouts': mobile_layouts, 'live_provider_availability': 'not tested; iframe integration uses local fixtures'}

    checked('original labs/defaults restored, official embeds added, no external-tab fallback', lab_platforms)

    def persistence_pdf():
        goto('course.learning.html?course=arduino')
        page.evaluate('localStorage.removeItem("strobot.original.course.v3")')
        page.reload(wait_until='domcontentloaded')
        page.locator('button[onclick="markLessonComplete()"]').first.click()
        expect(page.locator('#notice')).to_contain_text('Cần trả lời đúng')
        answer = page.evaluate('lesson().answer')
        page.locator('#quizOptions input[value="' + str(answer) + '"]').check()
        page.locator('#quizForm button[type=submit]').click()
        expect(page.locator('#quizFeedback')).to_contain_text('Đúng.')
        page.locator('button[onclick="markLessonComplete()"]').first.click()
        expect(page.locator('#notice')).to_contain_text('60 ký tự')
        note = 'Đầu vào: điện trở 330 ohm. Dự đoán: dòng nhỏ. Kết quả: LED sáng. Giải thích: điện trở giới hạn dòng điện.'
        page.locator('#journal').fill(note)
        expect(page.locator('#saveNotice')).to_contain_text('Đã lưu')
        page.reload(wait_until='domcontentloaded')
        expect(page.locator('#journal')).to_have_value(note)
        expect(page.locator('#quizOptions input[value="' + str(answer) + '"]')).to_be_checked()
        page.locator('button[onclick="markLessonComplete()"]').first.click()
        expect(page.locator('#progressText')).to_contain_text('1/6')
        page.reload(wait_until='domcontentloaded')
        expect(page.locator('#progressText')).to_contain_text('1/6')
        page.locator('button[onclick="openPdfModal()"]').first.click()
        expect(page.locator('#pdfModal')).to_be_visible()
        require(page.locator('#pdfDocBody iframe').get_attribute('src').startswith('blob:'), 'PDF viewer missing actual generated blob')
        with page.expect_download() as info:
            page.locator('#downloadPdf').click()
        download = info.value
        require(download.suggested_filename == 'arduino-giao-trinh-6-bai.pdf', 'Wrong PDF filename')
        pdf = pathlib.Path(download.path()).read_bytes()
        require(pdf.startswith(b'%PDF-') and len(pdf) > 10000, 'PDF is not a real populated document')
        page.keyboard.press('Escape')
        expect(page.locator('#pdfModal')).to_be_hidden()
        with page.expect_download() as info:
            page.locator('#exportNotes').click()
        notes = json.loads(pathlib.Path(info.value.path()).read_text())
        require(notes['course'] == 'arduino' and any(r.get('note') == note for r in notes['records'].values()), 'Journal export lost original note')
        return {'quiz_and_note_gates': True, 'reload_persistence': True, 'pdf_bytes': len(pdf), 'notes_export': True}

    checked('learning completion gates, persisted journal, actual PDF and notes export', persistence_pdf)

    def curriculum_pdfs():
        goto('course.learning.html?course=arduino')
        curriculum = page.evaluate('COURSES')
        documents = {}
        checked_lessons = 0
        for current in curriculum:
            page.locator('#courseSelect').select_option(current['id'])
            page.locator('button[onclick="openPdfModal()"]').first.click()
            expect(page.locator('#pdfModal')).to_be_visible()
            with page.expect_download() as info:
                page.locator('#downloadPdf').click()
            download = info.value
            require(download.suggested_filename == current['id'] + '-giao-trinh-6-bai.pdf', 'PDF belongs to a different course')
            raw = pathlib.Path(download.path()).read_bytes()
            require(raw.startswith(b'%PDF-'), 'Missing PDF signature for ' + current['id'])
            reader = PdfReader(io.BytesIO(raw))
            extracted = readable_text('\n'.join(p.extract_text() or '' for p in reader.pages))
            require(len(reader.pages) >= 6, 'PDF lacks the six full lessons: ' + current['id'])
            require(readable_text(current['name']) in extracted, 'PDF course heading missing')
            for item in current['lessons']:
                context_name = current['id'] + '/' + item['id']
                require(readable_text(item['title']) in extracted, 'PDF omits lesson title: ' + context_name)
                # Read the downloaded PDF, rather than trusting a generated filename or a size.
                require(readable_text(item['objectives'][0]) in extracted, 'PDF has stale/missing objectives: ' + context_name)
                for concept in item['concepts']:
                    require(readable_text(concept['title']) in extracted, 'PDF misses a concept: ' + context_name)
                    excerpt = readable_text(concept['body'])[:100]
                    require(excerpt in extracted, 'PDF theory does not match the current lesson: ' + context_name)
                require(readable_text(item['selfCheck'][0]) in extracted, 'PDF misses self-check: ' + context_name)
                require(readable_text(item['sources'][0]['title']) in extracted, 'PDF misses official reference: ' + context_name)
                checked_lessons += 1
            documents[current['id']] = {'pages': len(reader.pages), 'bytes': len(raw), 'readable_characters': len(extracted)}
            page.keyboard.press('Escape')
            expect(page.locator('#pdfModal')).to_be_hidden()
        return {'downloaded_documents': documents, 'updated_lessons_verified': checked_lessons, 'vietnamese_text_extracted': True}

    checked('all course PDFs contain the current Vietnamese lesson content', curriculum_pdfs)

    def tutor_ai():
        goto('course.learning.html?course=microbit')
        page.locator('#tutorQuestion').fill('Giải thích lệnh trong bài?')
        page.locator('#tutorSend').click()
        expect(page.locator('#tutorMessages')).to_contain_text('Phản hồi AI kiểm thử')
        reqs = [x['data'] for x in api_requests if x['kind'] == 'tutor']
        require(reqs[-1]['course'] == 'microbit' and reqs[-1]['lesson'], 'Tutor course/lesson context missing')
        require(reqs[-1]['history'] == [], 'New tutor session should have no history')
        page.locator('#tutorQuestion').fill('Cho ví dụ?')
        page.locator('#tutorSend').click()
        expect(page.locator('#tutorSend')).to_be_enabled()
        expect(page.locator('#tutorMessages .chat-message')).to_have_count(4)
        reqs = [x['data'] for x in api_requests if x['kind'] == 'tutor']
        require(len(reqs[-1]['history']) == 2, 'Tutor history lost')
        page.locator('#lessonList button').nth(1).click()
        expect(page.locator('#tutorMessages')).to_be_empty()
        page.locator('#tutorQuestion').fill('Câu hỏi bài mới')
        page.locator('#tutorSend').click()
        expect(page.locator('#tutorMessages')).to_contain_text('Phản hồi AI kiểm thử')
        reqs = [x['data'] for x in api_requests if x['kind'] == 'tutor']
        require(reqs[-1]['history'] == [], 'Tutor context must reset after lesson change')
        page.locator('#tutorReset').click()
        expect(page.locator('#tutorMessages')).to_be_empty()
        reply_mode['tutor'] = 'error'
        page.locator('#tutorQuestion').fill('Dịch vụ bận')
        page.locator('#tutorSend').click()
        expect(page.locator('#tutorStatus')).to_contain_text('Dịch vụ AI kiểm thử đang bận.')
        expect(page.locator('#tutorSend')).to_be_enabled()
        expect(page.locator('#tutorQuestion')).to_have_value('Dịch vụ bận')
        reply_mode['tutor'] = 'ok'
        return {'mocked_requests': len(reqs) + 1, 'lesson_context': True, 'history': True, 'reset': True, 'error_recovery': True}

    checked('learning AI tutor context, history, lesson reset and error recovery', tutor_ai)

    def mobile():
        page.set_viewport_size({'width': 390, 'height': 844})
        goto('kit.html')
        expect(page.locator('#navToggle')).to_be_visible()
        page.locator('#navToggle').click()
        expect(page.locator('#mainNavbar')).to_be_visible()
        expect(page.locator('#navToggle')).to_have_attribute('aria-expanded', 'true')
        page.keyboard.press('Escape')
        expect(page.locator('#navToggle')).to_have_attribute('aria-expanded', 'false')
        page.locator('#themeToggleBtn').click()
        require(page.locator('body').evaluate('(el) => el.classList.contains("dark-mode")'), 'Theme button did not switch to dark')
        page.reload(wait_until='domcontentloaded')
        require(page.locator('body').evaluate('(el) => el.classList.contains("dark-mode")'), 'Dark theme did not survive reload')
        page.locator('#themeToggleBtn').click()
        require(not page.locator('body').evaluate('(el) => el.classList.contains("dark-mode")'), 'Theme did not switch back to light')
        layouts = {}
        for name in ['index.html', 'gioithieu.html', 'kit.html', 'quiz.html', 'dangky.html', 'course.learning.html?course=arduino']:
            goto(name)
            if name.startswith('course.learning'):
                expect(page.locator('#lessonList button')).to_have_count(6)
            else:
                expect(page.locator('#themeToggleBtn')).to_be_visible()
            layouts[name] = no_overflow()
        page.set_viewport_size({'width': 1440, 'height': 1000})
        return {'mobile_menu': True, 'theme_persists': True, 'viewport': 390, 'no_horizontal_overflow': layouts}

    checked('mobile menu, persistent theme and page overflow', mobile)
    browser.close()

summary = {'checks': results, 'passed': sum(r['status'] == 'passed' for r in results), 'failed': sum(r['status'] == 'failed' for r in results), 'external_hosts_blocked': sorted(blocked), 'uncaught_page_errors': page_errors, 'ai_requests_mocked': len(api_requests), 'live_ai_requests': 0}
pathlib.Path(args.output).write_text(json.dumps(summary, ensure_ascii=False, indent=2))
print(json.dumps({'passed': summary['passed'], 'failed': summary['failed'], 'results': args.output}, ensure_ascii=False))
sys.exit(1 if summary['failed'] else 0)
