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
AI_ORIGIN = 'https://st-robot-1.onrender.com'
results = []
api_requests = []
health_requests = []
blocked = set()
page_errors = []
reply_mode = {'home': 'ok', 'tutor': 'ok'}


def require(value, message):
    if not value:
        raise AssertionError(message)


def readable_text(value):
    """Ignore layout whitespace while retaining Vietnamese diacritics and words."""
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFC', value)).strip().casefold()


def resolve_question(page, question_id, bank):
    if question_id not in bank:
        question = page.evaluate('''async id => {
            const {resolveGeneratedQuestion} = await import(new URL('../src/modules/quiz/generation/QuestionEngine.js', location.href));
            return resolveGeneratedQuestion(id);
        }''', question_id)
        require(question is not None and question['id'] == question_id,
                'Active question has no reproducible canonical answer: ' + str(question_id))
        bank[question_id] = question
    return bank[question_id]


def open_quiz_progress(page):
    details = page.locator('#quizProgressDetails')
    if details.get_attribute('open') is None:
        details.locator(':scope > summary').click()


def active_platform_guide(page):
    return page.evaluate('''() => window.STROBOT_PLATFORM_GUIDE({
        course, lesson: lesson(), platformKey: frameKey || defaultLabKey(),
        level: document.getElementById('learningLevel').value
    })''')


def check_platform_guide(page, copy_examples=False):
    """A platform change must update the actual task and runnable code together."""
    guide = active_platform_guide(page)
    key = guide['id']
    expect(page.locator('#practiceTitle')).to_have_text(guide['title'])
    expect(page.locator('#exercise')).to_have_text(guide['goal'])
    expect(page.locator('#platformCapability')).to_have_text(guide['capability'])
    label = 'Hoạt động bổ trợ' if guide['activityType'] == 'related' else 'Thực hành bài học'
    expect(page.locator('#activePlatformLabel')).to_contain_text(label)
    require(guide['activityType'] in ['primary', 'related'], 'Unlabelled platform activity: ' + key)
    for field, selector in [('setupSteps', '#platformSetupSteps'), ('steps', '#practiceSteps'),
                            ('expected', '#platformExpected'), ('troubleshooting', '#platformTroubleshooting')]:
        require(guide[field], 'Empty platform guidance: ' + key + '/' + field)
        expect(page.locator(selector + ' > li')).to_have_text(guide[field])
    expect(page.locator('#labGuide')).to_have_text(guide['levelChallenge'])
    expect(page.locator('#platformEvidencePrompt')).to_have_text(' '.join(guide['evidence']))
    examples = guide['codeExamples']
    selector = page.locator('#codeVariantSelect')
    expect(selector.locator('option')).to_have_count(len(examples))
    require(selector.locator('option').evaluate_all('(options) => options.map(option => option.value)') ==
            [example['id'] for example in examples], 'Wrong code environments: ' + key)
    if not examples:
        expect(page.locator('#sampleCodeDetails')).to_be_hidden()
        expect(page.locator('#sampleCodeBox')).to_be_empty()
        expect(selector).to_be_hidden()
        return 0
    expect(page.locator('#sampleCodeDetails')).to_be_visible()
    if page.locator('#sampleCodeDetails').get_attribute('open') is None:
        page.locator('#sampleCodeDetails > summary').click()
    expect(page.locator('#sampleCodeBox')).to_have_attribute('translate', 'no')
    expect(selector).to_have_value(examples[0]['id'])
    if len(examples) > 1:
        expect(selector).to_be_visible()
    else:
        expect(selector).to_be_hidden()
    copied = 0
    for example in examples:
        if len(examples) > 1:
            selector.select_option(example['id'])
        require(page.locator('#sampleCodeBox').text_content() == example['code'], 'Wrong selected platform code: ' + key + '/' + example['id'])
        expect(page.locator('#codeLangLabel')).to_have_text(example['lang'])
        if guide['platformKey'] == 'python':
            require('MicroPython' in example['lang'] and 'from microbit import' in example['code'],
                    'Python Editor received a different dialect: ' + key)
            require(not re.search(r'\bbasic\.|\binput\.onButtonPressed', example['code']), 'MakeCode JavaScript appeared under MicroPython: ' + key)
        if copy_examples:
            page.evaluate('''() => {
                window.__copiedSample = null;
                Object.defineProperty(navigator, 'clipboard', {
                    configurable: true,
                    value: { writeText: async text => { window.__copiedSample = text; } }
                });
            }''')
            page.locator('button[onclick="copySampleCode()"]').click()
            require(page.evaluate('window.__copiedSample') == example['code'], 'Copy used the wrong selected platform code: ' + key)
            copied += 1
    return copied


def check_learning_guide(page, lesson_data):
    guide = lesson_data.get('learningGuide')
    require(guide is not None, 'Missing expanded explanation: ' + lesson_data['id'])
    host = page.locator('#learningGuideContent')
    expect(host).to_be_visible()
    require(readable_text(guide['intro']) in readable_text(host.inner_text()), 'Expanded introduction did not render')
    for section in ['analogy', 'vocabulary', 'case', 'checkpoints', 'support']:
        expect(host.locator('[data-guide-section="' + section + '"]')).to_have_count(1)
    analogy = host.locator('[data-guide-section="analogy"]')
    for field in ['familiar', 'meaning', 'limit']:
        require(readable_text(guide['analogy'][field]) in readable_text(analogy.inner_text()), 'Missing analogy or its limit')
    require(len(guide['vocabulary']) >= 3, 'Expanded explanation needs defined vocabulary')
    for entry in guide['vocabulary']:
        require(entry['term'] in host.locator('[data-guide-section="vocabulary"]').inner_text() and
                entry['definition'] in host.locator('[data-guide-section="vocabulary"]').inner_text(), 'Vocabulary definition did not render')
    worked = guide['workedCase']
    require(len(worked['steps']) >= 3, 'Worked explanation needs intermediate reasoning')
    expect(host.locator('.learning-guide-case-steps > li')).to_have_count(len(worked['steps']))
    case_text = readable_text(host.locator('[data-guide-section="case"]').inner_text())
    for value in [worked['title'], worked['input'], worked['output'], worked['why']] + [item for step in worked['steps'] for item in [step['title'], step['explanation']]]:
        require(readable_text(value) in case_text, 'Worked case lost a reasoning step or conclusion')
    checkpoints = host.locator('.learning-guide-checkpoint')
    expect(checkpoints).to_have_count(len(guide['checkpoints']))
    require(checkpoints.count() >= 2, 'Expanded explanation needs comprehension checks')
    for index, checkpoint in enumerate(guide['checkpoints']):
        card = checkpoints.nth(index)
        expect(card).to_contain_text(checkpoint['question'])
        reveal = card.locator('details')
        require(reveal.get_attribute('open') is None, 'Comprehension answer should initially be hidden')
        reveal.locator('summary').click()
        expect(reveal).to_contain_text(checkpoint['answer'])
    bodies = set()
    for level in ['beginner', 'intermediate', 'advanced']:
        page.locator('#learningLevel').select_option(level)
        expect(host).to_have_attribute('data-learning-level', level)
        expect(page.locator('#labGuide')).to_have_text(active_platform_guide(page)['levelChallenge'])
        support = guide['levelSupport'][level]
        bodies.add(support['body'])
        current = host.locator('.learning-guide-deeper' if level == 'advanced' else '.learning-guide-level')
        for field in ['title', 'body', 'task']:
            expect(current).to_contain_text(support[field])
        require((host.locator('.learning-guide-deeper').get_attribute('open') is not None) == (level == 'advanced'),
                'Advanced reading disclosure did not follow the selected level')
    require(len(bodies) == 3, 'Learning levels repeat the same explanation')
    page.locator('#learningLevel').select_option('beginner')


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
    finally:
        # Keep a failed assertion in one fixture group from changing the next group.
        fixtures['stale_registry'] = None
        fixtures['frame_urls'] = set()
        fixtures['popup_urls'] = set()
        held = fixtures.get('held_tutor')
        if held is not None:
            try:
                held.fulfill(status=503, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body='{"error":"Fixture released"}')
            except Exception:
                pass
            fixtures['held_tutor'] = None


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    page = context.new_page()
    page.set_default_timeout(7000)
    page.on('pageerror', lambda e: page_errors.append(str(e)))

    # One route handler owns every request. Fixture state changes between groups;
    # page/context fallback layers can otherwise race during iframe replacement.
    fixtures = {'stale_registry': None, 'stale_registry_requests': [], 'frame_urls': set(), 'popup_urls': set()}

    def route_request(route):
        request = route.request
        parsed = urlparse(request.url)
        request_url = request.url.split('#', 1)[0]
        if fixtures['stale_registry'] is not None and parsed.path.endswith('/src/data/lab-platforms.js'):
            fixtures['stale_registry_requests'].append(request.url)
            route.fulfill(status=200, content_type='text/javascript', body=fixtures['stale_registry'])
            return
        if request.resource_type == 'document' and request_url in fixtures['popup_urls']:
            route.fulfill(status=200, content_type='text/html', body='<html><title>Full-page lab fixture</title><body>Lab</body></html>')
            return
        if request.resource_type == 'document' and request_url in fixtures['frame_urls']:
            route.fulfill(status=200, content_type='text/html', body='<html><title>Lab integration fixture</title><body><canvas id="labFixture"></canvas></body></html>')
            return
        if parsed.path == '/health' and f'{parsed.scheme}://{parsed.netloc}' == AI_ORIGIN:
            require(request.method == 'GET', 'AI readiness must use GET without consuming an AI completion')
            health_requests.append(request.url)
            route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'},
                          body=json.dumps({'ok': True, 'ai': {'keyConfigured': True, 'modelConfigured': True}}))
            return
        if parsed.path in ['/api/home-chat', '/api/tutor']:
            require(f'{parsed.scheme}://{parsed.netloc}' == AI_ORIGIN,
                    'Chat/tutor contacted the wrong AI service: ' + request.url)
            kind = 'home' if parsed.path.endswith('home-chat') else 'tutor'
            if request.method == 'OPTIONS':
                route.fulfill(status=204, headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'})
                return
            require(request.method == 'POST', 'AI must POST')
            data = request.post_data_json
            api_requests.append({'kind': kind, 'data': data, 'url': request.url})
            if kind == 'tutor' and reply_mode[kind] == 'hold':
                fixtures['held_tutor'] = route
                return
            status = 200 if reply_mode[kind] == 'ok' else 503
            body = {'reply': 'Phản hồi AI kiểm thử: mạch điện và thuật toán.'} if status == 200 else {
                'error': 'Dịch vụ AI kiểm thử đang bận.', 'code': 'AI_UNAVAILABLE', 'upstreamStatus': 503,
                'providerCode': 'private-invalid-provider-detail', 'requestId': '11111111-2222-4333-8444-555555555555',
                'stage': 'provider', 'privateProviderBody': 'private-provider-body-never-show',
                'model': 'private-model-name', 'candidateIds': ['private-candidate-id'],
                'catalog': [{'id': 'private-catalog-model-id'}], 'apiKey': 'private-key-never-copy',
                'question': data.get('question'), 'history': [{'content': 'private-history-never-copy'}],
                **fixtures.get('tutor_error_metadata', {'catalogStatus': 503, 'catalogResult': 'http_error',
                                                      'candidateCount': 0, 'fallbackAttempted': False})
            }
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
        expect(page.locator('#catalogCount')).to_contain_text('0 khóa học phù hợp')
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
        page.evaluate('''() => {
            localStorage.removeItem('strobot.quiz.history.v1');
            localStorage.removeItem('strobot.review.evidence.v1');
        }''')
        page.reload(wait_until='domcontentloaded')
        bank = page.evaluate("""async () => {
            const data = await import(new URL('../src/data/quiz.js?v=quiz-20261101-v2', location.href));
            return { courses: data.quizCourses, questions: data.quizQuestions };
        }""")
        by_id = {question['id']: question for question in bank['questions']}
        require(len(bank['courses']) == 5 and len(by_id) == 90, 'Scoped quiz bank is incomplete')
        legacy_history = [{'id': 'legacy-arduino-score', 'courseId': 'arduino', 'lessonId': 'all',
                           'correct': 1, 'total': 6, 'percentage': 17, 'createdAt': '2026-11-01T00:00:00Z'}]
        page.evaluate('(records) => localStorage.setItem("strobot.quiz.history.v1", JSON.stringify(records))', legacy_history)
        expect(page.locator('#quizIntroArea')).to_be_visible()
        expect(page.locator('#quizCourseSelect')).to_have_value('')
        expect(page.locator('#btnInitQuiz')).to_be_disabled()
        expect(page.locator('#quizCourseSelect option')).to_have_count(6)
        expect(page.locator('#quizDifficulty')).to_have_value('medium')
        require(page.locator('#quizDifficulty option').evaluate_all('(items) => items.map(item => item.value)') == ['easy', 'medium', 'hard'],
                'Difficulty selector does not expose the three requested levels')
        expect(page.locator('#quizQuestionSource, #quizGeneratedLevel, #quizPersonalized, #quizAiPlan, #btnGeneratedPractice')).to_have_count(0)
        require(page.locator('#quizProgressDetails').get_attribute('open') is None,
                'Progress and data should start collapsed so the primary setup remains simple')
        # Every course exposes its own six lessons, not a generic question category.
        for course in bank['courses']:
            page.locator('#quizCourseSelect').select_option(course['id'])
            expect(page.locator('#quizCourseSelect option:checked')).to_contain_text(course['name'])
            expect(page.locator('#quizScopeSummary')).to_contain_text('6 câu')
            expect(page.locator('#quizLessonSelect option')).to_have_count(7)
            for option, lesson in zip(page.locator('#quizLessonSelect option').all()[1:], course['lessons']):
                require(option.get_attribute('value') == lesson['id'], 'Lesson selector crossed course boundaries')
                require(lesson['title'] in option.inner_text(), 'Lesson option lacks a meaningful title')
            page.locator('#quizLessonSelect').select_option(course['lessons'][0]['id'])
            expect(page.locator('#quizQuestionCount')).to_have_value('3')
            expect(page.locator('#quizLessonSelect option:checked')).to_contain_text(course['lessons'][0]['title'])
            expect(page.locator('#quizScopeSummary')).to_contain_text('3 câu')
            page.locator('#quizLessonSelect').select_option('all')
            require(page.locator('#quizQuestionCount option').evaluate_all('(items)=>items.map(o=>o.value)') == ['6', '12', '18'], 'Whole-course assessment sizes are unclear')

        page.locator('#quizCourseSelect').select_option('arduino')
        page.locator('#quizLessonSelect').select_option('all')
        page.locator('#quizQuestionCount').select_option('6')
        expect(page.locator('#btnInitQuiz')).to_be_enabled()
        page.locator('#btnInitQuiz').click()

        def complete_round(count, course_id, lesson_id='all', first_wrong=False, revisit=False):
            observed = []
            expect(page.locator('#quizActiveGame')).to_be_visible()
            for index in range(count):
                question_id = page.locator('#quizActiveGame').get_attribute('data-question-id')
                question = resolve_question(page, question_id, by_id)
                require(question['courseId'] == course_id, 'Quiz asks about a different course')
                require(lesson_id == 'all' or question['lessonId'] == lesson_id, 'Quiz asks about an unselected lesson')
                expect(page.locator('#targetQuestionPlaceholder')).to_contain_text(question['q'])
                expect(page.locator('#quizQuestionLesson')).to_contain_text(next(l['title'] for c in bank['courses'] if c['id'] == course_id for l in c['lessons'] if l['id'] == question['lessonId']))
                expect(page.locator('#confirmAnswerBtn')).to_be_disabled()
                expect(page.locator('#forwardBtn')).to_be_disabled()
                expect(page.locator('#feedbackBox')).to_be_hidden()
                if index == 0:
                    expect(page.locator('#backQuestionBtn')).to_be_disabled()
                    page.locator('#forwardBtn').dispatch_event('click')
                    require(page.locator('#quizActiveGame').get_attribute('data-question-id') == question_id, 'Next skipped an unanswered question')
                choice = (question['ans'] + 1) % len(question['opts']) if first_wrong and index == 0 else question['ans']
                radio = page.locator('#answerOptionsArea input[name="answer"][value="' + str(choice) + '"]')
                radio.check()
                expect(radio).to_be_checked()
                expect(page.locator('#confirmAnswerBtn')).to_be_enabled()
                expect(page.locator('#forwardBtn')).to_be_disabled()
                expect(page.locator('#feedbackBox')).to_be_hidden()
                page.locator('#confirmAnswerBtn').click()
                expect(page.locator('#feedbackBox')).to_be_visible()
                expect(page.locator('#feedbackBox')).to_contain_text(question['exp'])
                expect(page.locator('#forwardBtn')).to_be_enabled()
                require(page.locator('#answerOptionsArea input').evaluate_all('(items)=>items.every(item=>item.disabled)'), 'Confirmed answers can still be changed')
                expect(page.locator('#answerOptionsArea .answer-correct')).to_have_count(1)
                if first_wrong and index == 0:
                    expect(page.locator('#answerOptionsArea .answer-wrong')).to_have_count(1)
                require(float(page.locator('#quizProgress').get_attribute('value')) == index + 1, 'Confirmed-answer progress is incorrect')
                observed.append((question, choice))
                if revisit and index == 1:
                    page.locator('#backQuestionBtn').click()
                    require(page.locator('#quizActiveGame').get_attribute('data-question-id') == observed[0][0]['id'], 'Back did not restore the previous question')
                    expect(page.locator('#answerOptionsArea input[value="' + str(observed[0][1]) + '"]')).to_be_checked()
                    require(page.locator('#answerOptionsArea input').evaluate_all('(items)=>items.every(item=>item.disabled)'), 'Revisiting unlocked the confirmed answer')
                    page.locator('#quizAnswerForm').dispatch_event('submit')
                    require(float(page.locator('#quizProgress').get_attribute('value')) == 2, 'Reviewing or re-submitting added progress/points')
                    page.locator('#forwardBtn').click()
                    require(page.locator('#quizActiveGame').get_attribute('data-question-id') == question_id, 'Forward lost the answered question')
                if index == count - 1:
                    expect(page.locator('#forwardBtn')).to_contain_text('Xem kết quả')
                page.locator('#forwardBtn').click()
            expect(page.locator('#quizSummaryArea')).to_be_visible()
            correct = count - (1 if first_wrong else 0)
            expect(page.locator('#totalScoreText')).to_contain_text(re.compile(str(correct) + r'\s*/\s*' + str(count)))
            expect(page.locator('#quizScorePercent')).to_contain_text(str(round(correct * 100 / count)))
            expect(page.locator('#quizResultScope')).to_contain_text(next(c['name'] for c in bank['courses'] if c['id'] == course_id))
            reviews = page.locator('#quizReviewList details[data-question-id]')
            expect(reviews).to_have_count(count)
            for question, choice in observed:
                review = page.locator('#quizReviewList details[data-question-id="' + question['id'] + '"]')
                expect(review).to_have_attribute('data-correct', str(choice == question['ans']).lower())
                text = review.text_content()
                require(question['q'] in text and question['exp'] in text, 'Result omits the question or explanation')
                require(question['opts'][choice] in text and question['opts'][question['ans']] in text, 'Result does not identify selected and correct answers')
                params = parse_qs(urlparse(review.locator('a[href*="course.learning.html"]').first.get_attribute('href')).query)
                require(params.get('course') == [course_id] and params.get('lesson') == [question['lessonId']], 'Review sends learner to the wrong lesson')
            return observed

        first = complete_round(6, 'arduino', first_wrong=True, revisit=True)
        require(len({q['lessonId'] for q, _ in first}) == 6, 'Whole-course quiz did not cover all six lessons')
        saved = page.evaluate('JSON.parse(localStorage.getItem("strobot.review.evidence.v1")).attempts')
        require(len(saved) == 1 and saved[0]['mode'] == 'generated' and len(saved[0]['answers']) == 6,
                'Completed mixed practice was not saved once with all individual choices')
        require(sum(answer['choice'] == resolve_question(page, answer['questionId'], by_id)['ans']
                    for answer in saved[0]['answers']) == 5, 'Saved answers disagree with the displayed score')
        require(page.evaluate('JSON.parse(localStorage.getItem("strobot.quiz.history.v1"))') == legacy_history,
                'New mixed practice changed the existing legacy score history')
        page.locator('#btnRestartQuiz').click()
        complete_round(6, 'arduino')
        page.locator('#btnBackIntro').click()
        expect(page.locator('#quizIntroArea')).to_be_visible()
        open_quiz_progress(page)
        expect(page.locator('#quizHistory')).to_contain_text(re.compile(r'6\s*/\s*6'))
        page.set_viewport_size({'width': 390, 'height': 844})
        page.locator('#quizLessonSelect').select_option('led')
        expect(page.locator('#quizQuestionCount')).to_have_value('3')
        no_overflow()
        page.locator('#btnInitQuiz').click()
        no_overflow()
        complete_round(3, 'arduino', 'led')
        no_overflow()
        page.locator('#btnBackIntro').click()
        page.reload(wait_until='domcontentloaded')
        page.locator('#quizCourseSelect').select_option('arduino')
        page.locator('#quizLessonSelect').select_option('led')
        open_quiz_progress(page)
        expect(page.locator('#quizHistory')).to_contain_text(re.compile(r'3\s*/\s*3'))
        previous_evidence = page.evaluate('localStorage.getItem("strobot.review.evidence.v1")')
        page.evaluate("() => { window.__quizOriginalSetItem=Storage.prototype.setItem; Storage.prototype.setItem=function(){throw new DOMException('Storage unavailable','QuotaExceededError')}; return true; }")
        try:
            page.locator('#btnInitQuiz').click()
            complete_round(3, 'arduino', 'led')
            require(page.evaluate('localStorage.getItem("strobot.review.evidence.v1")') == previous_evidence,
                    'Failed storage write changed the saved per-question evidence')
            expect(page.locator('#reviewSaveNotice')).to_contain_text('Chưa lưu được')
            require(page.evaluate('JSON.parse(localStorage.getItem("strobot.quiz.history.v1"))') == legacy_history,
                    'Failed mixed-practice save changed legacy score history')
        finally:
            page.evaluate('Storage.prototype.setItem=window.__quizOriginalSetItem;delete window.__quizOriginalSetItem')
        page.set_viewport_size({'width': 1440, 'height': 1000})
        return {'mapped_bank_questions': 90, 'canonical_questions_resolved': len(by_id), 'courses_in_selector': 5, 'difficulty_levels': 3, 'source_controls_removed': True, 'whole_course_questions': 6, 'lesson_questions': 3, 'completed_rounds': 4, 'explicit_confirmation': True, 'locked_answers': True, 'revisit_no_double_score': True, 'review_lesson_links': True, 'history_persists': True, 'legacy_history_preserved': True, 'storage_failure_handled': True, 'mobile_states_no_overflow': True}

    checked('scoped quiz selection, confirmation, results, lesson review and saved history', quiz)

    def registration():
        goto('dangky.html')
        enter = page.locator('#enterCourseLink')
        expect(enter).to_be_visible()
        expect(page.locator('#registerForm, main input[required], main input[type="email"], main input[type="tel"]')).to_have_count(0)
        selector = page.locator('#quickCourseSelect')
        expect(selector).to_have_value('microbit')
        expected_lessons = {'microbit': 'matrix', 'arduino': 'led', 'vex-vr': 'sequence', 'lego-spike': 'mechanism', 'vex-iq': 'drive'}
        expect(selector.locator('option')).to_have_count(len(expected_lessons))
        expect(page.locator('#readinessAdvice')).to_contain_text('Chưa cần hiểu hết')
        for course_id, lesson_id in expected_lessons.items():
            selector.select_option(course_id)
            expect(enter).to_be_visible()
            query = parse_qs(urlparse(enter.get_attribute('href')).query)
            require(query.get('course') == [course_id] and query.get('lesson') == [lesson_id], 'Beginner entry must open the selected first lesson')
            require(page.locator('#startLessonTitle').text_content().strip(), 'First lesson preview missing')
            expect(page.locator('#startCourseName')).to_contain_text('Bài 1 / 6')
        page.locator('input[name="readiness"][value="practiced"]').check()
        expect(page.locator('#readinessAdvice')).to_contain_text('dự đoán')
        expect(enter).to_be_visible()
        page.locator('input[name="readiness"][value="beginner"]').check()
        expect(page.locator('#readinessAdvice')).to_contain_text('Chưa cần hiểu hết')
        links = page.locator('.start-course-link').evaluate_all('(items) => items.map(item => item.getAttribute("href"))')
        require(len(links) == len(expected_lessons), 'Static first-lesson links must work without the chooser')
        for href in links:
            query = parse_qs(urlparse(href).query)
            course_id = query.get('course', [''])[0]
            require(course_id in expected_lessons and query.get('lesson') == [expected_lessons[course_id]], 'Static first-lesson link has wrong scope')
        layouts = {}
        try:
            for width in [320, 390]:
                page.set_viewport_size({'width': width, 'height': 900})
                layouts[str(width)] = no_overflow()
        finally:
            page.set_viewport_size({'width': 1440, 'height': 1000})
        selector.select_option('arduino')
        enter.click()
        expect(page.locator('#courseSelect')).to_have_value('arduino')
        require(parse_qs(urlparse(page.url).query).get('lesson') == ['led'], 'Entry did not reach the first Arduino lesson')
        return {'direct_course_entries': 5, 'no_registration_required': True, 'readiness_advice': True, 'static_first_lesson_links': 5, 'entry_to_first_lesson': True, 'mobile_layouts': layouts}

    checked('beginner entry, optional readiness guidance and direct first-lesson links', registration)

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
        code_examples_checked = 0
        platform_guides_checked = 0
        assignments = page.evaluate('window.STROBOT_COURSE_LABS')
        page.locator('#learningLevel').select_option('beginner')
        for c in data:
            page.locator('#courseSelect').select_option(c['id'])
            expect(page.locator('#lessonList button')).to_have_count(6)
            for i, lesson_data in enumerate(c['lessons']):
                page.locator('#lessonList button').nth(i).click()
                expect(page.locator('#lessonTitle')).to_have_text(lesson_data['title'])
                require(page.locator('#theoryContent').text_content().strip(), 'Missing lesson theory')
                require(page.locator('#theoryDetails').get_attribute('open') is None, 'Extended theory should start collapsed')
                expect(page.locator('#starterConcept')).to_be_visible()
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
                check_learning_guide(page, lesson_data)
                page.locator('#tabBtnLab').click()
                expect(page.locator('#labView')).to_be_visible()
                require(page.locator('#sampleCodeDetails').get_attribute('open') is None, 'Sample code should start collapsed')
                if c['id'] == 'microbit':
                    require('micropython' in lesson_data['lang'].casefold(), 'The embedded Python editor needs a MicroPython primary sample: ' + lesson_key)
                    require(any('makecode' in variant['lang'].casefold() for variant in lesson_data.get('codeVariants', [])),
                            'Original MakeCode curriculum alternative was removed: ' + lesson_key)
                # Every offered platform needs the current lesson's own task. Platforms
                # without text code must clear the previous editor's sample completely.
                for platform_key in assignments[c['id']]:
                    page.locator('#labButtons button[data-lab-key="' + platform_key + '"]').click()
                    code_examples_checked += check_platform_guide(page, copy_examples=True)
                    platform_guides_checked += 1
                require(page.locator('#quizOptions input').count() >= 2, 'Missing lesson quiz')
                require('lesson=' + lesson_data['id'] in page.url, 'Lesson deep link lost')
                checks += 1
            page.locator('#tabBtnLab').click()
            expect(page.locator('#labView')).to_be_visible()
            expect(page.locator('#theoryView')).to_be_hidden()
            page.locator('#labButtons button').last.click()
            expect(page.locator('#localLab')).to_be_visible()
            bench = page.locator('#localLab .lesson-bench')
            expect(bench).to_have_attribute('data-bench-course', c['id'])
            expect(bench).to_have_attribute('data-bench-lesson', c['lessons'][-1]['id'])
            expect(bench.locator('h3')).to_contain_text('Mô hình:')
            output = bench.locator('.lesson-bench-output')
            require(output.inner_text().strip(), 'Local model guidance missing')
            action_buttons = bench.locator('.lesson-bench-actions button')
            (action_buttons if action_buttons.count() else bench.locator('.lesson-bench-body button')).first.click()
            require(output.inner_text().strip(), 'Local model result missing')
            evidence = page.evaluate('record().modelEvidence')
            require(evidence and evidence['lessonId'] == c['lessons'][-1]['id'] and evidence['actions'], 'Meaningful model action did not record lesson evidence')
            page.locator('#tabBtnTheory').click()
            expect(page.locator('#theoryView')).to_be_visible()
            expect(page.locator('#labView')).to_be_hidden()
        require(platform_guides_checked == 126, 'Some course/lesson/platform guides were not exercised')
        require(code_examples_checked >= 30, 'Runnable platform samples are missing')
        page.locator('#learningLevel').select_option('advanced')
        page.reload(wait_until='domcontentloaded')
        expect(page.locator('#learningLevel')).to_have_value('advanced')
        expect(page.locator('#learningGuideContent')).to_have_attribute('data-learning-level', 'advanced')
        page.locator('#learningLevel').select_option('beginner')
        return {'original_courses': len(data), 'rendered_lessons': checks, 'structured_theory_lessons': checks, 'expanded_explanations': checks, 'explanation_levels_checked': checks * 3, 'explanation_level_persists': True, 'platform_guides_checked': platform_guides_checked, 'platform_code_examples_rendered_and_copied': code_examples_checked, 'official_reference_links': sum(len(l['sources']) for c in data for l in c['lessons']), 'interactive_local_benches': len(data)}

    checked('all original learning courses, lesson content, tabs and local lab benches', learning)

    def stale_lab_registry():
        stale_requests = []
        fixtures['stale_registry_requests'] = stale_requests
        fixtures['stale_registry'] = 'window.STROBOT_LAB_PLATFORMS={local:{name:"Old local-only bench",mode:"local",languages:"offline"}};window.STROBOT_COURSE_LABS={arduino:["local"]};'
        goto('course.learning.html?course=arduino&build=cache-regression')
        expect(page.locator('#lab-platform-data')).to_have_count(1)
        expect(page.locator('script[src*="lab-platforms.js"]')).to_have_count(0)
        page.locator('#tabBtnLab').click()
        expect(page.locator('#labButtons button')).to_have_count(5)
        for key in ['circuit', 'avr', 'wokwi', 'phet', 'local']:
            expect(page.locator('#labButtons button[data-lab-key="' + key + '"]')).to_have_count(1)
        expect(page.locator('#practiceFrame')).to_have_attribute('src', 'https://www.falstad.com/circuit/avr8js/')
        require(not stale_requests, 'The page still loads a separately cached lab registry')
        fixtures['stale_registry'] = None
        return {'old_registry_requests': len(stale_requests), 'arduino_choices': 5, 'original_default': 'avr', 'atomic_lab_snapshot': True}

    checked('old cached lab registry cannot hide the restored platforms', stale_lab_registry)

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
        defaults = {'arduino': 'avr', 'microbit': 'python', 'vex-iq': 'gears', 'lego-spike': 'gears', 'vex-vr': 'gears'}
        additions = {'wokwi', 'phet', 'scratch', 'arcade', 'python'}
        default_urls = {**original_urls, 'python': 'https://python.microbit.org/v/3/?controller=1&flag=noWelcome&l=en'}
        require(set(registry) == set(original_urls) | additions | {'local'}, 'Original labs or official embed additions missing; external-only editor added')
        for key, url in original_urls.items():
            require(registry[key]['url'] == url and registry[key]['mode'] == 'embed', 'Original lab changed: ' + key)
            require(registry[key]['embedSupport'] == 'existing', 'Original lab can be disabled by a new verification gate: ' + key)
        # Local fixture tests the iframe integration only, not provider availability.
        # There are no live external requests or paid AI calls in this suite.
        frame_urls = {(cfg.get('embedUrl') or cfg.get('url')).split('#', 1)[0] for cfg in registry.values() if cfg['mode'] == 'embed'}
        fixtures['frame_urls'] = frame_urls
        popups = []
        on_popup = lambda popup: popups.append(popup)
        page.on('popup', on_popup)
        checks = 0
        for course_id, keys in assignments.items():
            require(len(keys) >= 4 and len(set(keys)) == len(keys) and keys[-1] == 'local', 'Missing course lab choices: ' + course_id)
            page.locator('#courseSelect').select_option(course_id)
            page.locator('#tabBtnLab').click()
            default = defaults[course_id]
            expect(page.locator('#practiceFrame')).to_have_attribute('src', default_urls[default])
            expect(page.locator('#labButtons button[data-lab-key="' + default + '"]')).to_have_attribute('aria-pressed', 'true')
            expect(page.locator('#localLab')).to_be_hidden()
            expect(page.locator('#labActivity, #labProviderDocs, #labBoxDesc, #frameNote')).to_have_count(0)
            expect(page.locator('#labView a')).to_have_count(1)
            check_platform_guide(page)
            expect(page.locator('#labButtons button')).to_have_count(len(keys))
            for key in keys:
                cfg = registry[key]
                button = page.locator('#labButtons button[data-lab-key="' + key + '"]')
                button.click()
                expect(button).to_have_attribute('aria-pressed', 'true')
                expect(page.locator('#labButtons button[aria-pressed="true"]')).to_have_count(1)
                separate = page.locator('#labExternalBtn')
                expect(separate).to_be_visible()
                expect(separate).to_have_attribute('target', '_blank')
                require({'noopener', 'noreferrer'} <= set(separate.get_attribute('rel').split()), 'New-tab link lacks opener isolation')
                if key == 'local':
                    params = parse_qs(urlparse(separate.get_attribute('href')).query)
                    require(params.get('course') == [course_id] and params.get('lesson') == [page.evaluate('lesson().id')], 'Local lab link lost the current course/lesson')
                    require(params.get('view') == ['lab'] and params.get('lab') == ['local'], 'Local lab new tab must open the lab view')
                else:
                    expect(separate).to_have_attribute('href', cfg.get('externalUrl') or cfg['url'])
                if key == 'local':
                    expect(page.locator('#localLab')).to_be_visible()
                    expect(page.locator('#practiceFrame')).to_have_count(0)
                    require(page.locator('#localLab .lesson-bench-output').inner_text().strip(), 'In-page lesson model did not mount')
                else:
                    frame = page.locator('#practiceFrame')
                    expect(frame).to_have_attribute('src', cfg.get('embedUrl') or cfg['url'])
                    expect(frame).to_have_attribute('title', cfg['name'])
                    expect(frame).to_have_attribute('allow', 'fullscreen; clipboard-write; autoplay; microphone; usb' if key == 'python' else 'fullscreen; clipboard-write')
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
            expect(page.locator('#practiceFrame')).to_have_attribute('src', default_urls[default])
        page.locator('#courseSelect').select_option('arduino')
        page.locator('#tabBtnLab').click()
        original = page.evaluate('JSON.parse(JSON.stringify(labs.wokwi))')
        page.evaluate("labs.wokwi.mode='external';renderLabButtons();selectLabPlatform('wokwi')")
        expect(page.locator('#labButtons button[data-lab-key="wokwi"]')).to_have_count(0)
        expect(page.locator('#labExternalBtn')).to_have_count(1)
        page.evaluate("labs.wokwi.mode='embed';labs.wokwi.embedSupport='unknown';renderLabButtons()")
        expect(page.locator('#labButtons button[data-lab-key="wokwi"]')).to_have_count(0)
        page.evaluate('(cfg)=>{labs.wokwi=cfg;renderLabButtons()}', original)
        page.locator('#labButtons button[data-lab-key="wokwi"]').click()
        page.locator('#practiceFrame').dispatch_event('error')
        expect(page.locator('#platformHelp')).to_contain_text('Khung lab tải chưa thành công')
        expect(page.locator('#labButtons button[data-lab-key="wokwi"]')).to_have_count(1)
        expect(page.locator('#labButtons button[data-lab-key="wokwi"]')).to_have_attribute('aria-pressed', 'true')
        expect(page.locator('#practiceFrame')).to_have_attribute('src', original.get('embedUrl') or original['url'])
        require(page.evaluate('labs.wokwi.mode') == original['mode'], 'A transient frame error permanently changed the provider registry')
        page.locator('#labReloadBtn').click()
        expect(page.locator('#practiceFrame')).to_have_attribute('src', original.get('embedUrl') or original['url'])
        page.locator('#labButtons button[data-lab-key="local"]').click()
        expect(page.locator('#localLab .lesson-bench')).to_be_visible()
        expect(page.locator('#practiceFrame')).to_have_count(0)
        page.locator('#labButtons button[data-lab-key="wokwi"]').click()
        expect(page.locator('#practiceFrame')).to_have_attribute('src', original.get('embedUrl') or original['url'])
        require(len(popups) == 0, 'A lab choice opened a separate tab')
        page.remove_listener('popup', on_popup)
        page.set_viewport_size({'width': 390, 'height': 844})
        mobile_layouts = {}
        for course_id in assignments:
            page.locator('#courseSelect').select_option(course_id)
            page.locator('#tabBtnLab').click()
            mobile_layouts[course_id] = no_overflow()
        page.set_viewport_size({'width': 1440, 'height': 1000})
        fixtures['frame_urls'] = set()
        return {'original_platforms_restored': 4, 'course_defaults_checked': 5, 'official_embed_additions': 5, 'selections_checked': checks, 'optional_new_tab_links_checked': checks, 'popups': 0, 'transient_frame_error_preserves_provider_and_retry': True, 'manual_model_fallback_available': True, 'mobile_lab_layouts': mobile_layouts, 'live_provider_availability': 'not tested; iframe integration uses local fixtures'}

    checked('lab embeds, editable micro:bit configuration and optional new-tab links', lab_platforms)

    def optional_lab_tabs():
        goto('course.learning.html?course=arduino&lesson=distance')
        page.locator('#tabBtnLab').click()
        cfg = page.evaluate('labs.wokwi')
        embed_url = cfg.get('embedUrl') or cfg['url']
        separate_url = cfg.get('externalUrl') or cfg['url']
        fixtures['frame_urls'].add(embed_url.split('#', 1)[0])
        fixtures['popup_urls'].add(separate_url.split('#', 1)[0])
        try:
            page.locator('#labButtons button[data-lab-key="wokwi"]').click()
            with page.expect_popup() as opened:
                page.locator('#labExternalBtn').click()
            remote_tab = opened.value
            remote_tab.wait_for_load_state('domcontentloaded')
            expect(remote_tab).to_have_url(separate_url)
            require(remote_tab.evaluate('window.opener === null'), 'External lab can access the original tab')
            expect(page.locator('#practiceFrame')).to_have_attribute('src', embed_url)
            expect(page.locator('#labButtons button[data-lab-key="wokwi"]')).to_have_attribute('aria-pressed', 'true')
            remote_tab.close()
        finally:
            fixtures['frame_urls'].discard(embed_url.split('#', 1)[0])
            fixtures['popup_urls'].discard(separate_url.split('#', 1)[0])
        page.locator('#labButtons button[data-lab-key="local"]').click()
        local_url = page.locator('#labExternalBtn').get_attribute('href')
        with page.expect_popup() as opened:
            page.locator('#labExternalBtn').click()
        local_tab = opened.value
        local_tab.wait_for_load_state('domcontentloaded')
        expect(local_tab.locator('#courseSelect')).to_have_value('arduino')
        expect(local_tab.locator('#lessonTitle')).to_have_text(page.locator('#lessonTitle').inner_text())
        expect(local_tab.locator('#labView')).to_be_visible()
        expect(local_tab.locator('#localLab')).to_be_visible()
        expect(local_tab.locator('#labButtons button[data-lab-key="local"]')).to_have_attribute('aria-pressed', 'true')
        expect(local_tab.locator('#practiceFrame')).to_have_count(0)
        require(local_tab.evaluate('window.opener === null'), 'Local lab popup is not isolated')
        require(parse_qs(urlparse(local_url).query)['lesson'] == ['distance'], 'Local new tab changed the selected lesson')
        local_tab.close()
        expect(page.locator('#localLab')).to_be_visible()
        return {'external_editor_new_tab': True, 'original_embed_preserved': True, 'local_lab_course_and_lesson_preserved': True, 'opener_isolated': True, 'live_provider_calls': 0}

    checked('optional lab tabs open the right editor or same local lesson without replacing the embed', optional_lab_tabs)

    def persistence_pdf():
        goto('course.learning.html?course=arduino')
        page.evaluate('localStorage.removeItem("strobot.original.course.v3")')
        page.reload(wait_until='domcontentloaded')
        expect(page.locator('#progressText')).to_contain_text('0/6')
        page.locator('button[onclick="markLessonComplete()"]').first.click()
        expect(page.locator('#labView')).to_be_visible()
        expect(page.locator('#notice')).to_contain_text('Trả lời đúng')
        expect(page.locator('#notice')).to_contain_text('Ghi dự đoán')
        answer = page.evaluate('lesson().answer')
        page.locator('#quizOptions input[value="' + str(answer) + '"]').check()
        page.locator('#quizForm button[type=submit]').click()
        expect(page.locator('#quizFeedback')).to_contain_text('Đúng.')
        note = 'Đầu vào: điện trở 330 ohm. Dự đoán: dòng nhỏ. Kết quả: LED sáng. Giải thích: điện trở giới hạn dòng điện.'
        note_details = page.locator('#journal').locator('xpath=ancestor::details[1]')
        note_details.locator(':scope > summary').click()
        page.locator('#journal').fill(note)
        expect(page.locator('#saveNotice')).to_contain_text('Đã lưu')
        page.locator('button[onclick="markLessonComplete()"]').first.click()
        expect(page.locator('#progressText')).to_contain_text('0/6')
        expect(page.locator('#notice')).to_contain_text('Ghi dự đoán')
        expect(page.locator('#notice')).to_contain_text('Chọn nơi')
        evidence = {
            'prediction': 'Với điện trở 330 ohm, tôi dự đoán LED sáng và dòng điện được giới hạn.',
            'observation': 'Mạch nối kín với điện trở 330 ohm: LED sáng; đây là bản ghi kiểm thử của editor.',
            'explanation': 'Điện trở giới hạn dòng trong mạch nối kín, phù hợp dự đoán đã ghi.',
            'transfer': 'Đổi điện trở từ 330 lên 1000 ohm rồi chạy lại: LED mờ hơn vì dòng điện giảm.',
        }
        page.locator('#practiceSource').select_option('external')
        for field in ['prediction', 'observation', 'explanation']:
            page.locator('#' + field).fill(evidence[field])
        page.locator('button[onclick="markLessonComplete()"]').first.click()
        expect(page.locator('#progressText')).to_contain_text('0/6')
        expect(page.locator('#notice')).to_contain_text('Đổi một đầu vào')
        page.locator('#transfer').fill(evidence['transfer'])
        page.reload(wait_until='domcontentloaded')
        expect(page.locator('#journal')).to_have_value(note)
        expect(page.locator('#quizOptions input[value="' + str(answer) + '"]')).to_be_checked()
        for field, value in evidence.items():
            expect(page.locator('#' + field)).to_have_value(value)
        expect(page.locator('#practiceSource')).to_have_value('external')
        page.locator('button[onclick="markLessonComplete()"]').first.click()
        expect(page.locator('#progressText')).to_contain_text('1/6')
        expect(page.locator('#completionStatus')).to_contain_text('tự xác nhận')
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
        page.locator('#tabBtnLab').click()
        with page.expect_download() as info:
            page.locator('#exportNotes').click()
        notes = json.loads(pathlib.Path(info.value.path()).read_text())
        require(notes['course'] == 'arduino' and any(r.get('note') == note for r in notes['records'].values()), 'Journal export lost original note')
        require(notes['schemaVersion'] == 2, 'Portfolio export must identify its validated schema')
        saved = notes['records'][page.evaluate('lesson().id')]
        require(all(saved.get(field) == value for field, value in evidence.items()), 'Portfolio export lost practice evidence')
        require(saved.get('done') is True and saved.get('source') == 'external' and saved.get('completedAt'), 'Portfolio export lost self-reported completion metadata')
        return {'quiz_alone_insufficient': True, 'journal_alone_insufficient': True, 'prediction_observation_explanation_and_changed_input_required': True, 'practice_source_required': True, 'completion_is_self_reported': True, 'reload_persistence': True, 'pdf_bytes': len(pdf), 'notes_export': True}

    checked('learning evidence gates, persisted practice records, actual PDF and portfolio export', persistence_pdf)

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
        expect(page.locator('#tutorPanel')).to_be_hidden()
        page.locator('#tutorLauncher').click()
        expect(page.locator('#tutorPanel')).to_be_visible()
        page.locator('#tutorQuestion').fill('Giải thích lệnh trong bài?')
        page.locator('#tutorSend').click()
        expect(page.locator('#tutorMessages')).to_contain_text('Phản hồi AI kiểm thử')
        reqs = [x['data'] for x in api_requests if x['kind'] == 'tutor']
        require(reqs[-1]['course'] == 'microbit' and reqs[-1]['lesson'], 'Tutor course/lesson context missing')
        require(reqs[-1]['history'] == [], 'New tutor session should have no history')
        require(reqs[-1]['question'] == 'Giải thích lệnh trong bài?', 'Tutor changed the raw question')
        require(reqs[-1].get('platformKey') == 'python' and reqs[-1].get('learningLevel') == 'beginner', 'Tutor lost the selected editor or explanation level')
        require('images' not in reqs[-1], 'Text-only tutor request acquired unexpected attachments')
        page.locator('#learningLevel').select_option('intermediate')
        page.locator('#tabBtnLab').click()
        page.locator('#labButtons button[data-lab-key="scratch"]').click()
        page.locator('#tutorQuestion').fill('Cho ví dụ?')
        page.locator('#tutorSend').click()
        expect(page.locator('#tutorSend')).to_be_enabled()
        expect(page.locator('#tutorMessages .chat-message')).to_have_count(4)
        reqs = [x['data'] for x in api_requests if x['kind'] == 'tutor']
        require(reqs[-1]['question'] == 'Cho ví dụ?' and reqs[-1]['history'] == [
                    {'role': 'user', 'content': 'Giải thích lệnh trong bài?'},
                    {'role': 'assistant', 'content': 'Phản hồi AI kiểm thử: mạch điện và thuật toán.'}
                ], 'Tutor lost raw follow-up question or conversation history')
        require(reqs[-1].get('platformKey') == 'scratch' and reqs[-1].get('learningLevel') == 'intermediate',
                'Tutor did not follow the selected platform and explanation level')
        page.locator('#lessonList button').nth(1).click()
        expect(page.locator('#tutorMessages')).to_be_empty()
        expect(page.locator('#tutorPanel')).to_be_visible()
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
        context.grant_permissions(['clipboard-read', 'clipboard-write'])
        valid_catalog_error = {'catalogStatus': 503, 'catalogResult': 'http_error', 'candidateCount': 0, 'fallbackAttempted': False}
        valid_catalog_fallback = {'catalogStatus': 200, 'catalogResult': 'ok', 'candidateCount': 3, 'fallbackAttempted': True,
                                  'configuredModelListed': False, 'catalogModelCount': 3}
        valid_listed_primary = {'catalogStatus': 200, 'catalogResult': 'ok', 'candidateCount': 0, 'fallbackAttempted': False,
                                'configuredModelListed': True, 'catalogModelCount': 5000}
        valid_empty_catalog = {'catalogStatus': 200, 'catalogResult': 'ok', 'candidateCount': 0, 'fallbackAttempted': False,
                               'configuredModelListed': False, 'catalogModelCount': 0}
        diagnostic_cases = [
            (valid_catalog_error, valid_catalog_error),
            (valid_catalog_fallback, valid_catalog_fallback),
            (valid_listed_primary, valid_listed_primary),
            (valid_empty_catalog, valid_empty_catalog),
            ({'catalogStatus': 'private-status', 'catalogResult': 'private-model-name',
              'candidateCount': 'private-candidate-id', 'fallbackAttempted': 'private-key',
              'configuredModelListed': 'private-model-name', 'catalogModelCount': 'private-catalog'}, {}),
            ({'catalogStatus': 600, 'catalogResult': 'OK', 'candidateCount': 4, 'fallbackAttempted': 1,
              'configuredModelListed': 1, 'catalogModelCount': 5001}, {}),
            ({'catalogStatus': 99, 'catalogResult': {}, 'candidateCount': -1, 'fallbackAttempted': 0,
              'configuredModelListed': 0, 'catalogModelCount': -1}, {}),
        ]
        for index, (metadata, expected_metadata) in enumerate(diagnostic_cases):
            if index:
                fixtures['tutor_error_metadata'] = metadata
                page.locator('#tutorSend').click()
                expect(page.locator('#tutorSend')).to_be_enabled()
            details = page.locator('#tutorErrorDetails details')
            expect(details).to_be_visible()
            require(details.get_attribute('open') is None, 'Technical tutor details should remain collapsed by default')
            details.locator('summary').click()
            diagnostic = json.loads(details.locator('pre').inner_text())
            require(diagnostic == {'client': 'tutor', 'code': 'AI_UNAVAILABLE', 'httpStatus': 503,
                                  'upstreamStatus': 503, 'stage': 'provider',
                                  'requestId': '11111111-2222-4333-8444-555555555555',
                                  'api': AI_ORIGIN + '/api/tutor', **expected_metadata},
                    'Tutor lost safe metadata or copied invalid catalog metadata: ' + str(diagnostic))
            require('private-' not in details.inner_text(), 'Tutor leaked provider fields, model names or candidate IDs')
            details.locator('button').click()
            expect(details.locator('button')).to_have_text('Đã sao chép')
            copied = json.loads(page.evaluate('navigator.clipboard.readText()'))
            require(copied == diagnostic, 'Tutor copied more than the visible safe report')
        fixtures.pop('tutor_error_metadata', None)
        reply_mode['tutor'] = 'ok'
        page.locator('#tutorSend').click()
        expect(page.locator('#tutorMessages')).to_contain_text('Phản hồi AI kiểm thử')
        expect(page.locator('#tutorErrorDetails')).to_be_hidden()
        reqs = [x['data'] for x in api_requests if x['kind'] == 'tutor']
        require(reqs[-1]['history'] == [], 'A failed tutor exchange leaked into AI history')
        reply_mode['tutor'] = 'hold'
        page.locator('#tutorQuestion').fill('Câu hỏi sẽ hủy')
        with page.expect_request(lambda request: urlparse(request.url).path == '/api/tutor'):
            page.locator('#tutorSend').click()
        page.locator('#tutorReset').click()
        expect(page.locator('#tutorMessages')).to_be_empty()
        expect(page.locator('#tutorSend')).to_be_enabled()
        held = fixtures.get('held_tutor')
        require(held is not None, 'Tutor cancellation did not reach the held API request')
        try:
            held.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body='{"reply":"STALE_TUTOR_REPLY"}')
        except Exception:
            pass
        fixtures['held_tutor'] = None
        reply_mode['tutor'] = 'ok'
        page.locator('#tutorQuestion').fill('Câu hỏi sau khi hủy')
        page.locator('#tutorSend').click()
        expect(page.locator('#tutorMessages')).to_contain_text('Phản hồi AI kiểm thử')
        expect(page.locator('#tutorMessages')).not_to_contain_text('STALE_TUTOR_REPLY')
        reqs = [x['data'] for x in api_requests if x['kind'] == 'tutor']
        require(reqs[-1]['history'] == [], 'Canceled tutor exchange leaked into the new session')
        return {'mocked_requests': len(reqs), 'lesson_context': True, 'history': True, 'reset': True, 'error_recovery': True,
                'collapsed_private_diagnostics_and_copy': True, 'invalid_catalog_metadata_rejected': len(diagnostic_cases) - 4,
                'cancellation_ignores_late_reply': True}

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

summary = {'checks': results, 'passed': sum(r['status'] == 'passed' for r in results), 'failed': sum(r['status'] == 'failed' for r in results), 'external_hosts_blocked': sorted(blocked), 'uncaught_page_errors': page_errors, 'ai_requests_mocked': len(api_requests), 'health_requests_without_ai_calls': len(health_requests), 'ai_urls_verified': sorted({request['url'] for request in api_requests}), 'live_ai_requests': 0}
pathlib.Path(args.output).write_text(json.dumps(summary, ensure_ascii=False, indent=2))
print(json.dumps({'passed': summary['passed'], 'failed': summary['failed'], 'results': args.output}, ensure_ascii=False))
sys.exit(1 if summary['failed'] else 0)
