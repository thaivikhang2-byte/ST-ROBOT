#!/usr/bin/env python3
"""Exercise automatic mixed practice against a locally served checkout.

The browser uses the real local question factory and canonical resolver. Only the
automatic planner HTTP response is stubbed; every other external request is
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
    expect(page.locator('#quizDifficulty')).to_be_visible()


def modules(page):
    return page.evaluate('''async () => {
        const engine = await import('/frontend/src/modules/quiz/generation/QuestionEngine.js');
        const automatic = await import('/frontend/src/modules/quiz/generation/AutomaticPractice.js');
        const {quizCourses, quizQuestions} = await import('/frontend/src/data/quiz.js');
        const {ReviewService} = await import('/frontend/src/modules/quiz/ReviewService.js');
        window.__practiceSmoke = {engine, automatic, quizCourses,
            bank: Object.fromEntries(quizQuestions.map(q => [q.id, q])), ReviewService};
        return {courses: quizCourses, templates: engine.listTemplates()};
    }''')


def canonical(page, question_id):
    question = page.evaluate('''id => {
        const {engine, bank} = window.__practiceSmoke;
        return bank[id] || engine.resolveGeneratedQuestion(id);
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


def complete(page, count, wrong_first=False, wrong_generated=False):
    questions = []
    wrong_count = 0
    for index in range(count):
        question = current_question(page)
        make_wrong = (wrong_first and index == 0) or (
            wrong_generated and wrong_count == 0 and question['id'].startswith('gen:'))
        choice = (question['ans'] + 1) % len(question['opts']) if make_wrong else question['ans']
        wrong_count += int(make_wrong)
        page.locator(f'#answerOptionsArea input[value="{choice}"]').check()
        page.locator('#confirmAnswerBtn').click()
        expect(page.locator('#feedbackBox')).to_contain_text(question['exp'])
        expect(page.locator('#feedbackBox')).to_contain_text(question['opts'][question['ans']])
        expect(page.locator('#answerOptionsArea input').first).to_be_disabled()
        page.locator('#forwardBtn').click()
        questions.append(question)
    expect(page.locator('#quizSummaryArea')).to_be_visible()
    require(not wrong_generated or wrong_count == 1, 'No generated question was available to test a real mistake')
    correct = count - wrong_count
    percent = (correct * 100 * 2 // count + 1) // 2
    expect(page.locator('#quizScorePercent')).to_have_text(f'{percent}%')
    expect(page.locator('#totalScoreText')).to_contain_text(f'{correct} / {count}')
    require(page.locator('#quizReviewList details').count() == count, 'Summary omitted questions')
    require(len({q['id'] for q in questions}) == count, 'A session repeated a question ID')
    return questions


def setup(page, course='arduino', lesson='all', count=6, difficulty='medium'):
    page.locator('#quizCourseSelect').select_option(course)
    page.locator('#quizLessonSelect').select_option(lesson)
    page.locator('#quizDifficulty').select_option(difficulty)
    if page.locator('#quizQuestionCount').input_value() != str(count):
        page.locator('#quizQuestionCount').select_option(str(count))


def start(page):
    page.locator('#btnInitQuiz').click()
    expect(page.locator('#quizActiveGame')).to_be_visible(timeout=7000)


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


def open_progress(page):
    if not page.locator('#quizProgressDetails').evaluate('(details) => details.open'):
        page.locator('#quizProgressDetails > summary').click()


def source_counts(questions):
    generated = sum(q['id'].startswith('gen:') for q in questions)
    return {'bank': len(questions) - generated, 'generated': generated}


def eligible_templates(page, course, lesson='all', difficulty='medium'):
    return page.evaluate('''scope => window.__practiceSmoke.automatic.listAutomaticTemplates(scope)''',
                         {'courseId': course, 'lessonId': lesson, 'difficulty': difficulty})


def wait_for_planner_calls(page, fixture, expected):
    deadline = time.monotonic() + 2
    while len(fixture['calls']) < expected and time.monotonic() < deadline:
        page.wait_for_timeout(20)
    require(len(fixture['calls']) == expected, 'Expected planner request was not intercepted')


def simple_setup(page, fixture):
    goto(page)
    modules(page)
    expect(page.locator('#quizDifficulty')).to_have_value('medium')
    values = page.locator('#quizDifficulty option').evaluate_all('(options) => options.map(o => o.value)')
    require(values == ['easy', 'medium', 'hard'], 'Difficulty must have exactly three understandable choices')
    require(page.locator('#quizDifficulty option').all_text_contents() == ['Dễ', 'Vừa', 'Khó'],
            'Difficulty labels do not match the simplified interface')
    for selector in ('#quizQuestionSource', '#quizGeneratedSettings', '#quizGeneratedLevel',
                     '#quizPersonalized', '#quizAiPlan', '#btnGeneratedPractice',
                     '#quizQuestionSourceLabel', '#quizResultSource'):
        require(page.locator(selector).count() == 0, 'Obsolete source or AI control remains: ' + selector)
    controls = page.locator('#quizSetupForm select').evaluate_all('(selects) => selects.map(s => s.id).sort()')
    require(controls == sorted(['quizCourseSelect', 'quizLessonSelect', 'quizQuestionCount', 'quizDifficulty']),
            'Setup contains extra technical choices: ' + repr(controls))
    require(not page.locator('#quizProgressDetails').evaluate('(details) => details.open'),
            'Progress and data should be collapsed on first load')
    expect(page.locator('#quizProgressDetails > summary')).to_have_text('Tiến độ và dữ liệu')
    expect(page.locator('#btnAdaptiveReview')).to_have_text('Ôn theo kết quả')
    expect(page.locator('#btnAdaptiveReview')).to_be_visible()
    setup(page, count=18)
    layout = no_overflow(page)
    page.screenshot(path='/tmp/strobot-automatic-practice-desktop-setup.png', full_page=True)
    require(not fixture['calls'], 'Planner started before the user requested a quiz')
    return {'setup_selects': controls, 'difficulty_values': values, 'layout': layout,
            'screenshot': '/tmp/strobot-automatic-practice-desktop-setup.png'}


def course_coverage(page, fixture):
    goto(page)
    catalog = modules(page)
    observations = []
    for course, count in zip(COURSES, (6, 12, 18, 6, 18)):
        setup(page, course=course, count=count)
        start(page)
        questions = complete(page, count)
        expected_lessons = {l['id'] for c in catalog['courses'] if c['id'] == course for l in c['lessons']}
        counts = Counter(q['lessonId'] for q in questions)
        require(set(counts) == expected_lessons, 'Whole-course practice missed a lesson: ' + course)
        require(set(counts.values()) == {count // 6}, 'Automatic practice lost balanced coverage: ' + repr(counts))
        require(all(q['courseId'] == course for q in questions), 'Practice crossed course boundaries')
        sources = source_counts(questions)
        if count == 18:
            require(sources['bank'] > 0 and sources['generated'] > 0, 'Automatic practice did not combine both sources')
            require(sources['generated'] > sources['bank'], 'Fresh variants should form most of a new full-length session')
        page.locator('#btnBackIntro').click()
        observations.append({'course': course, 'count': count, 'lessons': dict(counts), 'sources': sources})
    stored = page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', REVIEW_KEY)
    require(len(stored['attempts']) == 5 and all(a['mode'] == 'generated' for a in stored['attempts']),
            'Automatic completions did not save practice evidence')
    require(page.evaluate('(key) => JSON.parse(localStorage.getItem(key) || "[]")', HISTORY_KEY) == [],
            'Mixed practice contaminated the old fixed-bank score history')
    require(fixture['calls'], 'Starting automatic practice never requested a planner')
    return {'courses': observations, 'canonical_questions_graded': sum(o['count'] for o in observations)}


def lesson_scopes(page, fixture):
    goto(page)
    catalog = modules(page)
    scopes = page.evaluate('''() => {
        const {engine, automatic, quizCourses, bank} = window.__practiceSmoke;
        return quizCourses.flatMap(course => course.lessons.map(lesson => {
            const questions = automatic.createAutomaticPractice({courseId: course.id,
                lessonId: lesson.id, count: 6, difficulty: 'medium', seed: 'browser-lesson-scope'});
            return {courseId: course.id, lessonId: lesson.id, questions,
                resolved: questions.map(q => bank[q.id] || engine.resolveGeneratedQuestion(q.id))};
        }));
    }''')
    require(len(scopes) == 30, 'Expected all 30 curriculum lesson scopes')
    for scope in scopes:
        require(len(scope['questions']) == 6 and len({q['id'] for q in scope['questions']}) == 6,
                'Automatic lesson factory returned a wrong count or duplicate IDs')
        for question, resolved in zip(scope['questions'], scope['resolved']):
            require(resolved and all(question[key] == resolved[key] for key in ('id', 'q', 'opts', 'ans', 'exp')),
                    'An automatic question did not reconstruct its exact canonical content')
            require(question['courseId'] == scope['courseId'] and question['lessonId'] == scope['lessonId'],
                    'Automatic factory escaped the chosen lesson')
    observed = []
    for course in catalog['courses']:
        lesson = course['lessons'][0]['id']
        setup(page, course=course['id'], lesson=lesson, count=3, difficulty='hard')
        allowed = {t['id'] for t in eligible_templates(page, course['id'], lesson, 'hard')}
        start(page)
        expect(page.locator('#quizActiveGame')).to_have_attribute('data-difficulty', 'hard')
        questions = complete(page, 3)
        require(all(q['courseId'] == course['id'] and q['lessonId'] == lesson for q in questions),
                'Lesson selector did not constrain the actual questions')
        require(all(q['templateId'] in allowed if q['id'].startswith('gen:') else q['id'].endswith(':reason')
                    for q in questions), 'Hard practice used an ineligible question')
        observed.append({'course': course['id'], 'lesson': lesson, 'sources': source_counts(questions)})
        page.locator('#btnBackIntro').click()
    return {'factory_lesson_scopes': 30, 'canonical_round_trips': 180, 'ui_scopes': observed}


def difficulty_changes_questions(page, fixture):
    goto(page)
    modules(page)
    observations = []
    for difficulty, bank_kind in (('easy', 'core'), ('medium', 'apply'), ('hard', 'reason')):
        setup(page, lesson='led', count=12, difficulty=difficulty)
        start(page)
        expect(page.locator('#quizActiveGame')).to_have_attribute('data-difficulty', difficulty)
        questions = complete(page, 12)
        generated = [q for q in questions if q['id'].startswith('gen:')]
        bank = [q for q in questions if not q['id'].startswith('gen:')]
        require(generated and bank, 'Difficulty did not retain the automatic mix')
        require(all(q['id'].endswith(':' + bank_kind) for q in bank),
                'Difficulty did not change the bank question category')
        levels = {q['level'] for q in generated}
        expected = {'basic'} if difficulty == 'easy' else {'apply'} if difficulty == 'hard' else {'basic', 'apply'}
        require(levels == expected, 'Arduino LED difficulty changed only the label: ' + repr(levels))
        observations.append({'difficulty': difficulty, 'generated_levels': sorted(levels),
                             'bank_kind': bank_kind, 'sources': source_counts(questions)})
        page.locator('#btnBackIntro').click()
    return {'questions_graded': 36, 'actual_composition': observations}


def restart_excludes_completed(page, fixture):
    goto(page)
    modules(page)
    setup(page, lesson='led', count=6)
    start(page)
    first = complete(page, 6)
    page.locator('#btnRestartQuiz').click()
    second = complete(page, 6)
    overlap = {q['id'] for q in first} & {q['id'] for q in second}
    require(not overlap, 'Restart repeated recent completed IDs: ' + repr(overlap))
    require(len(evidence(page)['attempts']) == 2, 'Restart did not save each completion exactly once')
    return {'first_sources': source_counts(first), 'restart_sources': source_counts(second), 'repeated_ids': 0}


def mixed_review_reload(page, fixture):
    goto(page)
    modules(page)
    setup(page, lesson='led', count=6)
    start(page)
    initial = complete(page, 6, wrong_generated=True)
    wrong_id = next(q['id'] for q in initial if q['id'].startswith('gen:'))
    plan = review_plan(page)
    require(plan['items'] and plan['items'][0]['question']['id'] == wrong_id,
            'Adaptive review did not reconstruct the latest mistake first')
    require(plan['items'][0]['reasonType'] == 'wrong', 'Review omitted its selection reason')
    for item in plan['items']:
        resolved = canonical(page, item['question']['id'])
        require(all(item['question'][key] == resolved[key] for key in ('id', 'q', 'opts', 'ans', 'exp')),
                'Review altered canonical mixed-practice content')
    page.reload(wait_until='domcontentloaded')
    modules(page)
    page.locator('#quizCourseSelect').select_option('arduino')
    reloaded_plan = review_plan(page)
    require(reloaded_plan['items'][0]['question']['id'] == wrong_id, 'Mistake was lost on reload')
    page.locator('#btnAdaptiveReview').click()
    expect(page.locator('#quizQuestionReason')).to_be_visible()
    reviewed = complete(page, len(reloaded_plan['items']))
    require(reviewed[0]['id'] == wrong_id, 'Adaptive session ignored its planned mistake')
    page.reload(wait_until='domcontentloaded')
    modules(page)
    corrected = next(row for row in evidence(page)['evidence'] if row['questionId'] == wrong_id)
    require(corrected['latestCorrect'] and corrected['attempts'] == 2 and corrected['streak'] == 1,
            'Correcting a mistake did not persist as fresh evidence')
    require(all(item['question']['id'] != wrong_id for item in review_plan(page)['items']),
            'Corrected mistake remains immediately due')
    require(not review_plan(page, 'microbit')['hasEvidence'], 'Review changed another course')
    return {'wrong_id': wrong_id, 'initial_sources': source_counts(initial),
            'review_questions': len(reviewed), 'reload_preserves_correction': True}


def configure_ai(page, fixture, course='arduino', lesson='led', count=6):
    goto(page)
    modules(page)
    setup(page, course=course, lesson=lesson, count=count)
    preferred = eligible_templates(page, course, lesson)[-1]['id']
    fixture['response'] = {'source': 'ai-plan', 'templateIds': [preferred]}
    return preferred


def ai_success_cache(page, fixture):
    preferred = configure_ai(page, fixture)
    fixture['mode'] = 'success'
    start(page)
    expect(page.locator('#quizActiveGame')).to_have_attribute('data-plan-source', 'ai')
    questions = complete(page, 6)
    generated = [q for q in questions if q['id'].startswith('gen:')]
    require(generated[0]['templateId'] == preferred,
            'AI preference did not affect the first actual generated task in medium practice')
    require(len(fixture['calls']) == 1, 'Automatic start did not request exactly one plan')
    payload = fixture['calls'][0]
    require(payload['courseId'] == 'arduino' and payload['lessonId'] == 'led' and payload['count'] == 6
            and payload['difficulty'] == 'medium', 'Planner request lost selected difficulty or scope')
    require(not any(re.search('key|token|secret', key, re.I) for key in payload),
            'Frontend planner request contains a credential field')
    require(all(not any(re.search('authorization|api-key', key, re.I) for key in headers)
                for headers in fixture['headers']), 'Frontend planner request sent an API credential')
    page.locator('#btnRestartQuiz').click()
    expect(page.locator('#quizActiveGame')).to_be_visible()
    expect(page.locator('#quizActiveGame')).to_have_attribute('data-plan-source', 'ai')
    second = complete(page, 6)
    require(len(fixture['calls']) == 1, 'Same-scope restart ignored the successful plan cache')
    require(not ({q['id'] for q in questions if q['id'].startswith('gen:')} & {q['id'] for q in second}),
            'Cached AI plan reused recent generated questions')
    return {'planner_calls': 1, 'preferred_template': preferred, 'cached_restart_questions': 6}


def fallback(page, fixture, mode):
    configure_ai(page, fixture)
    fixture['mode'] = mode
    if mode == 'invalid':
        fixture['response'] = {'source': 'ai-plan', 'templateIds': ['outside-curriculum-template']}
    started = time.monotonic()
    start(page)
    elapsed = time.monotonic() - started
    expect(page.locator('#quizActiveGame')).to_have_attribute('data-plan-source', 'fallback')
    expect(page.locator('#quizGenerationStatus')).to_have_attribute('data-state', 'ready')
    questions = complete(page, 6)
    require(source_counts(questions)['generated'] > 0, 'Planner failure did not reach the real local factory')
    require(len(fixture['calls']) == 1, 'Planner failure retried or omitted its request')
    if mode == 'timeout':
        require(elapsed <= 5.5, 'Automatic fallback exceeded the 4-second wait plus browser overhead')
    return {'failure_mode': mode, 'working_canonical_questions': 6, 'start_seconds': round(elapsed, 2)}


def failure_cooldown(page, fixture):
    configure_ai(page, fixture)
    fixture['mode'] = 'unavailable'
    start(page)
    first = complete(page, 6)
    fixture['mode'] = 'success'
    page.locator('#btnRestartQuiz').click()
    expect(page.locator('#quizActiveGame')).to_be_visible()
    complete(page, 6)
    require(len(fixture['calls']) == 1, 'Immediate retry ignored the failure cooldown')
    return {'planner_requests_during_cooldown': 1, 'completed_sessions': 2, 'first_sources': source_counts(first)}


def cancelled_late_reply(page, fixture):
    configure_ai(page, fixture)
    old_response = dict(fixture['response'])
    fixture['mode'] = 'hold'
    page.locator('#btnInitQuiz').click()
    expect(page.locator('#quizGenerationStatus')).to_have_attribute('data-state', 'loading')
    wait_for_planner_calls(page, fixture, 1)
    expect(page.locator('#quizCancelGeneration')).to_be_visible()
    expect(page.locator('#btnInitQuiz')).to_be_disabled()
    old_routes = list(fixture['held'])
    page.locator('#quizCourseSelect').select_option('microbit')
    preferred = eligible_templates(page, 'microbit')[0]['id']
    fixture['response'] = {'source': 'ai-plan', 'templateIds': [preferred]}
    fixture['mode'] = 'success'
    start(page)
    first_id = current_question(page)['id']
    for route in old_routes:
        try:
            route.fulfill(status=200, content_type='application/json',
                          headers={'access-control-allow-origin': '*'}, body=json.dumps(old_response))
        except Exception:
            pass
    page.wait_for_timeout(200)
    require(current_question(page)['id'] == first_id and current_question(page)['courseId'] == 'microbit',
            'Late Arduino plan replaced the newer micro:bit session')
    questions = complete(page, 6)
    require(all(q['courseId'] == 'microbit' for q in questions), 'Late reply mixed course questions')
    require(len(fixture['calls']) == 2, 'Cancelling one scope blocked or duplicated the new scope planner')
    return {'old_request_cancelled': True, 'new_course': 'microbit', 'planner_calls': 2}


def explicit_cancel(page, fixture):
    configure_ai(page, fixture)
    fixture['mode'] = 'hold'
    page.locator('#btnInitQuiz').click()
    expect(page.locator('#quizGenerationStatus')).to_have_attribute('data-state', 'loading')
    wait_for_planner_calls(page, fixture, 1)
    page.locator('#quizCancelGeneration').click()
    expect(page.locator('#quizGenerationStatus')).to_have_attribute('data-state', 'idle')
    expect(page.locator('#quizActiveGame')).to_be_hidden()
    expect(page.locator('#quizCancelGeneration')).to_be_hidden()
    expect(page.locator('#btnInitQuiz')).to_be_enabled()
    require(not evidence(page)['attempts'], 'Cancelling an unfinished plan created evidence')
    fixture['mode'] = 'unavailable'
    start(page)
    complete(page, 6)
    require(len(fixture['calls']) == 2, 'Cancelled request incorrectly populated a cache or failure cooldown')
    return {'cancel_restores_setup': True, 'unfinished_plan_not_saved': True, 'retry_planner_calls': 2}


def export_delete_isolation(page, fixture):
    goto(page)
    modules(page)
    sentinels = {ASSESSMENT_KEY: json.dumps({'version': 1, 'participants': [{'code': 'UNCHANGED'}]}),
                 'strobot.original.course.v3': 'keep-learning-journal', 'unrelated-practice-test': 'keep-me'}
    page.evaluate('entries => entries.forEach(([k,v]) => localStorage.setItem(k,v))', list(sentinels.items()))
    setup(page, lesson='led', count=6)
    start(page)
    arduino = complete(page, 6)
    page.locator('#btnBackIntro').click()
    setup(page, course='microbit', lesson='matrix', count=6)
    start(page)
    complete(page, 6)
    page.reload(wait_until='domcontentloaded')
    modules(page)
    page.locator('#quizCourseSelect').select_option('arduino')
    require(len(evidence(page)['attempts']) == 1 and len(evidence(page, 'microbit')['attempts']) == 1,
            'Mixed evidence did not survive reload independently by course')
    page.locator('#quizLessonSelect').select_option('led')
    open_progress(page)
    expect(page.locator('#quizHistory')).to_contain_text('6/6 đúng')
    with page.expect_download() as info:
        page.locator('#btnExportReview').click()
    exported = json.loads(Path(info.value.path()).read_text(encoding='utf-8-sig'))
    require(exported['type'] == 'strobot-practice-backup' and exported['courseId'] == 'arduino',
            'Export lost its format or course scope')
    require(len(exported['attempts']) == 1 and exported['attempts'][0]['mode'] == 'generated',
            'Export omitted automatic practice evidence')
    require({a['questionId'] for a in exported['attempts'][0]['answers']} == {q['id'] for q in arduino},
            'Export did not contain actual mixed-practice answers')
    page.locator('#btnDeleteReview').click()
    page.locator('#btnCancelDeleteReview').click()
    require(evidence(page)['attempts'], 'Cancel deletion erased evidence')
    page.locator('#btnDeleteReview').click()
    page.locator('#btnConfirmDeleteReview').click()
    require(not evidence(page)['attempts'], 'Confirmed deletion retained selected course evidence')
    require(len(evidence(page, 'microbit')['attempts']) == 1, 'Course deletion erased micro:bit evidence')
    actual = page.evaluate('keys => Object.fromEntries(keys.map(k => [k,localStorage.getItem(k)]))', list(sentinels))
    require(actual == sentinels, 'Practice deletion changed assessment or unrelated learning data')
    return {'exported_answers': 6, 'exported_sources': source_counts(arduino),
            'practice_history_survives_reload': True, 'course_only_delete': True,
            'assessment_and_journal_preserved': True}


def mobile(page, fixture):
    page.set_viewport_size({'width': 375, 'height': 812})
    goto(page)
    modules(page)
    setup(page, count=18, difficulty='hard')
    layouts = {'setup': no_overflow(page)}
    page.screenshot(path='/tmp/strobot-automatic-practice-mobile-setup.png', full_page=True)
    start(page)
    layouts['question'] = no_overflow(page)
    require(page.locator('#answerOptionsArea label input').count() >= 3, 'Mobile answers lost labeled controls')
    complete(page, 18, wrong_first=True)
    layouts['summary'] = no_overflow(page)
    page.screenshot(path='/tmp/strobot-automatic-practice-mobile-results.png', full_page=True)
    return {'width': 375, 'layouts': layouts, 'setup_screenshot': '/tmp/strobot-automatic-practice-mobile-setup.png',
            'summary_screenshot': '/tmp/strobot-automatic-practice-mobile-results.png'}


CHECKS = [
    ('simple_setup_has_only_scope_count_and_difficulty', simple_setup),
    ('automatic_all_five_courses_and_6_12_18_counts', course_coverage),
    ('automatic_all_30_lesson_scopes', lesson_scopes),
    ('difficulty_changes_real_question_composition', difficulty_changes_questions),
    ('restart_excludes_recent_completed_variants', restart_excludes_completed),
    ('mixed_mistake_review_correct_reload', mixed_review_reload),
    ('automatic_ai_valid_plan_and_success_cache', ai_success_cache),
    ('invalid_ai_ids_fall_back', lambda p, f: fallback(p, f, 'invalid')),
    ('malformed_ai_json_falls_back', lambda p, f: fallback(p, f, 'malformed_json')),
    ('unavailable_ai_falls_back', lambda p, f: fallback(p, f, 'unavailable')),
    ('network_timeout_falls_back', lambda p, f: fallback(p, f, 'network_timeout')),
    ('planner_four_second_timeout_falls_back', lambda p, f: fallback(p, f, 'timeout')),
    ('planner_failure_cooldown_preserves_practice', failure_cooldown),
    ('explicit_cancel_returns_to_working_setup', explicit_cancel),
    ('cancelled_late_plan_preserves_new_course', cancelled_late_reply),
    ('mixed_export_reload_delete_isolation', export_delete_isolation),
    ('automatic_mobile_375px', mobile),
]


def main():
    results = [{'name': name, 'status': 'unrun'} for name, _ in CHECKS]

    def save():
        output = {status: sum(row['status'] == status for row in results)
                  for status in ('passed', 'failed', 'skipped', 'unrun')}
        output.update({'base': BASE, 'external_calls': 'blocked; automatic planner responses are test fixtures',
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
                fixture = {'mode': 'unavailable', 'calls': [], 'headers': [], 'held': [], 'response': {}}
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
                        fixture['headers'].append(request.headers)
                        mode = fixture['mode']
                        if mode in ('hold', 'timeout'):
                            fixture['held'].append(route)
                        elif mode == 'network_timeout':
                            route.abort('timedout')
                        elif mode == 'unavailable':
                            route.fulfill(status=503, headers=headers, content_type='application/json',
                                          body=json.dumps({'error': 'test planner unavailable'}))
                        elif mode == 'malformed_json':
                            route.fulfill(status=200, headers=headers, content_type='application/json', body='{broken-json')
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
