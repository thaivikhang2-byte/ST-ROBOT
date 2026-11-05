#!/usr/bin/env python3
"""Browser checks for completed-attempt review and the held-out evaluation workflow.

Run with the checkout served locally:
    python3 tests/learning-evidence-smoke.py --base http://127.0.0.1:5500

Every test uses a separate browser context. External connections are blocked;
no participant data, credentials, AI endpoint or simulator is required.
"""
import argparse
import csv
import io
import json
from pathlib import Path
import re
import sys
import traceback
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright, expect


parser = argparse.ArgumentParser()
parser.add_argument('--base', default='http://127.0.0.1:5500')
parser.add_argument('--chromium', default='/usr/bin/chromium')
parser.add_argument('--output', default='/tmp/strobot-learning-evidence-results.json')
args = parser.parse_args()
BASE = args.base.rstrip('/')
PUBLIC = BASE + '/frontend/public/'
REVIEW_KEY = 'strobot.review.evidence.v1'
results = []


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def goto(page, path):
    page.goto(PUBLIC + path, wait_until='domcontentloaded')
    page.evaluate('() => document.fonts.ready.then(() => true)')


def no_overflow(page):
    sizes = page.evaluate('''() => ({viewport: innerWidth,
        body: document.body.scrollWidth, html: document.documentElement.scrollWidth})''')
    require(max(sizes['body'], sizes['html']) <= sizes['viewport'] + 1,
            'Horizontal page overflow: ' + repr(sizes))
    return sizes


def ordinary_bank(page):
    return page.evaluate('''async () => {
        const {quizQuestions} = await import(new URL('../src/data/quiz.js?v=quiz-20261103-v3', location.href));
        return Object.fromEntries(quizQuestions.map(question => [question.id, question]));
    }''')


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


def open_progress(page):
    details = page.locator('#quizProgressDetails')
    if details.get_attribute('open') is None:
        details.locator(':scope > summary').click()


def review_plan(page, course='arduino'):
    return page.evaluate('''async course => {
        const {ReviewService} = await import(new URL('../src/modules/quiz/ReviewService.js?v=quiz-20261103-v3', location.href));
        return new ReviewService().plan(course);
    }''', course)


def complete_quiz(page, bank, count, wrong_first=False):
    observed = []
    expect(page.locator('#quizActiveGame')).to_be_visible()
    for index in range(count):
        question_id = page.locator('#quizActiveGame').get_attribute('data-question-id')
        question = resolve_question(page, question_id, bank)
        choice = (question['ans'] + 1) % len(question['opts']) if wrong_first and index == 0 else question['ans']
        page.locator(f'#answerOptionsArea input[value="{choice}"]').check()
        page.locator('#confirmAnswerBtn').click()
        expect(page.locator('#feedbackBox')).to_contain_text(question['exp'])
        page.locator('#forwardBtn').click()
        observed.append(question_id)
    expect(page.locator('#quizSummaryArea')).to_be_visible()
    return observed


def start_lesson_quiz(page, course='arduino', lesson='led'):
    page.locator('#quizCourseSelect').select_option(course)
    page.locator('#quizLessonSelect').select_option(lesson)
    page.locator('#btnInitQuiz').click()


def adaptive_completed_and_aborted(page):
    goto(page, 'quiz.html')
    bank = ordinary_bank(page)
    start_lesson_quiz(page)
    attempted = complete_quiz(page, bank, 3, wrong_first=True)
    saved = page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', REVIEW_KEY)
    require(len(saved['attempts']) == 1, 'Ordinary completion did not create exactly one evidence attempt')
    require(saved['attempts'][0]['mode'] == 'generated', 'Automatic mixed practice did not use its detailed evidence record')
    require(len(saved['attempts'][0]['answers']) == 3, 'Detailed choices are missing from completed evidence')
    plan = review_plan(page)
    require(plan['items'][0]['question']['id'] == attempted[0], 'Latest wrong question is not first in the review plan')
    require(plan['items'][0]['reasonType'] == 'wrong', 'Review does not explain why the question was selected')
    require(all(item['question']['courseId'] == 'arduino' for item in plan['items']), 'Review crossed course boundaries')
    page.locator('#btnBackIntro').click()
    open_progress(page)
    expect(page.locator('#reviewEvidence')).to_contain_text('LED')
    page.locator('#quizCourseSelect').select_option('microbit')
    require(review_plan(page, 'microbit')['hasEvidence'] is False, 'Arduino work affected micro:bit evidence')
    expect(page.locator('#btnAdaptiveReview')).to_be_disabled()
    page.locator('#quizCourseSelect').select_option('arduino')
    page.locator('#btnAdaptiveReview').click()
    expect(page.locator('#quizQuestionReason')).to_be_visible()
    expect(page.locator('#quizQuestionReason')).to_contain_text('gần nhất')
    question_id = page.locator('#quizActiveGame').get_attribute('data-question-id')
    question = resolve_question(page, question_id, bank)
    page.locator(f'#answerOptionsArea input[value="{question["ans"]}"]').check()
    page.locator('#confirmAnswerBtn').click()
    page.locator('#quizExitBtn').click()
    page.locator('#quizDiscardBtn').click()
    require(page.evaluate('(key) => JSON.parse(localStorage.getItem(key)).attempts.length', REVIEW_KEY) == 1,
            'Aborted review changed completed evidence')
    page.reload(wait_until='domcontentloaded')
    page.locator('#quizCourseSelect').select_option('arduino')
    require(review_plan(page)['items'][0]['question']['id'] == attempted[0], 'Plan did not survive page reload')
    page.locator('#btnAdaptiveReview').click()
    reviewed = complete_quiz(page, bank, len(plan['items']))
    require(reviewed == [item['question']['id'] for item in plan['items']], 'Review did not use the planned questions in order')
    require(reviewed[0] == attempted[0], 'Review did not prioritize the latest wrong question')
    next_plan = review_plan(page)
    require(next_plan['items'] == [], 'Corrected question still appears immediately as an unresolved error')
    require(next_plan['nextDueAt'], 'A corrected question has no next review date')
    require(len(page.evaluate('(key) => JSON.parse(localStorage.getItem(key)).attempts', REVIEW_KEY)) == 2,
            'Completed review was not saved once')
    page.locator('#btnBackIntro').click()
    expect(page.locator('#btnAdaptiveReview')).to_be_disabled()
    return {'ordinary_questions': 3, 'review_questions': len(reviewed), 'aborted_attempt_ignored': True,
            'course_isolation': True, 'reload_persists': True, 'next_due_at': next_plan['nextDueAt']}


def review_export_and_targeted_delete(page):
    goto(page, 'quiz.html')
    bank = ordinary_bank(page)
    page.evaluate('localStorage.setItem("unrelated-browser-data", "keep-me")')
    start_lesson_quiz(page)
    complete_quiz(page, bank, 3)
    page.locator('#btnBackIntro').click()
    microbit_lesson = next(question['lessonId'] for question in bank.values() if question['courseId'] == 'microbit')
    start_lesson_quiz(page, 'microbit', microbit_lesson)
    complete_quiz(page, bank, 3)
    page.locator('#btnBackIntro').click()
    page.locator('#quizCourseSelect').select_option('arduino')
    open_progress(page)
    with page.expect_download() as download_info:
        page.locator('#btnExportReview').click()
    backup = json.loads(Path(download_info.value.path()).read_text(encoding='utf-8-sig'))
    require(backup['type'] == 'strobot-practice-backup' and backup['courseId'] == 'arduino',
            'Practice export lacks its explicit format or course scope')
    require(len(backup['attempts']) == 1 and len(backup['attempts'][0]['answers']) == 3,
            'Practice export omitted the actual recorded answers')
    # Old aggregate history remains readable and must be cleared only for the
    # selected course; new mixed sessions are stored as per-question evidence.
    history_before = [{'id': 'legacy-' + course, 'courseId': course, 'lessonId': 'all',
                       'correct': 1, 'total': 3, 'percentage': 33, 'createdAt': '2026-11-01T00:00:00Z'}
                      for course in ['arduino', 'microbit']]
    page.evaluate('(records) => localStorage.setItem("strobot.quiz.history.v1", JSON.stringify(records))', history_before)
    page.locator('#btnDeleteReview').click()
    expect(page.locator('#reviewDeleteDialog')).to_be_visible()
    page.locator('#btnCancelDeleteReview').click()
    require(review_plan(page)['hasEvidence'], 'Canceling deletion erased evidence')
    page.locator('#btnDeleteReview').click()
    page.locator('#btnConfirmDeleteReview').click()
    require(not review_plan(page)['hasEvidence'], 'Confirmed deletion left the selected course evidence')
    require(review_plan(page, 'microbit')['hasEvidence'], 'Deleting Arduino evidence also erased another course')
    history_after = page.evaluate('JSON.parse(localStorage.getItem("strobot.quiz.history.v1"))')
    require(history_after == [record for record in history_before if record['courseId'] != 'arduino'],
            'Course-only deletion did not preserve ordinary history for other courses')
    require(page.evaluate('localStorage.getItem("unrelated-browser-data")') == 'keep-me',
            'Feature deletion erased unrelated browser data')
    return {'exported_attempts': len(backup['attempts']), 'exported_answers': 3,
            'cancel_preserves_data': True, 'confirmed_course_only_delete': True}


def corrupt_review_storage(page):
    goto(page, 'quiz.html')
    page.evaluate('(key) => localStorage.setItem(key, "{broken-json")', REVIEW_KEY)
    page.reload(wait_until='domcontentloaded')
    page.locator('#quizCourseSelect').select_option('arduino')
    open_progress(page)
    expect(page.locator('#reviewPlanStatus')).to_contain_text('không hợp lệ')
    expect(page.locator('#btnAdaptiveReview')).to_be_disabled()
    bank = ordinary_bank(page)
    start_lesson_quiz(page)
    complete_quiz(page, bank, 3, wrong_first=True)
    expect(page.locator('#reviewSaveNotice')).to_contain_text('dữ liệu lỗi')
    require(review_plan(page)['hasEvidence'], 'A real completion could not recover corrupt review storage')
    return {'malformed_data_reported': True, 'ordinary_practice_available': True, 'completed_work_recovers_evidence': True}


def blocked_review_storage(page):
    goto(page, 'quiz.html')
    page.locator('#quizCourseSelect').select_option('arduino')
    open_progress(page)
    expect(page.locator('#btnAdaptiveReview')).to_be_disabled()
    expect(page.locator('#reviewPlanStatus')).to_contain_text('chặn')
    bank = ordinary_bank(page)
    start_lesson_quiz(page)
    complete_quiz(page, bank, 3, wrong_first=True)
    expect(page.locator('#reviewSaveNotice')).to_contain_text('Chưa lưu được')
    require(review_plan(page)['hasEvidence'] is False, 'Blocked storage was represented as durable evidence')
    return {'storage_blocked_reported': True, 'answers_and_score_still_usable': True, 'no_false_saved_claim': True}


def assessment_bank(page):
    return page.evaluate('''async () => {
        const {ASSESSMENT_FORMS} = await import(new URL('../src/data/assessment.js?v=study-20261103-v1', location.href));
        return Object.fromEntries(Object.values(ASSESSMENT_FORMS).flat().map(question => [question.id, question]));
    }''')


def assessment_snapshot(page, code='HS001'):
    return page.evaluate('''async code => {
        const {AssessmentService} = await import(new URL('../src/modules/assessment/AssessmentService.js?v=study-20261103-v1', location.href));
        const service = new AssessmentService();
        return {participant: service.getParticipant(code), result: service.participantResult(code), report: service.report()};
    }''', code)


def create_participant(page, code='HS001', group='fixed', order='AB'):
    page.locator('#assessmentCode').fill(code)
    page.locator('#assessmentGroup').select_option(group)
    page.locator('#assessmentOrder').select_option(order)
    page.locator('#assessmentCreateForm button[type="submit"]').click()
    expect(page.locator('#assessmentParticipantTitle')).to_contain_text(code.upper())


def fill_assessment(page, bank, wrong_first=False, start=0, stop=12):
    fields = page.locator('#assessmentQuestions fieldset[data-question-id]')
    expect(fields).to_have_count(12)
    for index in range(start, stop):
        field = fields.nth(index)
        question_id = field.get_attribute('data-question-id')
        question = bank[question_id]
        choice = (question['ans'] + 1) % len(question['opts']) if wrong_first and index == 0 else question['ans']
        field.locator(f'input[value="{choice}"]').check()
        expect(page.locator('#assessmentProgress')).to_contain_text(f'{index + 1}/12')
        require(field.locator('.answer-correct, .answer-wrong').count() == 0,
                'Assessment reveals correctness before the pair is complete')
    require('Đáp án đúng:' not in page.locator('#assessmentQuestions').inner_text(),
            'Assessment exposes explanations during answer entry')


def download_csv(page):
    with page.expect_download() as download_info:
        page.locator('#assessmentExportCsv').click()
    raw = Path(download_info.value.path()).read_text(encoding='utf-8-sig')
    return list(csv.DictReader(io.StringIO(raw)))


def assessment_pair_resume_export(page):
    goto(page, 'assessment.html')
    bank = assessment_bank(page)
    practice = ordinary_bank(page)
    require(len(bank) == 24 and not set(bank).intersection(practice), 'Held-out assessment and practice IDs overlap')
    require(not {q['q'] for q in bank.values()}.intersection(q['q'] for q in practice.values()),
            'Held-out assessment repeats a practice question verbatim')
    page.evaluate('localStorage.setItem("unrelated-browser-data", "keep-me")')
    create_participant(page)
    expect(page.locator('#assessmentSetup')).to_be_hidden()
    expect(page.locator('#assessmentStartPost')).to_have_count(0)
    initial = assessment_snapshot(page)['participant']
    page.locator('#assessmentStartPre').click()
    expect(page.locator('#assessmentSubmitBtn')).to_be_disabled()
    fill_assessment(page, bank, wrong_first=True, stop=1)
    started_at = assessment_snapshot(page)['participant']['stages']['pre']['startedAt']
    choice = page.locator('#assessmentQuestions fieldset').first.locator('input:checked').get_attribute('value')
    page.reload(wait_until='domcontentloaded')
    expect(page.locator('#assessmentGame')).to_be_visible()
    expect(page.locator('#assessmentProgress')).to_contain_text('1/12')
    expect(page.locator('#assessmentQuestions fieldset').first.locator(f'input[value="{choice}"]')).to_be_checked()
    require(assessment_snapshot(page)['participant']['stages']['pre']['startedAt'] == started_at,
            'Reload reset the original assessment start time')
    fill_assessment(page, bank, start=1)
    page.locator('#assessmentSubmitBtn').click()
    expect(page.locator('#assessmentGame')).to_be_hidden()
    expect(page.locator('#assessmentStartPre')).to_have_count(0)
    expect(page.locator('#assessmentStartPost')).to_be_visible()
    require(page.locator('#assessmentIndividualResult').inner_text().strip() == '', 'Pre score leaked before post was submitted')
    unpaired_csv = download_csv(page)
    require(len([row for row in unpaired_csv if row['question_id']]) == 12
            and len([row for row in unpaired_csv if row['stage_status'] == 'not_started']) == 1
            and all(row['correct_if_pair_complete'] == '' for row in unpaired_csv),
            'CSV leaked pre correctness before the pair was complete')
    before_post = assessment_snapshot(page)
    require(before_post['result'] is None and before_post['report']['paired'] == 0,
            'Unpaired pre stage was counted as a complete result')
    page.reload(wait_until='domcontentloaded')
    page.locator('#assessmentStartPost').click()
    fill_assessment(page, bank)
    page.locator('#assessmentSubmitBtn').click()
    expect(page.locator('#assessmentIndividualResult')).to_contain_text('11/12')
    expect(page.locator('#assessmentIndividualResult')).to_contain_text('12/12')
    snapshot = assessment_snapshot(page)
    participant, result, report = snapshot['participant'], snapshot['result'], snapshot['report']
    require(participant['group'] == initial['group'] and participant['order'] == initial['order'],
            'Participant assignment changed across reload or stages')
    require(participant['stages']['pre']['form'] == 'A' and participant['stages']['post']['form'] == 'B',
            'Post reused the pre form instead of the assigned other form')
    require(result['pre']['correct'] == 11 and result['post']['correct'] == 12, 'Paired score does not match actual selections')
    require(abs(result['gain'] - 100 / 12) < 1e-9, 'Gain is not a difference in percentage points')
    require(report['paired'] == 1 and report['unpaired'] == 0, 'Teacher report miscounted paired participants')
    fixed = next(group for group in report['groups'] if group['group'] == 'fixed')
    require(fixed['n'] == 1 and abs(fixed['gainMean'] - result['gain']) < 1e-9, 'Group report disagrees with the individual pair')
    rows = download_csv(page)
    require(len(rows) == 24, 'CSV does not contain both actual 12-question stages')
    require(sum(int(row['correct_if_pair_complete']) for row in rows) == 23, 'CSV correctness disagrees with actual selected choices')
    require({row['participant_code'] for row in rows} == {'HS001'}, 'CSV changed the anonymous participant code')
    require({row['form'] for row in rows} == {'A', 'B'}, 'CSV omitted form provenance')
    with page.expect_download() as backup_info:
        page.locator('#assessmentExportJson').click()
    backup = json.loads(Path(backup_info.value.path()).read_text(encoding='utf-8-sig'))
    require(len(backup['participants']) == 1 and backup['participants'][0]['stages']['post']['completedAt'],
            'Assessment backup omitted the completed pair')
    require(page.evaluate('(key) => localStorage.getItem(key)', REVIEW_KEY) is None,
            'Held-out assessment polluted adaptive practice evidence')

    # A shared school computer needs a real entry point for the next learner.
    # Switching must retain both a completed pair and a different unfinished test.
    page.locator('#assessmentNewParticipant').click()
    expect(page.locator('#assessmentSetup')).to_be_visible()
    expect(page.locator('#assessmentCode')).to_have_value('')
    expect(page.locator('#assessmentGroup')).to_have_value('')
    expect(page.locator('#assessmentOrder')).to_have_value('')
    require(assessment_snapshot(page)['participant'] == participant,
            'Opening next participant setup changed the existing completed pair')
    create_participant(page, 'HS002', 'adaptive', 'BA')
    page.locator('#assessmentStartPre').click()
    expect(page.locator('#assessmentQuestions input:checked')).to_have_count(0)
    fill_assessment(page, bank, stop=1)
    second = assessment_snapshot(page, 'HS002')['participant']
    require(second['stages']['pre']['form'] == 'B', 'Second participant did not receive assigned BA order')
    page.locator('#assessmentNewParticipant').click()
    create_participant(page, 'HS003', 'fixed', 'AB')
    require(assessment_snapshot(page, 'HS002')['participant'] == second,
            'Creating the next code erased an unfinished participant test')
    page.locator('#assessmentSavedCode').select_option('HS002')
    page.locator('#assessmentOpenBtn').click()
    expect(page.locator('#assessmentGame')).to_be_visible()
    expect(page.locator('#assessmentProgress')).to_contain_text('1/12')
    expect(page.locator('#assessmentQuestions input:checked')).to_have_count(1)
    page.locator('#assessmentSavedCode').select_option('HS001')
    page.locator('#assessmentOpenBtn').click()
    expect(page.locator('#assessmentGame')).to_be_hidden()
    expect(page.locator('#assessmentIndividualResult')).to_contain_text('11/12')
    require(assessment_snapshot(page)['report']['paired'] == 1
            and assessment_snapshot(page)['report']['unpaired'] == 2,
            'Switching participants changed paired or incomplete counts')
    page.goto(BASE + '/assessment.html?participant=HS001#kept-anchor', wait_until='domcontentloaded')
    parsed = urlparse(page.url)
    require(parsed.path == '/frontend/public/assessment.html'
            and parse_qs(parsed.query).get('participant') == ['HS001']
            and parsed.fragment == 'kept-anchor',
            'Root assessment redirect lost its participant, fragment or canonical path')
    expect(page.locator('#assessmentIndividualResult')).to_contain_text('12/12')
    expect(page.locator('#chatbox-container, #chatTriggerBtn, #supportChatWindow')).to_have_count(0)
    page.locator('#assessmentDeleteParticipant').click()
    page.locator('#assessmentCancelDelete').click()
    require(assessment_snapshot(page)['report']['paired'] == 1, 'Canceling assessment deletion erased the pair')
    page.locator('#assessmentDeleteParticipant').click()
    page.locator('#assessmentConfirmDelete').click()
    require(assessment_snapshot(page)['participant'] is None, 'Confirmed participant deletion left its data')
    require(assessment_snapshot(page, 'HS002')['participant'] == second,
            'Deleting one completed participant erased another unfinished test')
    require(page.evaluate('localStorage.getItem("unrelated-browser-data")') == 'keep-me', 'Assessment deletion erased unrelated data')
    return {'held_out_questions': len(bank), 'pre_correct': 11, 'post_correct': 12,
            'gain_percentage_points': result['gain'], 'csv_rows': len(rows), 'reload_resumes': True,
            'no_pre_feedback': True, 'separate_from_practice': True, 'confirmed_delete': True,
            'shared_device_next_participant': True, 'unfinished_test_preserved': True,
            'root_redirect_keeps_participant_and_fragment': True, 'assessment_has_no_ai_widget': True}


def assessment_validation_and_storage(page):
    goto(page, 'assessment.html')
    page.locator('#assessmentCode').fill('student@example.com')
    page.locator('#assessmentGroup').select_option('adaptive')
    page.locator('#assessmentOrder').select_option('BA')
    page.locator('#assessmentCreateForm button[type="submit"]').click()
    require(assessment_snapshot(page)['report']['participants'] == 0, 'Contact-shaped input created a participant')
    page.locator('#assessmentCode').fill('HS002')
    page.evaluate('''() => {
        window.__originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function() { throw new DOMException('Full for test', 'QuotaExceededError'); };
    }''')
    page.locator('#assessmentCreateForm button[type="submit"]').click()
    expect(page.locator('#assessmentNotice')).to_contain_text('Không lưu được')
    require(assessment_snapshot(page)['report']['participants'] == 0, 'Failed save created a false durable participant')
    page.evaluate('Storage.prototype.setItem = window.__originalSetItem; delete window.__originalSetItem')
    create_participant(page, 'HS002', 'adaptive', 'BA')
    report = assessment_snapshot(page, 'HS002')['report']
    require(report['participants'] == 1 and report['paired'] == 0 and report['unpaired'] == 1,
            'Unstarted participant was counted as a completed pair')
    require(all(group['n'] == 0 and group['gainMean'] is None for group in report['groups']),
            'Empty groups show fabricated average gains')
    page.locator('#assessmentDeleteAll').click()
    expect(page.locator('#assessmentDeleteDialog')).to_be_visible()
    page.locator('#assessmentConfirmDelete').click()
    require(assessment_snapshot(page)['report']['participants'] == 0, 'Confirmed study clear did not remove its participants')
    return {'contact_input_rejected': True, 'quota_failure_reported': True, 'no_false_saved_participant': True,
            'empty_group_means_absent': True, 'unpaired_excluded': True}


def mobile_features(page):
    page.set_viewport_size({'width': 375, 'height': 812})
    goto(page, 'quiz.html')
    page.locator('#quizCourseSelect').select_option('arduino')
    layouts = {'review': no_overflow(page)}
    expect(page.locator('#btnAdaptiveReview')).to_have_accessible_name('Ôn theo kết quả')
    goto(page, 'assessment.html')
    layouts['assessment_setup'] = no_overflow(page)
    create_participant(page, 'MOB001', 'adaptive', 'BA')
    page.locator('#assessmentStartPre').click()
    layouts['assessment_questions'] = no_overflow(page)
    expect(page.locator('#assessmentQuestions fieldset')).to_have_count(12)
    require(page.locator('#assessmentQuestions fieldset legend').count() == 12, 'Assessment questions lack fieldset legends')
    require(page.locator('#assessmentQuestions label input').count() == 48, 'Assessment options lack clickable labels')
    return {'width': 375, 'layouts': layouts, 'fieldset_legends': 12, 'labeled_options': 48}


def main():
    with sync_playwright() as runtime:
        browser = runtime.chromium.launch(executable_path=args.chromium, headless=True,
                                          args=['--no-sandbox', '--disable-dev-shm-usage'])

        def checked(name, check, setup=None):
            context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
            errors = []
            blocked = set()

            def route_request(route):
                parsed = urlparse(route.request.url)
                if parsed.netloc == urlparse(BASE).netloc or parsed.scheme in ('data', 'blob'):
                    route.continue_()
                else:
                    blocked.add(parsed.netloc)
                    route.abort()

            context.route('**/*', route_request)
            if setup:
                setup(context)
            page = context.new_page()
            page.set_default_timeout(6000)
            page.on('pageerror', lambda error: errors.append(str(error)))
            try:
                details = check(page)
                require(not errors, 'Uncaught browser errors: ' + repr(errors))
                results.append({'name': name, 'status': 'passed', 'details': details,
                                'blocked_external_hosts': sorted(blocked)})
                print('PASS', name, flush=True)
            except Exception as error:
                details = ''.join(traceback.format_exception_only(type(error), error)).strip()
                results.append({'name': name, 'status': 'failed', 'details': details, 'page_errors': errors})
                print('FAIL', name, details, flush=True)
                try:
                    page.screenshot(path=f'/tmp/strobot-evidence-failure-{len(results)}.png', full_page=True)
                except Exception:
                    pass
            finally:
                context.close()

        checked('completed practice drives a course-specific review; aborted work is ignored', adaptive_completed_and_aborted)
        checked('practice JSON export and confirmed course-only deletion preserve other data', review_export_and_targeted_delete)
        checked('corrupt review data is reported and a real completed attempt can recover', corrupt_review_storage)
        checked('blocked storage leaves ordinary practice usable without claiming a save', blocked_review_storage,
                lambda context: context.add_init_script('''
                    Storage.prototype.getItem = function() { throw new DOMException('Blocked for test', 'SecurityError'); };
                    Storage.prototype.setItem = function() { throw new DOMException('Blocked for test', 'SecurityError'); };
                '''))
        checked('held-out pre/post assessment resumes, withholds feedback, pairs scores and exports actual choices', assessment_pair_resume_export)
        checked('assessment validates anonymous input, reports quota failure and excludes unpaired records', assessment_validation_and_storage)
        checked('review and assessment controls fit a 375px viewport with labeled questions', mobile_features)
        browser.close()
    output = {'passed': sum(item['status'] == 'passed' for item in results),
              'failed': sum(item['status'] == 'failed' for item in results), 'results': results}
    Path(args.output).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({key: output[key] for key in ('passed', 'failed')}), flush=True)
    return 1 if output['failed'] else 0


if __name__ == '__main__':
    sys.exit(main())
