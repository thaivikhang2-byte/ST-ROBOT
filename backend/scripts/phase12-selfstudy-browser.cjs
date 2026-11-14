// Additional browser assertions for the existing real nginx/Nest disposable harness.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
exports.prepare = async (db, fixture) => {
  const { authoredId } = require('../src/modules/progress/authored-id');
  const authoredCourseId = authoredId('course:arduino');
  if (!(await db.course.findUnique({ where: { id: authoredCourseId } }))) await require('../prisma/import-learning').importLearning(db, fixture.teacher.id);
  const correct = randomUUID(), wrong = randomUUID();
  const quiz = await db.quiz.create({ data: { lesson_id: fixture.lessonId, title: 'QA Phase12 sensor', status: 'published', requires_pass: true, pass_score: 70, questions: { create: [{ question_text: 'QA: which measurement?', question_type: 'single_choice', options: [{ id: correct, text: 'Distance', isCorrect: true }, { id: wrong, text: 'Color', isCorrect: false }] }] } } });
  const lab = await db.labResource.create({ data: { lesson_id: fixture.lessonId, title: 'VEX VR · QA fallback', platform: 'vex-vr', url: 'https://vr.vex.com/', embed_policy: 'external' } });
  const lesson = await db.lesson.create({ data: { course_id: fixture.courseId, title: 'QA Phase12 next lesson', content: '<p>Read the next sensor example.</p>', status: 'published', sort_order: 999, is_required: false } });
  return { quizId: quiz.id, labId: lab.id, nextId: lesson.id, correct, authoredCourseId };
};
exports.retire = async (db, fixture) => {
  // Preserve actual test attempts/progress; retire only this run's authored fixtures.
  await db.quiz.update({ where: { id: fixture.quizId }, data: { deleted_at: new Date(), status: 'archived' } });
  await db.labResource.update({ where: { id: fixture.labId }, data: { deleted_at: new Date() } });
  await db.lesson.update({ where: { id: fixture.nextId }, data: { deleted_at: new Date() } });
};
exports.verify = async (page, db, actor, fixture, setMode, root) => {
  const out = path.join(root, 'docs/phase12-evidence');
  const send = async text => { await page.locator('#chatInput').fill(text); await page.locator('#learningChatForm button[type=submit]').click(); };
  await send('Explain this sensor');
  await page.waitForFunction(() => document.querySelector('#aiStatus').textContent.includes('Đã nhận xong'));
  assert.match(await page.locator('#chatMessages .chat-message').last().innerText(), /AI · first second/);
  setMode('error'); await send('QA provider failure');
  await page.waitForFunction(() => document.querySelector('#aiStatus').textContent.includes('chưa hoàn tất'));
  assert.doesNotMatch(await page.locator('#chatMessages').innerText(), /synthetic-provider-secret|qa-not-a-real-key/); setMode('normal');
  await page.locator('#quizForm select').selectOption(fixture.quizId);
  await page.getByRole('button', { name: 'Bắt đầu / tiếp tục quiz', exact: true }).click();
  await page.locator('#quizForm input[type=radio]').first().waitFor();
  const blocked = page.waitForResponse(r => r.url().endsWith('/learning/ai/stream'));
  await send('Blocked while assessing'); assert.equal((await blocked).status(), 409);
  await page.locator(`#quizForm input[value="${fixture.correct}"]`).check();
  await page.getByRole('button', { name: 'Nộp bài để máy chủ chấm', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#quizForm').textContent.includes('100%'));
  await page.locator('[data-action=complete]').first().click();
  await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('Đã lưu hoàn thành'));
  const progress = await db.progress.findFirstOrThrow({ where: { user_id: actor.student.id, lesson_id: actor.lessonId } }); assert.equal(progress.status, 'completed');
  await page.locator('#tabBtnLab').click();
  await page.getByRole('button', { name: 'VEX VR · QA fallback', exact: true }).click();
  assert.equal(await page.locator('#labExternalBtn').getAttribute('href'), 'https://vr.vex.com/'); assert.equal(await page.locator('#frameHost iframe').count(), 0);
  await page.locator('#tabBtnTheory').click();
  await page.locator('#journal').fill('QA Phase12: input was a known sensor distance; predicted a distance reading; recorded the observation and explanation without claiming external simulator success.');
  await page.locator('#practicalProjectUrl').fill('https://vr.vex.com/?project=phase12-qa');
  await page.locator('#submitPractical').click();
  await page.waitForFunction(() => document.querySelector('#practicalStatus').textContent.includes('Đã nộp'));
  const submission = await db.practicalSubmission.findFirstOrThrow({ where: { user_id: actor.student.id, lab_id: fixture.labId } }); assert.equal(submission.status, 'submitted');
  await page.locator('#nextLesson').click(); await page.waitForFunction(() => document.querySelector('#lessonTitle').textContent === 'QA Phase12 next lesson');
  await page.locator('#previousLesson').click(); await page.waitForFunction(() => document.querySelector('#lessonVideos video'));
  const pdf = page.waitForResponse(r => r.url().endsWith('/reference'));
  await page.locator('[data-action=reference]').first().click();
  assert.equal((await pdf).status(), 404, 'Unpublished reference is not fabricated for a generic QA course');
  const authored = await db.lesson.findMany({ where: { course_id: fixture.authoredCourseId, deleted_at: null }, include: { quizzes: { where: { requires_pass: true, deleted_at: null }, include: { questions: true } } }, orderBy: { sort_order: 'asc' } });
  assert.equal(authored.length, 6);
  const assessment = authored.map(lesson => ({ lessonId: lesson.id, quizId: lesson.quizzes[0].id, answers: lesson.quizzes[0].questions.map(q => ({ questionId: q.id, optionIds: q.options.filter(o => o.isCorrect).map(o => o.id) })) }));
  await page.evaluate(async ({ courseId, assessment }) => {
    const { api } = await import('/src/api/client.js');
    await api.post('/enrollments/' + courseId, {});
    for (const step of assessment) {
      const attempt = (await api.post('/quizzes/' + step.quizId + '/attempts', {})).data;
      await api.post('/quiz-attempts/' + attempt.id + '/submit', { answers: step.answers });
      await api.post('/learning/lessons/' + step.lessonId + '/complete', {});
    }
  }, { courseId: fixture.authoredCourseId, assessment });
  await page.locator('#courseSelect').selectOption(fixture.authoredCourseId);
  await page.waitForFunction(() => document.querySelector('#courseName').textContent.includes('Arduino'));
  await page.locator('#lessonList button').first().click();
  const actualPdf = page.waitForResponse(r => r.url().endsWith('/reference'));
  await page.locator('[data-action=reference]').first().click();
  assert.equal((await actualPdf).status(), 200); await page.locator('#pdfModal').waitFor(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#pdfModal').getAttribute('aria-hidden'), 'true');
  await page.evaluate(() => { document.querySelector('#theoryView').scrollTop = 0; document.querySelector('.ws-side-scroll').scrollTop = 0; window.scrollTo(0,0); });
  if (await page.locator('body').evaluate(e => e.classList.contains('dark-mode'))) await page.locator('#themeToggleBtn').click();
  await page.screenshot({ path: path.join(out, 'selfstudy-light.png'), animations: 'disabled' });
  await page.locator('#themeToggleBtn').click(); await page.screenshot({ path: path.join(out, 'selfstudy-dark.png'), animations: 'disabled' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(out, 'selfstudy-mobile.png'), animations: 'disabled' });
  return { aiSse: 'PASS simulated SDK upstream, real authorized lesson context', providerError: 'PASS redacted', activeAssessmentBlocksAi: 'PASS HTTP409', quizGrade: 'PASS server100%', progress: 'PASS persisted', labFallback: 'PASS external link; not external simulation grading', practical: 'PASS submitted, not auto-graded', nextPrevious: 'PASS', pdf: 'PASS authorized real PDF', responsive: 'PASS', theme: 'PASS' };
};
