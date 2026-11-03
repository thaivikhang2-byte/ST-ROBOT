import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AssessmentService, ASSESSMENT_STORAGE_KEY, ASSESSMENT_MAX_PARTICIPANTS } from '../frontend/src/modules/assessment/AssessmentService.js';
import { ASSESSMENT_FORMS, ASSESSMENT_LESSONS, ASSESSMENT_VERSION } from '../frontend/src/data/assessment.js';
import { quizQuestions } from '../frontend/src/data/quiz.js';

const curriculum = JSON.parse(await readFile(new URL('../ai-server/curriculum.json', import.meta.url)));
assert.deepEqual(ASSESSMENT_LESSONS.map(l => l.id), curriculum.find(c => c.id === 'arduino').lessons.map(l => l.id));
const practiceText = new Set(quizQuestions.map(q => q.q.trim()));
const allQuestions = Object.values(ASSESSMENT_FORMS).flat();
assert.equal(new Set(allQuestions.map(q => q.id)).size, 24);
assert.equal(new Set(allQuestions.map(q => q.q)).size, 24);
for (const [form, questions] of Object.entries(ASSESSMENT_FORMS)) {
    assert.equal(questions.length, 12);
    for (const lesson of ASSESSMENT_LESSONS) assert.equal(questions.filter(q => q.lessonId === lesson.id).length, 2);
    for (const question of questions) {
        assert.ok(question.id.startsWith(`study:${form}:`));
        assert.ok(!practiceText.has(question.q.trim()), 'Assessment text must be separate from practice items');
        assert.ok(!quizQuestions.some(q => q.id === question.id));
        assert.ok(question.q && question.exp && question.opts.length === 4);
        assert.equal(new Set(question.opts).size, question.opts.length);
        assert.ok(Number.isInteger(question.ans) && question.ans >= 0 && question.ans < question.opts.length);
    }
}
// Independent numerical/model checks for the held-out answer key.
const question = id => allQuestions.find(q => q.id === id);
assert.equal(question('study:A:led:1').opts[question('study:A:led:1').ans], `${(5 - 2) / 0.006} Ω`);
assert.equal(question('study:B:led:1').opts[question('study:B:led:1').ans], `${(5 - 2) / 200 * 1000} mA`);
assert.equal(question('study:A:distance:1').opts[question('study:A:distance:1').ans], `${Math.round(0.034 * 3000 / 2)} cm`);
assert.equal(question('study:A:distance:2').opts[question('study:A:distance:2').ans], '22,1 cm; 2 mẫu hợp lệ');
assert.equal(question('study:B:distance:1').opts[question('study:B:distance:1').ans], '2 500 µs');
assert.equal(question('study:A:timing:1').opts[question('study:A:timing:1').ans], '2,5 Hz và 30%');
assert.equal(question('study:B:timing:1').opts[question('study:B:timing:1').ans], '300 ms và 2 Hz');
let alarm = false;
const trace = [21, 19, 25, 26].map(d => { if (d < 20) alarm = true; else if (d > 25) alarm = false; return alarm ? 'ON' : 'OFF'; }).join(', ');
assert.equal(question('study:A:project:1').opts[question('study:A:project:1').ans], trace);

const values = new Map([['unrelated-key', 'keep me']]);
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
let now = Date.UTC(2026, 10, 3, 8);
let service = new AssessmentService({ storage, now: () => now });
assert.equal(service.report().paired, 0);
assert.equal(service.report().groups[0].preMean, null);
assert.equal(service.exportCsv().trim().split('\r\n').length, 1);
for (const code of ['A', 'Nguyễn Văn A', '=SUM(A1)', '+123', '-123', '@cell', 'A\nB', 'A'.repeat(25)]) assert.throws(() => service.createParticipant({ code, group: 'fixed', order: 'AB' }));
service.createParticipant({ code: ' hs001 ', group: 'adaptive', order: 'AB' });
assert.equal(service.exportCsv().trim().split('\r\n').length, 3, 'Export must retain enrollment even without started stages');
assert.equal(service.getParticipant('hs001').code, 'HS001');
assert.throws(() => service.createParticipant({ code: 'HS001', group: 'fixed', order: 'BA' }));
assert.throws(() => service.startStage('HS001', 'post'));
assert.throws(() => service.startStage('HS001', 'invalid'));
service.startStage('HS001', 'pre');
let participant = service.getParticipant('HS001');
const start = participant.stages.pre.startedAt;
assert.equal(participant.stages.pre.form, 'A');
assert.ok(service.questions('HS001', 'pre').every(q => !('ans' in q) && !('exp' in q)));
assert.equal(service.participantResult('HS001'), null);
assert.throws(() => service.submitStage('HS001', 'pre'));
assert.throws(() => service.answer('HS001', 'pre', -1, 0));
assert.throws(() => service.answer('HS001', 'pre', 0, 4));
now += 1000;
service.answer('HS001', 'pre', 0, ASSESSMENT_FORMS.A[0].ans);
// Recreating the service emulates a reload: answers and start time must survive.
service = new AssessmentService({ storage, now: () => now });
assert.equal(service.getParticipant('HS001').stages.pre.answers[0], ASSESSMENT_FORMS.A[0].ans);
service.startStage('HS001', 'pre');
assert.equal(service.getParticipant('HS001').stages.pre.startedAt, start);
for (let index = 1; index < 12; index++) { now += 1000; service.answer('HS001', 'pre', index, index < 6 ? ASSESSMENT_FORMS.A[index].ans : (ASSESSMENT_FORMS.A[index].ans + 1) % 4); }
now += 1000; service.submitStage('HS001', 'pre');
const firstSubmission = service.getParticipant('HS001').stages.pre.completedAt;
now += 5000; service.submitStage('HS001', 'pre');
assert.equal(service.getParticipant('HS001').stages.pre.completedAt, firstSubmission, 'Submission is idempotent');
assert.throws(() => service.answer('HS001', 'pre', 0, 1), /đã nộp/);
assert.equal(service.report().paired, 0);
assert.equal(service.report().unpaired, 1);
assert.equal(service.participantResult('HS001'), null, 'No pre feedback before post');
assert.ok(service.questions('HS001', 'pre').every(q => !('ans' in q)));
const unpairedRows = service.exportCsv().trim().split('\r\n').slice(1);
assert.equal(unpairedRows.length, 13, '12 pre items plus not-started post stage');
assert.ok(unpairedRows.every(row => row.split(',')[10] === '""'), 'CSV must not reveal correctness before pair completion');
service.startStage('HS001', 'post');
assert.equal(service.getParticipant('HS001').stages.post.form, 'B');
for (let index = 0; index < 12; index++) { now += 1000; service.answer('HS001', 'post', index, ASSESSMENT_FORMS.B[index].ans); }
now += 1000; service.submitStage('HS001', 'post');
const result = service.participantResult('HS001');
assert.equal(result.pre.correct, 6); assert.equal(result.post.correct, 12); assert.equal(result.gain, 50);
assert.equal(result.pre.durationMs, 13000);
assert.equal(result.pre.byLesson.length, 6);
assert.ok(result.pre.byLesson.every(l => l.total === 2));
assert.ok(service.questions('HS001', 'pre').every(q => 'ans' in q && 'exp' in q));
assert.ok(service.exportCsv().startsWith('\uFEFF'));
assert.equal(service.exportCsv().trim().split('\r\n').length, 25);
let report = service.report(); assert.equal(report.paired, 1); assert.equal(report.unpaired, 0);
assert.equal(report.groups.find(g => g.group === 'adaptive').gainMean, 50);
assert.equal(report.groups.find(g => g.group === 'fixed').gainMean, null);
assert.equal(report.groups.find(g => g.group === 'adaptive').orders.AB, 1);
// BA counterbalance, negative gain, and a backwards clock: retain score but reject timings.
service.createParticipant({ code: 'HS002', group: 'fixed', order: 'BA' });
service.startStage('HS002', 'pre');
for (let i = 0; i < 12; i++) service.answer('HS002', 'pre', i, ASSESSMENT_FORMS.B[i].ans);
service.submitStage('HS002', 'pre');
service.startStage('HS002', 'post');
for (let i = 0; i < 12; i++) service.answer('HS002', 'post', i, (ASSESSMENT_FORMS.A[i].ans + 1) % 4);
now -= 60000; service.submitStage('HS002', 'post');
assert.equal(service.participantResult('HS002').gain, -100);
assert.equal(service.participantResult('HS002').post.durationMs, null);
assert.equal(service.report().groups.find(g => g.group === 'fixed').validTimingPairs, 0);
assert.equal(service.report().groups.find(g => g.group === 'fixed').orders.BA, 1);
service.createParticipant({ code: 'HS003', group: 'fixed', order: 'AB' });
service.startStage('HS003', 'pre');
for (let i = 0; i < 12; i++) service.answer('HS003', 'pre', i, ASSESSMENT_FORMS.A[i].ans);
now += 86400001; service.submitStage('HS003', 'pre');
assert.equal(service.score(service.getParticipant('HS003'), 'pre').durationMs, null, 'Sessions over 24h must not appear as valid speed measures');
assert.equal(service.report().unpaired, 1);
// Completed results are derived from responses, never a user-entered score.
const backup = JSON.parse(service.exportJson());
assert.equal(backup.version, ASSESSMENT_VERSION);
assert.ok(!('score' in backup.participants[0].stages.pre));
service.deleteParticipant('HS001'); assert.equal(service.getParticipant('HS001'), null);
assert.equal(service.report().paired, 1);
service.clearAll(); assert.equal(service.report().participants, 0); assert.equal(values.get('unrelated-key'), 'keep me');
// Corrupted records are retained for recovery and cannot be overwritten by a new participant.
values.set(ASSESSMENT_STORAGE_KEY, '{broken');
assert.equal(service.listParticipants().length, 0); assert.ok(service.problem);
assert.equal(service.exportJson(), '{broken');
assert.throws(() => service.exportCsv(), /Chưa đọc/);
assert.throws(() => service.createParticipant({ code: 'HS003', group: 'fixed', order: 'AB' }));
assert.equal(values.get(ASSESSMENT_STORAGE_KEY), '{broken');
service.clearAll();
const invalid = structuredClone(backup); invalid.participants[0].stages.pre.answers[0] = 99;
values.set(ASSESSMENT_STORAGE_KEY, JSON.stringify(invalid));
assert.equal(service.listParticipants().length, 0); assert.ok(service.problem); service.clearAll();
const illegalPost = structuredClone(backup); delete illegalPost.participants[0].stages.pre;
values.set(ASSESSMENT_STORAGE_KEY, JSON.stringify(illegalPost)); assert.equal(service.listParticipants().length, 0); service.clearAll();
const duplicate = structuredClone(backup); duplicate.participants.push(duplicate.participants[0]);
values.set(ASSESSMENT_STORAGE_KEY, JSON.stringify(duplicate)); assert.equal(service.listParticipants().length, 0); service.clearAll();
const noStorage = new AssessmentService({ storage: null });
assert.equal(noStorage.listParticipants().length, 0); assert.ok(noStorage.problem);
assert.throws(() => noStorage.createParticipant({ code: 'HS004', group: 'fixed', order: 'AB' }));
const quota = new AssessmentService({ storage: { getItem: () => null, setItem: () => { throw new Error('Quota'); } } });
assert.throws(() => quota.createParticipant({ code: 'HS005', group: 'fixed', order: 'AB' }), /Không lưu/);
// A failed answer write must preserve the previous saved answer and resume point.
const failureStore = new Map();
let failWrites = false;
const fragileStorage = { getItem: key => failureStore.get(key) ?? null, setItem: (key, value) => { if (failWrites) throw new Error('Quota'); failureStore.set(key, value); }, removeItem: key => failureStore.delete(key) };
const fragile = new AssessmentService({ storage: fragileStorage, now: () => now });
fragile.createParticipant({ code: 'HS006', group: 'adaptive', order: 'AB' }); fragile.startStage('HS006', 'pre');
failWrites = true;
assert.throws(() => fragile.answer('HS006', 'pre', 0, 1), /Không lưu/);
assert.equal(fragile.getParticipant('HS006').stages.pre.answers[0], null);
// Limit enforcement preserves all existing participants; it never silently drops old results.
const fullState = { version: ASSESSMENT_VERSION, participants: Array.from({ length: ASSESSMENT_MAX_PARTICIPANTS }, (_, index) => ({ code: `CAP${index}`, group: 'fixed', order: 'AB', createdAt: new Date(now).toISOString(), stages: {} })) };
values.set(ASSESSMENT_STORAGE_KEY, JSON.stringify(fullState));
assert.throws(() => service.createParticipant({ code: 'OVERFLOW', group: 'fixed', order: 'AB' }), /200/);
assert.equal(service.listParticipants().length, 200);
assert.equal(ASSESSMENT_MAX_PARTICIPANTS, 200);
console.log('PASS held-out 24-question coverage and answer checks, paired stages, AB/BA, no early feedback, resume/idempotency, scores/gains, timing exclusions, CSV/JSON, corrupt/quota handling and isolated deletion');
