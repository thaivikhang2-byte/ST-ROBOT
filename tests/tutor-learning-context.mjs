import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTutorLearningContext } from '../frontend/src/services/TutorLearningContext.js';
import { tutorContextPrompt, validateTutorLearningContext } from '../ai-server/tutor-context.mjs';
import { createAiClient, AI_SERVICE_ORIGIN } from '../frontend/src/services/AiService.js';

const courses = JSON.parse(readFileSync(new URL('../ai-server/curriculum.json', import.meta.url)));
const readKeys = [];
const forbidden = 'private-auth-value-never-send';
const records = {
  arduino: { led: { done: true, note: 'Bản đã lưu', password: forbidden }, timing: { done: false } },
  microbit: { matrix: { done: true }, notARealLesson: { done: true, note: forbidden } },
};
const storage = { getItem(key) {
  readKeys.push(key);
  if (key === 'strobot.original.course.v3') return JSON.stringify(records);
  if (key === 'strobot.quiz.history.v1') return JSON.stringify([{courseId: 'arduino', lessonId: 'led', correct: 2, total: 3, accessToken: forbidden}]);
  throw new Error('Forbidden private storage key');
}};
const report = buildTutorLearningContext({ courses, courseId: 'arduino', lessonId: 'led', storage,
  currentRecord: {done: true, note: 'Bản nháp tôi vừa sửa', observation: 'LED sáng', secret: forbidden} });
assert.deepEqual(readKeys, ['strobot.original.course.v3', 'strobot.quiz.history.v1']);
assert.equal(report.currentLesson.journal.note, 'Bản nháp tôi vừa sửa');
assert.deepEqual(report.courses.find(c => c.courseId === 'arduino').completedLessonIds, ['led']);
assert.deepEqual(report.courses.find(c => c.courseId === 'microbit').completedLessonIds, ['matrix']);
assert.equal(report.quizHistory[0].correct, 2);
assert.ok(!JSON.stringify(report).includes(forbidden));
assert.deepEqual(validateTutorLearningContext(report, 'arduino', 'led'), report);
assert.equal(buildTutorLearningContext({courses, courseId: 'other', lessonId: 'led'}), undefined);
assert.equal(buildTutorLearningContext({courses, courseId: 'arduino', lessonId: 'other'}), undefined);

const prompt = tutorContextPrompt({educationalContext: report, platformKey: 'avr'}, 'arduino', 'led');
for (const word of ['CircuitJS', 'AVR8js', 'Wokwi', 'PhET', 'Bàn thí nghiệm', 'Bản nháp tôi vừa sửa']) assert.ok(prompt.includes(word), word);
assert.match(prompt, /không cần nhìn bên trong iframe/);
assert.match(prompt, /không gọi nó là điểm chấm/);
assert.match(tutorContextPrompt({}, 'microbit'), /Python Editor/);
assert.match(tutorContextPrompt({}, 'microbit'), /TypeScript/);
for (const invalid of [
  {...report, accessToken: forbidden},
  {...report, source: 'postgresql-account'},
  {...report, currentLesson: {...report.currentLesson, courseId: 'microbit'}},
  {...report, currentLesson: {...report.currentLesson, journal: {note: 'x'.repeat(1601)}}},
  {...report, currentLesson: {...report.currentLesson, journal: {token: forbidden}}},
  {...report, courses: [...report.courses, report.courses[0]]},
  {...report, quizHistory: [{courseId: 'arduino', correct: 99, total: 2}]},
]) assert.throws(() => validateTutorLearningContext(invalid, 'arduino', 'led'));

const OWNER = '801c1c06-4236-4d99-9b02-234371f35755';
const CONVERSATION = '6ff63b39-e413-40fb-ab4e-f27fb722381d';
const payload = {course: 'arduino', lesson: 'led', question: 'Nên chọn nền tảng nào?',
  platformKey: 'avr', learningLevel: 'beginner', history: [], educationalContext: report};
const json = value => new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json'}});
const events = [], metadata = [];
const account = {
  configured: true, baseUrl: 'https://accounts.example/api', user: {id: OWNER},
  async ready() { return this.user; },
  async request(path, options) {
    events.push(['agent', path, options.body]);
    return {message: 'AVR8js cho thử LED; Wokwi phù hợp mạch có cảm biến.', conversationId: CONVERSATION,
      contextSources: {source: 'postgresql-account', savedLearning: true, hasSnapshot: true, snapshotRevision: 3}};
  },
};
const client = createAiClient({ account, fetchImpl: async () => { throw new Error('Must not call legacy'); } });
const beforeAccountRequest = async () => { events.push(['sync']); return {status: 'synced'}; };
assert.match(await client.requestReply('/api/tutor', payload, {beforeAccountRequest, onContext: data => metadata.push(data)}), /AVR8js/);
assert.equal(events[0][0], 'sync');
assert.deepEqual(events[1], ['agent', '/v1/ai/agent/chat', {mode: 'EDUCATIONAL', message: payload.question,
  courseSlug: 'arduino', lessonSlug: 'led', selectedPlatformKey: 'avr', learningLevel: 'beginner'}]);
assert.equal(metadata[0].source, 'postgresql-account');
assert.equal(metadata[0].snapshotRevision, 3);
assert.equal(metadata[0].pendingSync, false);
assert.ok(!JSON.stringify(events[1]).includes('Bản nháp'), 'Authenticated chat must load own records on the server');
await client.requestReply('/api/tutor', payload);
assert.equal(events.at(-1)[2].conversationId, CONVERSATION);
client.resetConversation();
await client.requestReply('/api/tutor', payload);
assert.ok(!Object.hasOwn(events.at(-1)[2], 'conversationId'));
await client.requestReply('/api/tutor', payload, {beforeAccountRequest: async () => ({status: 'conflict'}), onContext: data => metadata.push(data)});
assert.equal(metadata.at(-1).pendingSync, true);

// The ordinary site chat must use the same owner-aware agent after login; it
// has its own conversation and lets the server load all-course learning data.
await client.requestReply('/api/home-chat', {question: 'Tiến độ học của tôi thế nào?', history: [{role:'user',content:'Untrusted browser history'}]}, {beforeAccountRequest});
assert.deepEqual(events.at(-1), ['agent', '/v1/ai/agent/chat', {mode:'EDUCATIONAL',message:'Tiến độ học của tôi thế nào?'}]);
await client.requestReply('/api/home-chat', {question: 'Nên luyện tiếp ở Lab nào?'});
assert.equal(events.at(-1)[2].conversationId, CONVERSATION);
client.resetConversation('/api/home-chat');
await client.requestReply('/api/home-chat', {question: 'Bắt đầu trao đổi mới'});
assert.ok(!Object.hasOwn(events.at(-1)[2], 'conversationId'));

for (const status of [0, 401, 403, 429, 503]) {
  let legacyCalls = 0;
  const failing = createAiClient({ account: {...account, async request() { throw Object.assign(new Error('Fixture'), {status}); }},
    fetchImpl: async () => { legacyCalls++; return json({reply: 'Not permitted fallback'}); } });
  await assert.rejects(failing.requestReply('/api/tutor', payload), error => error.code.startsWith('AI_')
    && error.api === account.baseUrl + '/v1/ai/agent/chat');
  await assert.rejects(failing.requestReply('/api/home-chat', {question: 'Tiến độ của tôi?'}), error => error.code.startsWith('AI_')
    && error.api === account.baseUrl + '/v1/ai/agent/chat');
  assert.equal(legacyCalls, 0, 'An account failure must never silently fall back to guest chat');
}

const visionCalls = [], visionMetadata = [];
const vision = createAiClient({ account: {...account, async request() { throw new Error('Images must keep the vision route'); }},
  fetchImpl: async (url, options) => { visionCalls.push({url, options}); return url.endsWith('/health') ? json({ok: true}) : json({reply: 'Ảnh thấy LED.'}); } });
await vision.requestReply('/api/tutor', {...payload, images: [{dataUrl: 'fixture-image'}]}, {onContext: info => visionMetadata.push(info)});
assert.deepEqual(visionCalls.map(call => call.url), [AI_SERVICE_ORIGIN + '/health', AI_SERVICE_ORIGIN + '/api/tutor']);
assert.ok(!JSON.stringify(visionCalls).includes('Authorization'));
assert.equal(JSON.parse(visionCalls[1].options.body).educationalContext.currentLesson.journal.note, 'Bản nháp tôi vừa sửa');
assert.equal(visionMetadata[0].source, 'browser-self-report');
assert.equal(visionMetadata[0].vision, true);

let release;
const changing = {...account, request: () => new Promise(resolve => { release = resolve; })};
const race = createAiClient({account: changing, fetchImpl: async () => { throw new Error('No fallback'); }});
const request = race.requestReply('/api/tutor', payload);
while (!release) await new Promise(resolve => setTimeout(resolve, 0));
changing.user = {id: '31069412-7af9-491d-ad8b-96db148e15bd'};
release({message: 'Old owner reply', conversationId: CONVERSATION});
await assert.rejects(request, error => error.name === 'AbortError');

let capturedSignal;
const hanging = createAiClient({agentTimeoutMs: 20, account: {...account, request: (_path, options) => {
  capturedSignal = options.signal; return new Promise(() => {});
}}, fetchImpl: async () => { throw new Error('No fallback'); }});
await assert.rejects(hanging.requestReply('/api/tutor', payload), error => error.code === 'AI_REPLY_TIMEOUT');
assert.equal(capturedSignal.aborted, true);
console.log('PASS trusted lab catalogs, scoped browser reports, real account agent routing, saved-source markers, vision preservation, owner isolation and no silent fallback');
