import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { preparePracticePlan, parsePracticePlan, PracticePlanError } from '../ai-server/practice-plan.mjs';
import { listTemplates } from '../frontend/src/modules/quiz/generation/QuestionEngine.js';
import { listAutomaticTemplates } from '../frontend/src/modules/quiz/generation/DifficultyPolicy.js';

const curriculum = JSON.parse(await readFile(new URL('../ai-server/curriculum.json', import.meta.url), 'utf8'));
const requestBody = { courseId: 'arduino', lessonId: 'led', count: 3, level: 'all', weakLessonIds: ['led'] };
const templates = listTemplates({ courseId: 'arduino', lessonId: 'led', level: 'all' });
assert.ok(templates.length > 0, 'The tested scope must have real factory templates');
const templateId = templates[0].id;
const wrongScopeId = listTemplates({ courseId: 'microbit', lessonId: 'all', level: 'all' })[0]?.id || 'not-an-allowed-template';
const jsonPlan = JSON.stringify({ templateIds: [templateId] });
const response = content => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) });
const prior = Object.fromEntries(['NODE_ENV', 'ALLOWED_ORIGIN', 'AI_MODEL', 'DAILY_REQUEST_LIMIT', 'WOKU_API_KEY', 'AI_PROVIDER'].map(name => [name, process.env[name]]));
const actualNow = Date.now;
let serverIndex = 0;
let assertions = 0;

async function within(promise, label, milliseconds = 2000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

function request(server, { method = 'POST', path = '/api/practice-plan', origin = 'https://practice.test', body = requestBody, type = 'application/json' } = {}) {
  const encoded = typeof body === 'string' ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, method, path, headers: { ...(origin === null ? {} : { Origin: origin }), ...(type === null ? {} : { 'Content-Type': type }), ...(encoded === undefined ? {} : { 'Content-Length': Buffer.byteLength(encoded) }) } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data;
        try { data = text ? JSON.parse(text) : null; } catch (error) { reject(error); return; }
        resolve({ status: res.statusCode, headers: res.headers, data, text });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (encoded !== undefined) req.write(encoded);
    req.end();
  });
}

async function withServer(upstream, test, { limit = 50 } = {}) {
  process.env.NODE_ENV = 'test';
  process.env.AI_PROVIDER = 'woku';
  process.env.ALLOWED_ORIGIN = 'https://practice.test';
  process.env.AI_MODEL = 'test-planner-model';
  process.env.DAILY_REQUEST_LIMIT = String(limit);
  process.env.WOKU_API_KEY = 'local-stub-only';
  const { createServer } = await import(`../ai-server/server.mjs?practice-test=${++serverIndex}`);
  const server = createServer(upstream);
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    await test(server);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}

try {
  const prepared = preparePracticePlan(requestBody, curriculum);
  assert.equal(prepared.count, 3);
  assert.ok(prepared.allowedIds.has(templateId));
  assert.equal(prepared.messages.length, 2);
  const prompt = JSON.parse(prepared.messages[1].content);
  assert.ok(!Object.hasOwn(prompt, 'difficulty'), 'Legacy requests must keep their original policy');
  assert.deepEqual(prompt.weakLessonIds, ['led']);
  assert.deepEqual(prompt.lessons.map(lesson => lesson.id), ['led']);
  assert.ok(prompt.lessons.every(lesson => lesson.objectives.length > 0));
  assert.ok(prompt.templates.every(template => template.courseId === 'arduino' && template.lessonId === 'led'));
  assert.ok(prompt.templates.every(template => !('ans' in template) && !('q' in template) && !('opts' in template)));
  assert.ok(!prepared.messages.some(message => /ASSESSMENT|study:A:|study:B:/.test(message.content)), 'Held-out assessment content must not be included');
  for (const patch of [
    { courseId: 'missing' }, { lessonId: 'matrix' }, { count: 0 }, { count: 19 }, { count: 1.5 }, { count: '3' }, { level: 'expert' },
    { weakLessonIds: ['matrix'] }, { weakLessonIds: ['led', 'led'] }, { weakLessonIds: 'led' }, { weakLessonIds: Array(7).fill('led') },
    { question: 'Please invent questions and answers' }, { history: [] }, { email: 'not-forwarded@example.test' }, { templateIds: [templateId] }
  ]) assert.throws(() => preparePracticePlan({ ...requestBody, ...patch }, curriculum), error => error instanceof PracticePlanError && error.status === 400);
  for (const difficulty of ['expert', 'EASY', null, 1, [], {}, undefined]) assert.throws(() => preparePracticePlan({ ...requestBody, difficulty }, curriculum), error => error.status === 400);
  for (const invalid of [null, [], 'text', 12]) assert.throws(() => preparePracticePlan(invalid, curriculum), /Chọn khóa/);
  const allCourse = preparePracticePlan({ ...requestBody, lessonId: 'all', count: 18, weakLessonIds: [] }, curriculum);
  assert.equal(JSON.parse(allCourse.messages[1].content).lessons.length, 6);
  assert.ok(JSON.parse(allCourse.messages[1].content).templates.every(template => template.courseId === 'arduino'));
  const focused = preparePracticePlan({ ...requestBody, lessonId: 'all', weakLessonIds: ['timing', 'led'] }, curriculum);
  const focusedPrompt = JSON.parse(focused.messages[1].content);
  assert.deepEqual(focusedPrompt.lessons.map(lesson => lesson.id), ['led', 'timing']);
  assert.ok(focusedPrompt.templates.every(template => ['led', 'timing'].includes(template.lessonId)));
  assert.deepEqual([...focused.allowedIds].sort(), listTemplates({ courseId: 'arduino', lessonId: 'all', level: 'all' }).filter(template => ['led', 'timing'].includes(template.lessonId)).map(template => template.id).sort());
  const nonFocusedId = listTemplates({ courseId: 'arduino', lessonId: 'distance', level: 'all' })[0].id;
  assert.throws(() => parsePracticePlan(JSON.stringify({ templateIds: [nonFocusedId] }), focused.allowedIds, 3), error => error.status === 502, 'Personalized plans cannot include another lesson');
  const basic = preparePracticePlan({ ...requestBody, level: 'basic' }, curriculum);
  assert.ok(JSON.parse(basic.messages[1].content).templates.every(template => template.level === 'basic'));
  for (const difficulty of ['easy', 'medium', 'hard']) {
    for (const course of curriculum) {
      const selection = preparePracticePlan({ courseId: course.id, lessonId: 'all', count: 12, level: 'all', weakLessonIds: [], difficulty }, curriculum);
      const eligible = listAutomaticTemplates({ courseId: course.id, lessonId: 'all', difficulty });
      assert.deepEqual([...selection.allowedIds].sort(), eligible.map(template => template.id).sort(), 'Server eligibility must match the browser policy in every course');
      assert.equal(JSON.parse(selection.messages[1].content).difficulty, difficulty);
    }
  }
  assert.throws(() => preparePracticePlan({ ...requestBody, level: 'basic', difficulty: 'hard' }, curriculum), error => error.status === 400, 'Traditional level filters must intersect the difficulty policy');
  const focusedEasy = preparePracticePlan({ ...requestBody, lessonId: 'all', weakLessonIds: ['led', 'timing'], difficulty: 'easy' }, curriculum);
  assert.ok(JSON.parse(focusedEasy.messages[1].content).templates.every(template => ['led', 'timing'].includes(template.lessonId) && template.level === 'basic'));
  assert.deepEqual(parsePracticePlan(jsonPlan, prepared.allowedIds, 3), [templateId]);
  assert.deepEqual(parsePracticePlan(`\n\`\`\`json\n${jsonPlan}\n\`\`\`\n`, prepared.allowedIds, 3), [templateId]);
  const twoIds = [...allCourse.allowedIds].slice(0, 2);
  assert.equal(twoIds.length, 2);
  assert.throws(() => parsePracticePlan(JSON.stringify({ templateIds: twoIds }), allCourse.allowedIds, 1), error => error.status === 502, 'The model cannot exceed the requested count');
  for (const bad of [
    '', 'Not JSON', `A plan: ${jsonPlan}`, `${jsonPlan}\n${jsonPlan}`, `\`\`\`json\n${jsonPlan}\n\`\`\` extra`,
    '{"templateIds":[]}', JSON.stringify({ templateIds: [wrongScopeId] }), JSON.stringify({ templateIds: [templateId, templateId] }),
    JSON.stringify({ templateIds: [templateId], explanation: 'extra' }), JSON.stringify({ templateIds: [42] }),
    JSON.stringify({ templateIds: templateId }), '["id"]', 'null', 'x'.repeat(16001)
  ]) assert.throws(() => parsePracticePlan(bad, prepared.allowedIds, 3), error => error instanceof PracticePlanError && error.status === 502);
  assertions++;

  let calls = 0;
  const captured = [];
  await withServer(async (url, options) => {
    calls++; captured.push({ url, options, abortedAtStart: options.signal.aborted });
    const body = JSON.parse(options.body);
    return response(body.max_tokens === 600 ? jsonPlan : 'Phản hồi kiểm thử trợ lý.');
  }, async server => {
    let result = await request(server, { method: 'GET', path: '/health', origin: null, body: undefined });
    assert.equal(result.status, 200); assert.equal(result.data.ok, true);
    assert.deepEqual(result.data.ai, { provider:'woku',keyConfigured: true, modelConfigured: true, allowedOrigin: 'https://practice.test' });
    assert.ok(result.data.revision === null || /^[a-f0-9]{40}$/i.test(result.data.revision));
    assert.equal((await request(server, { path: '/not-an-api' })).status, 404);
    assert.equal((await request(server, { origin: 'https://other.test' })).status, 403);
    result = await request(server, { method: 'OPTIONS', body: undefined });
    assert.equal(result.status, 204);
    assert.equal(result.headers['access-control-allow-origin'], 'https://practice.test');
    assert.equal(result.headers['access-control-allow-methods'], 'POST, OPTIONS');
    assert.equal((await request(server, { method: 'OPTIONS', origin: 'https://other.test', body: undefined })).status, 403);
    assert.equal((await request(server, { method: 'GET', body: undefined })).status, 405);
    delete process.env.WOKU_API_KEY;
    assert.equal((await request(server)).status, 503);
    process.env.WOKU_API_KEY = 'local-stub-only';
    assert.equal((await request(server, { type: 'text/plain' })).status, 415);
    assert.equal((await request(server, { type: 'application/json-unsupported' })).status, 415);
    assert.equal((await request(server, { body: '{broken' })).status, 400);
    assert.equal((await request(server, { body: [] })).status, 400);
    assert.equal((await request(server, { body: { ...requestBody, history: [{ role: 'user', content: 'Not allowed' }] } })).status, 400);
    assert.equal((await request(server, { body: 'x'.repeat(24001) })).status, 413);
    assert.equal(calls, 0, 'Rejected/preflight requests must not call a paid upstream');
    result = await request(server, { type: 'Application/JSON; charset=utf-8' });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { source: 'ai-plan', templateIds: [templateId], model: 'test-planner-model' });
    assert.equal(result.headers['access-control-allow-origin'], 'https://practice.test');
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(captured[0].url, 'https://llm.wokushop.com/v1/chat/completions');
    const upstreamBody = JSON.parse(captured[0].options.body);
    assert.equal(upstreamBody.max_tokens, 600);
    assert.ok(captured[0].options.signal instanceof AbortSignal);
    assert.equal(captured[0].abortedAtStart, false, 'The provider must receive a live signal; completed operations may be aborted for cleanup');
    assert.equal(JSON.parse(upstreamBody.messages[1].content).courseId, 'arduino');
    assert.equal((await request(server, { path: '/api/home-chat', body: { question: 'STEM là gì?' } })).status, 200);
    const tutor = await request(server, { path: '/api/tutor', body: { course: 'arduino', lesson: 'led', question: 'Điện trở dùng làm gì?', history: [] } });
    assert.equal(tutor.status, 200); assert.deepEqual(tutor.data, { reply: 'Phản hồi kiểm thử trợ lý.' });
    assert.equal((await request(server, { path: '/api/tutor', body: { course: 'arduino', lesson: 'missing', question: 'test' } })).status, 400);
    assert.equal(calls, 3);
  });
  assertions++;

  const malformedResults = [
    '{"templateIds":[]}', JSON.stringify({ templateIds: [wrongScopeId] }), JSON.stringify({ templateIds: [templateId, templateId] }),
    `Here is your plan: ${jsonPlan}`, JSON.stringify({ templateIds: [templateId], answer: 'invented' }),
    'not JSON', `\`\`\`json\n${jsonPlan}\n\`\`\``
  ];
  for (let index = 0; index < malformedResults.length; index++) {
    await withServer(async () => response(malformedResults[index]), async server => {
      const result = await request(server);
      assert.equal(result.status, index + 1 === malformedResults.length ? 200 : 502);
      if (result.status === 502) assert.ok(!('templateIds' in result.data), 'Unverified model output must not reach the client');
    });
  }
  assertions++;

  let focusCalls = 0;
  await withServer(async (_url, options) => {
    focusCalls++;
    const body = JSON.parse(options.body), prompt = JSON.parse(body.messages[1].content);
    assert.deepEqual(prompt.lessons.map(lesson => lesson.id), ['timing']);
    assert.ok(prompt.templates.every(template => template.lessonId === 'timing'));
    return response(JSON.stringify({ templateIds: [focusCalls === 1 ? templateId : prompt.templates[0].id] }));
  }, async server => {
    const body = { ...requestBody, lessonId: 'all', weakLessonIds: ['timing'] };
    assert.equal((await request(server, { body })).status, 502, 'A model-selected ID outside weak lessons must be rejected server-side');
    const result = await request(server, { body });
    assert.equal(result.status, 200);
    const allowed = new Set(listTemplates({ courseId: 'arduino', lessonId: 'timing', level: 'all' }).map(template => template.id));
    assert.ok(result.data.templateIds.every(id => allowed.has(id)));
  });
  assertions++;

  const lowerId = templates.find(template => template.level === 'basic').id;
  const higherId = templates.find(template => template.level === 'apply').id;
  for (const difficulty of ['easy', 'hard']) {
    let difficultyCalls = 0;
    let chooseWrong = true;
    await withServer(async (_url, options) => {
      difficultyCalls++;
      const planPrompt = JSON.parse(JSON.parse(options.body).messages[1].content);
      const expectedLevel = planPrompt.difficulty === 'hard' ? 'apply' : 'basic';
      assert.ok(planPrompt.templates.every(template => template.level === expectedLevel));
      const selected = chooseWrong ? (expectedLevel === 'basic' ? higherId : lowerId) : planPrompt.templates[0].id;
      return response(JSON.stringify({ templateIds: [selected] }));
    }, async server => {
      const body = { ...requestBody, difficulty };
      assert.equal((await request(server, { body })).status, 502, `${difficulty} plans reject a valid scoped ID at the wrong template level`);
      chooseWrong = false;
      const result = await request(server, { body });
      assert.equal(result.status, 200);
      assert.deepEqual(result.data.templateIds, [difficulty === 'easy' ? lowerId : higherId]);
      for (const invalid of ['invalid', null, 2]) assert.equal((await request(server, { body: { ...requestBody, difficulty: invalid } })).status, 400);
      assert.equal(difficultyCalls, 2, 'Invalid difficulty choices must not consume upstream calls');
    });
  }
  assertions++;

  calls = 0;
  await withServer(async () => { calls++; return response(jsonPlan); }, async server => {
    assert.equal((await request(server, { method: 'OPTIONS', body: undefined })).status, 204);
    assert.equal((await request(server, { body: { ...requestBody, count: 0 } })).status, 400);
    assert.equal((await request(server)).status, 200);
    assert.equal((await request(server)).status, 429, 'Automatic plans must leave a daily request for a learner question');
    assert.equal((await request(server, { path: '/api/home-chat', body: { question: 'Câu hỏi vẫn được trả lời.' } })).status, 200);
    assert.equal((await request(server, { path: '/api/home-chat', body: { question: 'Đã dùng hết tổng hạn mức.' } })).status, 429);
    assert.equal(calls, 2, 'Planner reservation preserves the original total daily cap and does not charge rejected requests');
  }, { limit: 2 });
  assertions++;

  calls = 0;
  await withServer(async () => { calls++; return response(jsonPlan); }, async server => {
    for (let index = 0; index < 10; index++) assert.equal((await request(server, { path: '/api/home-chat', body: { question: 'Kiểm tra hạn mức chung.' } })).status, 200);
    assert.equal((await request(server)).status, 429, 'The existing global 10-per-minute limit still includes plans');
    assert.equal(calls, 10);
  });
  assertions++;

  calls = 0;
  await withServer(async () => { calls++; return response(jsonPlan); }, async server => {
    assert.equal((await request(server)).status, 200);
    assert.equal((await request(server)).status, 200);
    assert.equal((await request(server)).status, 429, 'Automatic planning has its own two-per-minute ceiling');
    assert.equal((await request(server, { path: '/api/home-chat', body: { question: 'Câu hỏi có ưu tiên riêng.' } })).status, 200);
    assert.equal(calls, 3);
  });
  assertions++;

  let logicalNow = actualNow();
  try {
    Date.now = () => logicalNow;
    calls = 0;
    await withServer(async () => { calls++; return response(jsonPlan); }, async server => {
      for (let index = 0; index < 10; index++) {
        assert.equal((await request(server)).status, 200);
        logicalNow += 61000;
      }
      assert.equal((await request(server)).status, 429, 'Automatic plans cannot consume the whole default daily allowance');
      assert.equal((await request(server, { path: '/api/home-chat', body: { question: 'Câu hỏi sau mười lượt tạo đề.' } })).status, 200);
      assert.equal(calls, 11);
    });
  } finally { Date.now = actualNow; }
  assertions++;

  calls = 0;
  await withServer(async () => { calls++; return response(jsonPlan); }, async server => {
    assert.equal((await request(server)).status, 429, 'A one-call deployment reserves its only daily request for chat');
    assert.equal((await request(server, { path: '/api/home-chat', body: { question: 'Câu hỏi duy nhất trong ngày.' } })).status, 200);
    assert.equal((await request(server, { path: '/api/home-chat', body: { question: 'Câu hỏi vượt hạn mức.' } })).status, 429);
    assert.equal(calls, 1);
  }, { limit: 1 });
  assertions++;

  let releases = [];
  let ready;
  let planReady;
  let inflightCalls = 0;
  const bothStarted = new Promise(resolve => { ready = resolve; });
  const planStarted = new Promise(resolve => { planReady = resolve; });
  await withServer(async (_url, options) => {
    inflightCalls++;
    const isPlan = JSON.parse(options.body).max_tokens === 600;
    if (inflightCalls <= 2) {
      const pending = new Promise(resolve => releases.push(() => resolve(response(isPlan ? jsonPlan : 'Phản hồi đồng thời.'))));
      if (inflightCalls === 1) planReady();
      if (inflightCalls === 2) ready();
      return pending;
    }
    return response(jsonPlan);
  }, async server => {
    const first = request(server);
    await within(planStarted, 'The first planning request never reached the provider fixture');
    assert.equal((await request(server)).status, 429, 'Only one automatic plan may occupy a slot; preserve the second slot for chat');
    const second = request(server, { path: '/api/home-chat', body: { question: 'test' } });
    try {
      await within(bothStarted, 'A held planner prevented the chat request from reaching the provider');
      assert.equal((await request(server, { path: '/api/tutor', body: { course: 'arduino', lesson: 'led', question: 'test' } })).status, 429, 'Plans and chat share the existing concurrency limit');
    } finally { releases.forEach(release => release()); }
    const completed = await Promise.all([first, second]);
    assert.ok(completed.every(result => result.status === 200));
    assert.equal((await request(server)).status, 200, 'Completing plans must release concurrency slots');
  });
  assertions++;

  let started, aborted;
  const cancellationStarted = new Promise(resolve => { started = resolve; });
  const cancellationObserved = new Promise(resolve => { aborted = resolve; });
  let cancellationCalls = 0;
  let capturedSignal;
  await withServer(async (_url, options) => {
    cancellationCalls++;
    if (cancellationCalls === 1) {
      capturedSignal = options.signal;
      return new Promise(() => {
        // Deliberately ignore cancellation at transport level: the server must
        // still release its own slot instead of awaiting this stuck operation.
        options.signal.addEventListener('abort', aborted, { once: true });
        started();
      });
    }
    return response(jsonPlan);
  }, async server => {
    const encoded = JSON.stringify(requestBody);
    let client;
    const clientClosed = new Promise((resolve, reject) => {
      client = http.request({ hostname: '127.0.0.1', port: server.address().port, method: 'POST', path: '/api/practice-plan', headers: {
        Origin: 'https://practice.test', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded)
      } }, res => { res.resume(); res.once('end', () => reject(new Error('Canceled client unexpectedly received an HTTP response'))); });
      client.on('error', resolve);
      client.end(encoded);
    });
    await within(cancellationStarted, 'The cancellable plan never reached the provider');
    assert.ok(capturedSignal instanceof AbortSignal && !capturedSignal.aborted);
    client.destroy();
    await within(clientClosed, 'Canceled client socket did not close');
    await within(cancellationObserved, 'Client cancellation did not abort the provider request');
    assert.ok(capturedSignal.aborted);
    assert.equal((await request(server)).status, 200, 'A canceled plan must release its planner slot immediately');
    assert.equal((await request(server, { path: '/api/home-chat', body: { question: 'Chat vẫn hoạt động sau khi hủy tạo đề.' } })).status, 200);
    assert.equal(cancellationCalls, 3, 'Canceling a plan must not silently retry the paid provider');
  });
  assertions++;

  let deadlineCalls = 0;
  let deadlineSignal;
  await withServer(async (_url, options) => {
    deadlineCalls++;
    if (deadlineCalls === 1) {
      deadlineSignal = options.signal;
      return new Promise(() => {});
    }
    return response(jsonPlan);
  }, async server => {
    const began = performance.now();
    const timedOut = await within(request(server), 'The server did not end a stuck planner before the browser deadline', 4800);
    const elapsed = performance.now() - began;
    assert.equal(timedOut.status, 504);
    assert.ok(elapsed >= 3400 && elapsed < 4800, `Expected the real 3.5-second planning deadline, observed ${elapsed} ms`);
    assert.ok(deadlineSignal instanceof AbortSignal && deadlineSignal.aborted, 'Deadline must abort the provider signal even when its promise never settles');
    assert.equal((await request(server)).status, 200, 'An expired planner must release its slot while the client remains connected');
    assert.equal((await request(server, { path: '/api/home-chat', body: { question: 'Chat sau khi tạo đề quá thời gian.' } })).status, 200);
    assert.equal(deadlineCalls, 3, 'A timed-out planner is not retried or left occupying chat capacity');
  });
  assertions++;

  for (const [failure, status] of [
    [() => { throw new DOMException('Stub timeout', 'TimeoutError'); }, 504],
    [() => ({ ok: false, status: 503 }), 502],
    [() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Broken payload'); } }), 502]
  ]) {
    let failures = 0;
    await withServer(async () => ++failures === 1 ? failure() : response(jsonPlan), async server => {
      assert.equal((await request(server)).status, status);
      assert.equal((await request(server)).status, 200, 'Each failure path must release its planner slot');
    });
  }
  assertions++;
  console.log(`PASS ${assertions} practice-plan groups: strict scopes/payloads, bounded model JSON, real HTTP/CORS/key gates, reserved chat capacity, original total quotas, canceled-client cleanup and no paid requests`);
} finally {
  Date.now = actualNow;
  for (const [name, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
