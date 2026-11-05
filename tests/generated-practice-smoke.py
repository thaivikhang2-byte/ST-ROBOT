#!/usr/bin/env python3
"""Exercise generated practice in Chromium against a locally served checkout.

The browser uses the real local question factory and canonical resolver. Only the
optional planner HTTP response is stubbed; every other external request is
blocked, so this suite never calls a paid AI service.

    python3 tests/generated-practice-smoke.py --base http://127.0.0.1:5500

Results and failure screenshots are written outside the checkout. A filtered run
marks omitted groups as skipped; an interrupted run retains unrun groups.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import re
import sys
import time
import traceback
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base', default='http://127.0.0.1:5500')
parser.add_argument('--chromium', default='/usr/bin/chromium')
parser.add_argument('--output', default='/tmp/strobot-generated-practice-results.json')
parser.add_argument('--only', help='Run group names matching this regular expression')
args = parser.parse_args()
BASE = args.base.rstrip('/')
PUBLIC = BASE + '/frontend/public/'
REVIEW_KEY = 'strobot.review.evidence.v1'
ASSESSMENT_KEY = 'strobot.assessment.v1'
HISTORY_KEY = 'strobot.quiz.history.v1'
COURSES = ('arduino', 'vex-iq', 'microbit', 'lego-spike', 'vex-vr')


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def goto(page):
    page.goto(PUBLIC + 'quiz.html', wait_until='domcontentloaded')
    expect(page.locator('#quizQuestionSource')).to_be_visible()


def modules(page):
    return page.evaluate('''async () => {
        const engine = await import('/frontend/src/modules/quiz/generation/QuestionEngine.js');
        const {quizCourses, quizQuestions} = await import('/frontend/src/data/quiz.js');
        const {ReviewService} = await import('/frontend/src/modules/quiz/ReviewService.js');
        window.__practiceSmoke = {engine, quizCourses,
            bank: Object.fromEntries(quizQuestions.map(q => [q.id, q])), ReviewService};
        return {courses: quizCourses, templates: engine.listTemplates()};
    }''')


def canonical(page, question_id):
    question = page.evaluate('''id => {
        const {engine, bank} = window.__practiceSmoke;
        return id.startsWith('gen:') ? engine.resolveGeneratedQuestion(id) : bank[id];
    }''', question_id)
    require(question is not None, 'Active question has no canonical resolver: ' + str(question_id))
    return question


def current_question(page):
    expect(page.locator('#quizActiveGame')).to_be_visible()
    question_id = page.locator('#quizActiveGame').get_attribute('data-question-id')
    question = canonical(page, question_id)
    expect(page.locator('#targetQuestionPlaceholder')).to_have_text(question['q'])
    copies = page.locator('#answerOptionsArea .answer-copy').all_text_contents()
    require(copies == question['opts'], 'Rendered options differ from canonical question ' + question_id)
    require(isinstance(question['ans'], int) and 0 <= question['ans'] < len(copies),
            'Canonical answer is outside rendered options')
    return question


def complete(page, count, wrong_first=False):
    questions = []
    for index in range(count):
        question = current_question(page)
        choice = ((question['ans'] + 1) % len(question['opts'])
                  if wrong_first and index == 0 else question['ans'])
        page.locator(f'#answerOptionsArea input[value="{choice}"]').check()
        page.locator('#confirmAnswerBtn').click()
        expect(page.locator('#feedbackBox')).to_contain_text(question['exp'])
        expect(page.locator('#feedbackBox')).to_contain_text(question['opts'][question['ans']])
        expect(page.locator('#answerOptionsArea input').first).to_be_disabled()
        page.locator('#forwardBtn').click()
        questions.append(question)
    expect(page.locator('#quizSummaryArea')).to_be_visible()
    correct = count - int(wrong_first)
    percent = (correct * 100 * 2 // count + 1) // 2
    expect(page.locator('#quizScorePercent')).to_have_text(f'{percent}%')
    expect(page.locator('#totalScoreText')).to_contain_text(f'{correct} / {count}')
    require(page.locator('#quizReviewList details').count() == count, 'Summary omitted questions')
    require(len({q['id'] for q in questions}) == count, 'A session repeated a question ID')
    return questions


def setup(page, course='arduino', lesson='all', count=6, source='generated', level='all'):
    page.locator('#quizCourseSelect').select_option(course)
    page.locator('#quizQuestionSource').select_option(source)
    page.locator('#quizLessonSelect').select_option(lesson)
    if source == 'generated':
        page.locator('#quizGeneratedLevel').select_option(level)
    if page.locator('#quizQuestionCount').input_value() != str(count):
        page.locator('#quizQuestionCount').select_option(str(count))


def start(page):
    page.locator('#btnInitQuiz').click()
    expect(page.locator('#quizActiveGame')).to_be_visible(timeout=26000)


def abort(page):
    page.locator('#quizExitBtn').click()
    page.locator('#quizDiscardBtn').click()
    expect(page.locator('#quizIntroArea')).to_be_visible()


def review_plan(page, course='arduino'):
    return page.evaluate('course => new window.__practiceSmoke.ReviewService().plan(course)', course)


def evidence(page, course='arduino'):
    return page.evaluate('''course => {
        const data = new window.__practiceSmoke.ReviewService().evidence(course);
        return {...data, evidence: [...data.evidence.values()]};
    }''', course)


def no_overflow(page):
    sizes = page.evaluate('''() => ({viewport: innerWidth, body: document.body.scrollWidth,
        html: document.documentElement.scrollWidth})''')
    require(max(sizes['body'], sizes['html']) <= sizes['viewport'] + 1,
            'Horizontal page overflow: ' + repr(sizes))
    return sizes


def bank_default(page, fixture):
    goto(page)
    modules(page)
    expect(page.locator('#quizQuestionSource')).to_have_value('bank')
    expect(page.locator('#quizGeneratedSettings')).to_be_hidden()
    setup(page, lesson='led', count=3, source='bank')
    start(page)
    questions = complete(page, 3)
    require(all(not q['id'].startswith('gen:') for q in questions), 'Bank default silently used generated IDs')
    require(not fixture['calls'], 'Unchecked AI made a planner request')
    history = page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', HISTORY_KEY)
    require(len(history) == 1 and history[0]['total'] == 3, 'Ordinary bank history changed')
    return {'bank_default': True, 'canonical_questions_graded': 3, 'planner_calls': 0}


def course_coverage(page, fixture):
    goto(page)
    catalog = modules(page)
    observations = []
    for course, count in zip(COURSES, (6, 12, 18, 6, 6)):
        setup(page, course=course, count=count)
        start(page)
        questions = complete(page, count)
        expected_lessons = {l['id'] for c in catalog['courses'] if c['id'] == course for l in c['lessons']}
        counts = Counter(q['lessonId'] for q in questions)
        require(set(counts) == expected_lessons, 'Whole-course generation missed a lesson: ' + course)
        require(set(counts.values()) == {count // 6}, 'Unfocused practice is not evenly balanced: ' + repr(counts))
        require(all(q['courseId'] == course and q['source'] == 'generated' for q in questions),
                'Generated practice crossed a source or course boundary')
        expect(page.locator('#quizResultSource')).not_to_contain_text('AI gợi ý')
        page.locator('#btnBackIntro').click()
        observations.append({'course': course, 'count': count, 'lessons': dict(counts)})
    stored = page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', REVIEW_KEY)
    require(len(stored['attempts']) == 5 and all(a['mode'] == 'generated' for a in stored['attempts']),
            'Generated completions did not save distinct generated evidence')
    require(page.evaluate('(key) => JSON.parse(localStorage.getItem(key) || "[]")', HISTORY_KEY) == [],
            'Generated variants contaminated fixed-bank score history')
    require(not fixture['calls'], 'Local generation contacted the planner without opt-in')
    return {'courses': observations, 'questions_graded': sum(o['count'] for o in observations), 'planner_calls': 0}


def lesson_scope_and_levels(page, fixture):
    goto(page)
    catalog = modules(page)
    # All 30 requested lesson scopes are real factory calls, including canonical
    # round trips. The UI additionally starts one lesson in each of the 5 courses.
    generated = page.evaluate('''() => {
        const {engine, quizCourses} = window.__practiceSmoke;
        return quizCourses.flatMap(course => course.lessons.map(lesson => {
            const questions = engine.createGeneratedQuiz({courseId: course.id,
                lessonId: lesson.id, count: 3, seed: 'browser-lesson-scope'});
            return {courseId: course.id, lessonId: lesson.id, questions,
                resolved: questions.map(q => engine.resolveGeneratedQuestion(q.id))};
        }));
    }''')
    require(len(generated) == 30, 'Expected 30 distinct curriculum lesson scopes')
    for scope in generated:
        require(scope['questions'] == scope['resolved'], 'Generated ID did not reconstruct exact content')
        require(all(q['courseId'] == scope['courseId'] and q['lessonId'] == scope['lessonId']
                    for q in scope['questions']), 'Factory escaped requested lesson scope')
    observed = []
    for course in catalog['courses']:
        lesson = course['lessons'][0]['id']
        templates = [t for t in catalog['templates'] if t['courseId'] == course['id'] and t['lessonId'] == lesson]
        level = next((t['level'] for t in templates if t['level'] != 'basic'), templates[0]['level'])
        setup(page, course=course['id'], lesson=lesson, count=3, level=level)
        expect(page.locator('#quizGeneratedSettings')).to_be_visible()
        start(page)
        questions = complete(page, 3)
        require(all(q['courseId'] == course['id'] and q['lessonId'] == lesson and q['level'] == level
                    for q in questions), 'Level or lesson control did not affect the generated questions')
        observed.append({'course': course['id'], 'lesson': lesson, 'level': level})
        page.locator('#btnBackIntro').click()
    require(not fixture['calls'], 'Level controls unexpectedly called AI')
    return {'factory_lesson_scopes': 30, 'canonical_round_trips': 90, 'ui_scopes': observed}


def restart_excludes_completed(page, fixture):
    goto(page)
    modules(page)
    setup(page, lesson='led', count=6)
    start(page)
    first = complete(page, 6)
    page.locator('#btnRestartQuiz').click()
    second = complete(page, 6)
    overlap = {q['id'] for q in first} & {q['id'] for q in second}
    require(not overlap, 'Restart repeated recently completed variant IDs: ' + repr(overlap))
    require(len(evidence(page)['attempts']) == 2, 'Restart failed to save each completed session once')
    return {'first_questions': 6, 'restart_questions': 6, 'repeated_ids': 0}


def generated_review_reload(page, fixture):
    goto(page)
    modules(page)
    setup(page, lesson='led', count=3)
    start(page)
    initial = complete(page, 3, wrong_first=True)
    wrong_id = initial[0]['id']
    plan = review_plan(page)
    require(plan['items'] and plan['items'][0]['question']['id'] == wrong_id,
            'Adaptive review did not reconstruct the generated mistake first')
    require(plan['items'][0]['reasonType'] == 'wrong', 'Generated review omitted the selection reason')
    for item in plan['items']:
        require(item['question'] == canonical(page, item['question']['id']), 'Review trusted altered question content')
    page.reload(wait_until='domcontentloaded')
    modules(page)
    page.locator('#quizCourseSelect').select_option('arduino')
    reloaded_plan = review_plan(page)
    require(reloaded_plan['items'][0]['question']['id'] == wrong_id, 'Generated mistake was lost on reload')
    page.locator('#btnAdaptiveReview').click()
    expect(page.locator('#quizQuestionReason')).to_be_visible()
    reviewed = complete(page, len(reloaded_plan['items']))
    require(reviewed[0]['id'] == wrong_id, 'Adaptive session switched away from its planned generated mistake')
    page.reload(wait_until='domcontentloaded')
    modules(page)
    rows = evidence(page)['evidence']
    corrected = next(row for row in rows if row['questionId'] == wrong_id)
    require(corrected['latestCorrect'] and corrected['attempts'] == 2 and corrected['streak'] == 1,
            'Correcting a generated mistake did not persist as fresh evidence')
    require(all(item['question']['id'] != wrong_id for item in review_plan(page)['items']),
            'Corrected generated mistake remains immediately due')
    require(review_plan(page, 'microbit')['hasEvidence'] is False, 'Generated review affected another course')
    return {'wrong_id': wrong_id, 'review_questions': len(reviewed), 'reload_preserves_correction': True}


def personalized_scope(page, fixture):
    goto(page)
    modules(page)
    setup(page, lesson='led', count=3)
    start(page)
    complete(page, 3, wrong_first=True)
    page.locator('#btnBackIntro').click()
    setup(page, count=12)
    page.locator('#quizPersonalized').check()
    start(page)
    expect(page.locator('#quizQuestionReason')).to_be_visible()
    focused = complete(page, 12)
    require({q['lessonId'] for q in focused} == {'led'}, 'Explicit focus did not restrict practice to the weak lesson')
    page.locator('#btnBackIntro').click()
    page.locator('#quizPersonalized').uncheck()
    start(page)
    balanced = complete(page, 12)
    require(set(Counter(q['lessonId'] for q in balanced).values()) == {2}
            and len({q['lessonId'] for q in balanced}) == 6,
            'Turning focus off did not restore even whole-course coverage')
    return {'weak_lesson': 'led', 'focused_questions': 12, 'balanced_lessons': 6}


def configure_ai(page, fixture):
    goto(page)
    catalog = modules(page)
    setup(page, lesson='led', count=3)
    page.locator('#quizAiPlan').check()
    templates = [t for t in catalog['templates'] if t['courseId'] == 'arduino' and t['lessonId'] == 'led']
    preferred = templates[-1]['id']
    fixture['response'] = {'source': 'ai-plan', 'templateIds': [preferred]}
    return preferred


def ai_success(page, fixture):
    preferred = configure_ai(page, fixture)
    fixture['mode'] = 'success'
    start(page)
    question = current_question(page)
    require(question['templateId'] == preferred, 'Valid AI template preference was not applied to first question')
    expect(page.locator('#quizQuestionSourceLabel')).to_contain_text('AI gợi ý dạng bài')
    questions = complete(page, 3)
    expect(page.locator('#quizResultSource')).to_contain_text('AI gợi ý dạng bài')
    require(len(fixture['calls']) == 1, 'AI opt-in did not make exactly one planning request')
    payload = fixture['calls'][0]
    require(payload['courseId'] == 'arduino' and payload['lessonId'] == 'led'
            and payload['count'] == 3 and payload['level'] == 'all', 'Planner request lost selected scope')
    return {'planner_calls': 1, 'preferred_template': preferred, 'canonical_questions_graded': len(questions)}


def fallback(page, fixture, mode):
    configure_ai(page, fixture)
    fixture['mode'] = mode
    if mode == 'invalid':
        fixture['response'] = {'source': 'ai-plan', 'templateIds': ['outside-curriculum-template']}
    if mode == 'timeout':
        page.locator('#btnInitQuiz').click()
        expect(page.locator('#quizGenerationStatus')).to_have_attribute('data-state', 'loading')
        expect(page.locator('#quizActiveGame')).to_be_visible(timeout=26000)
    else:
        start(page)
    expect(page.locator('#quizGenerationStatus')).to_have_attribute('data-state', 'fallback')
    source = page.locator('#quizQuestionSourceLabel').inner_text()
    require('AI gợi ý dạng bài' not in source, 'Fallback incorrectly claimed a successful AI plan')
    questions = complete(page, 3)
    require(all(q['source'] == 'generated' for q in questions), 'Fallback did not use the real local factory')
    expect(page.locator('#quizResultSource')).not_to_contain_text('AI gợi ý dạng bài')
    require(len(fixture['calls']) == 1, 'Fallback retried or omitted the optional planner request')
    return {'failure_mode': mode, 'working_canonical_questions': 3, 'truthful_source': source}


def cancelled_late_reply(page, fixture):
    configure_ai(page, fixture)
    fixture['mode'] = 'hold'
    page.locator('#btnInitQuiz').click()
    expect(page.locator('#quizGenerationStatus')).to_have_attribute('data-state', 'loading')
    expect(page.locator('#quizCancelGeneration')).to_be_visible()
    expect(page.locator('#btnInitQuiz')).to_be_disabled()
    # Scope changes remain usable and invalidate the old in-flight request.
    page.locator('#quizCourseSelect').select_option('microbit')
    page.locator('#quizAiPlan').uncheck()
    page.locator('#quizQuestionCount').select_option('6')
    start(page)
    first_id = current_question(page)['id']
    for route in fixture['held']:
        try:
            route.fulfill(status=200, content_type='application/json',
                          headers={'access-control-allow-origin': '*'}, body=json.dumps(fixture['response']))
        except Exception:
            # An actual AbortController cancellation may already have closed it.
            pass
    page.wait_for_timeout(200)
    require(current_question(page)['id'] == first_id and current_question(page)['courseId'] == 'microbit',
            'Late Arduino AI reply replaced the newer micro:bit session')
    questions = complete(page, 6)
    require(all(q['courseId'] == 'microbit' for q in questions), 'Late reply mixed course questions')
    require(len(fixture['calls']) == 1, 'Unchecked replacement session made an AI request')
    return {'old_request_cancelled': True, 'new_course': 'microbit', 'new_questions': 6}


def explicit_cancel(page, fixture):
    configure_ai(page, fixture)
    fixture['mode'] = 'hold'
    page.locator('#btnInitQuiz').click()
    expect(page.locator('#quizGenerationStatus')).to_have_attribute('data-state', 'loading')
    page.locator('#quizCancelGeneration').click()
    expect(page.locator('#quizGenerationStatus')).to_have_attribute('data-state', 'idle')
    expect(page.locator('#quizActiveGame')).to_be_hidden()
    expect(page.locator('#quizCancelGeneration')).to_be_hidden()
    expect(page.locator('#btnInitQuiz')).to_be_enabled()
    require(not evidence(page)['attempts'], 'Cancelling an unfinished plan created practice evidence')
    page.locator('#quizAiPlan').uncheck()
    start(page)
    complete(page, 3)
    require(len(fixture['calls']) == 1, 'Local practice after cancelling AI issued another planner request')
    return {'cancel_restores_setup': True, 'unfinished_plan_not_saved': True, 'local_retry_questions': 3}


def export_delete_isolation(page, fixture):
    goto(page)
    modules(page)
    sentinels = {ASSESSMENT_KEY: json.dumps({'version': 1, 'participants': [{'code': 'UNCHANGED'}]}),
                 'strobot.original.course.v3': 'keep-learning-journal', 'unrelated-practice-test': 'keep-me'}
    page.evaluate('entries => entries.forEach(([k,v]) => localStorage.setItem(k,v))', list(sentinels.items()))
    setup(page, lesson='led', count=3)
    start(page)
    arduino = complete(page, 3)
    page.locator('#btnBackIntro').click()
    setup(page, course='microbit', lesson='matrix', count=3)
    start(page)
    complete(page, 3)
    page.reload(wait_until='domcontentloaded')
    modules(page)
    page.locator('#quizCourseSelect').select_option('arduino')
    require(len(evidence(page)['attempts']) == 1 and len(evidence(page, 'microbit')['attempts']) == 1,
            'Generated evidence did not survive reload independently by course')
    with page.expect_download() as info:
        page.locator('#btnExportReview').click()
    exported = json.loads(Path(info.value.path()).read_text(encoding='utf-8-sig'))
    require(exported['type'] == 'strobot-practice-backup' and exported['courseId'] == 'arduino',
            'Export lost its format or course scope')
    require(len(exported['attempts']) == 1 and exported['attempts'][0]['mode'] == 'generated',
            'Export omitted generated evidence')
    require({a['questionId'] for a in exported['attempts'][0]['answers']} == {q['id'] for q in arduino},
            'Export did not contain the actual generated answers')
    page.locator('#btnDeleteReview').click()
    page.locator('#btnCancelDeleteReview').click()
    require(evidence(page)['attempts'], 'Cancel deletion erased generated evidence')
    page.locator('#btnDeleteReview').click()
    page.locator('#btnConfirmDeleteReview').click()
    require(not evidence(page)['attempts'], 'Confirmed deletion retained selected generated evidence')
    require(len(evidence(page, 'microbit')['attempts']) == 1, 'Course deletion erased micro:bit evidence')
    actual = page.evaluate('keys => Object.fromEntries(keys.map(k => [k,localStorage.getItem(k)]))', list(sentinels))
    require(actual == sentinels, 'Generated evidence deletion changed assessment or unrelated learning data')
    return {'exported_generated_answers': 3, 'course_only_delete': True, 'assessment_and_journal_preserved': True}


def mobile(page, fixture):
    page.set_viewport_size({'width': 375, 'height': 812})
    goto(page)
    modules(page)
    setup(page, count=18)
    layouts = {'setup': no_overflow(page)}
    start(page)
    layouts['question'] = no_overflow(page)
    require(page.locator('#answerOptionsArea label input').count() >= 3, 'Mobile answers lost labeled controls')
    complete(page, 18, wrong_first=True)
    layouts['summary'] = no_overflow(page)
    page.screenshot(path='/tmp/strobot-generated-practice-mobile.png', full_page=True)
    return {'width': 375, 'layouts': layouts, 'screenshot': '/tmp/strobot-generated-practice-mobile.png'}


CHECKS = [
    ('bank_default', bank_default),
    ('all_five_courses_and_6_12_18_counts', course_coverage),
    ('all_30_lesson_scopes_and_level_controls', lesson_scope_and_levels),
    ('restart_excludes_recent_completed_ids', restart_excludes_completed),
    ('generated_mistake_review_correct_reload', generated_review_reload),
    ('personalized_focus_and_balanced_switch', personalized_scope),
    ('ai_opt_in_valid_template_plan', ai_success),
    ('invalid_ai_plan_falls_back_truthfully', lambda p, f: fallback(p, f, 'invalid')),
    ('unavailable_ai_falls_back_truthfully', lambda p, f: fallback(p, f, 'unavailable')),
    ('network_timeout_falls_back_truthfully', lambda p, f: fallback(p, f, 'network_timeout')),
    ('planner_20_second_abort_falls_back_truthfully', lambda p, f: fallback(p, f, 'timeout')),
    ('explicit_cancel_returns_to_working_setup', explicit_cancel),
    ('cancelled_late_plan_preserves_new_course', cancelled_late_reply),
    ('generated_export_reload_delete_isolation', export_delete_isolation),
    ('generated_mobile_375px', mobile),
]


def main():
    results = [{'name': name, 'status': 'unrun'} for name, _ in CHECKS]

    def save():
        output = {status: sum(row['status'] == status for row in results)
                  for status in ('passed', 'failed', 'skipped', 'unrun')}
        output.update({'base': BASE, 'external_calls': 'blocked; optional planner responses are test fixtures',
                       'results': results})
        Path(args.output).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
        return output

    save()
    try:
        with sync_playwright() as runtime:
            browser = runtime.chromium.launch(executable_path=args.chromium, headless=True,
                                              args=['--no-sandbox', '--disable-dev-shm-usage'])
            for row, (name, check) in zip(results, CHECKS):
                if args.only and not re.search(args.only, name):
                    row.update(status='skipped', details='Excluded by --only filter')
                    save()
                    continue
                started = time.monotonic()
                context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
                fixture = {'mode': 'unexpected', 'calls': [], 'held': [], 'response': {}}
                errors, blocked = [], set()

                def route_request(route):
                    request = route.request
                    parsed = urlparse(request.url)
                    if parsed.path == '/api/practice-plan':
                        headers = {'access-control-allow-origin': '*',
                                   'access-control-allow-methods': 'POST, OPTIONS',
                                   'access-control-allow-headers': 'Content-Type'}
                        if request.method == 'OPTIONS':
                            route.fulfill(status=204, headers=headers)
                            return
                        try:
                            fixture['calls'].append(request.post_data_json)
                        except Exception:
                            fixture['calls'].append({'invalid_body': request.post_data})
                        mode = fixture['mode']
                        if mode in ('hold', 'timeout'):
                            fixture['held'].append(route)
                        elif mode == 'network_timeout':
                            route.abort('timedout')
                        elif mode == 'unavailable' or mode == 'unexpected':
                            route.fulfill(status=503, headers=headers, content_type='application/json',
                                          body=json.dumps({'error': 'test planner unavailable'}))
                        else:
                            route.fulfill(status=200, headers=headers, content_type='application/json',
                                          body=json.dumps(fixture['response']))
                    elif parsed.netloc == urlparse(BASE).netloc or parsed.scheme in ('data', 'blob'):
                        route.continue_()
                    else:
                        blocked.add(parsed.netloc)
                        route.abort()

                context.route('**/*', route_request)
                page = context.new_page()
                page.set_default_timeout(6500)
                page.on('pageerror', lambda error: errors.append(str(error)))
                try:
                    details = check(page, fixture)
                    require(not errors, 'Uncaught browser errors: ' + repr(errors))
                    require(fixture['mode'] != 'unexpected' or not fixture['calls'],
                            'A local-only flow contacted the AI planner without opt-in')
                    row.update(status='passed', details=details)
                    print('PASS', name, flush=True)
                except Exception as error:
                    row.update(status='failed', details=''.join(traceback.format_exception_only(type(error), error)).strip(),
                               page_errors=errors)
                    print('FAIL', name, row['details'], flush=True)
                    try:
                        screenshot = f'/tmp/strobot-generated-practice-failure-{name}.png'
                        page.screenshot(path=screenshot, full_page=True)
                        row['screenshot'] = screenshot
                    except Exception:
                        pass
                finally:
                    row.update(duration_seconds=round(time.monotonic() - started, 2),
                               planner_requests=len(fixture['calls']), blocked_external_hosts=sorted(blocked))
                    # Complete held interception handlers even when browser-side
                    # AbortController has already cancelled the fetch. Leaving
                    # them pending can leak Playwright tasks across contexts.
                    for held_route in fixture['held']:
                        try:
                            held_route.abort('aborted')
                        except Exception:
                            pass
                    context.close()
                    save()
            browser.close()
    except Exception as error:
        print('Harness failed:', error, file=sys.stderr)
        output = save()
        output['harness_error'] = str(error)
        Path(args.output).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
        return 1
    output = save()
    print(json.dumps({key: output[key] for key in ('passed', 'failed', 'skipped', 'unrun')}), flush=True)
    return 1 if output['failed'] or output['unrun'] else 0


if __name__ == '__main__':
    sys.exit(main())
