import assert from 'node:assert/strict';
import {
    assessPracticeRecord, createCourseBackup, limits, parseCourseBackup,
} from '../frontend/src/modules/learning/PracticePortfolio.js';

const lesson = { id: 'led', opts: ['Bật', 'Tắt', 'Nhấp nháy'], answer: 2 };
const course = { id: 'arduino', lessons: [lesson, { id: 'button', opts: ['A', 'B'], answer: 0 }] };
const backupText = records => JSON.stringify({ course: course.id, records });
const parseRecord = record => parseCourseBackup(backupText({ led: record }), course).records.led;
const complete = {
    note: 'Nhật ký của tôi <script>không phải HTML</script>',
    choice: 2,
    done: true,
    prediction: 'Đặt chu kỳ 1000 ms thì LED đổi trạng thái mỗi giây.',
    observation: 'Chu kỳ 1000 ms: LED sáng 1 giây và tắt 1 giây.',
    explanation: 'Mỗi trạng thái chờ 1000 ms nên một chu kỳ sáng/tắt mất 2 giây.',
    transfer: 'Đổi thành 500 ms: LED sáng 0,5 giây, tắt 0,5 giây vì thời gian chờ giảm một nửa.',
    source: 'external',
    projectUrl: 'https://example.com/project/led?version=2',
    completedAt: '2026-11-08T11:30:00.000Z',
};

// Legacy exports retain learner notes, answer and completion, with honest provenance.
const legacy = parseRecord({ note: 'Bản ghi cũ', choice: 1, done: true, verified: true, score: 100 });
assert.deepEqual(legacy, { note: 'Bản ghi cũ', choice: 1, done: true, completionSource: 'imported-self-report' });
assert.equal(parseRecord({}).done, false);
assert.equal(parseRecord({ done: false }).completionSource, undefined);
assert.equal(assessPracticeRecord(legacy, { lesson }).ready, false);

// Export and import keep only supported data, even if a future record contains grading claims.
const original = Object.freeze({ ...complete, verified: true, arbitrary: { doNotCopy: true } });
const records = Object.freeze({ led: original });
const exported = createCourseBackup(course, records, { exportedAt: '2026-11-08T12:00:00.000Z' });
assert.equal(exported.schemaVersion, 2);
assert.equal(exported.course, course.id);
assert.equal(exported.records.led.verified, undefined);
assert.equal(exported.records.led.arbitrary, undefined);
assert.equal(original.verified, true);
assert.equal(original.completionSource, undefined);
const imported = parseCourseBackup(JSON.stringify(exported), course);
assert.equal(imported.records.led.note, complete.note);
assert.equal(imported.records.led.completionSource, 'imported-self-report');
assert.equal(imported.exportedAt, exported.exportedAt);
assert.equal(imported.records.led.completedAt, complete.completedAt);
assert.deepEqual(assessPracticeRecord(imported.records.led, { lesson, course }), { ready: true, missing: [], verified: false });
assert.equal(assessPracticeRecord({ ...complete, source: 'hardware' }, { lesson }).ready, true);

// Validation is all-or-nothing, so a later malformed record cannot partially replace state.
const existing = { led: { note: 'Giữ nhật ký này', choice: 0, done: false } };
let replacement = existing;
assert.throws(() => {
    const parsed = parseCourseBackup(backupText({ led: complete, button: { note: 'Lỗi', choice: 99, done: true } }), course);
    replacement = parsed.records;
});
assert.equal(replacement, existing);
assert.equal(existing.led.note, 'Giữ nhật ký này');

const invalidRecords = [
    null, [], 'done', { note: 7 }, { choice: -1 }, { choice: 0.5 }, { choice: 3 },
    { done: 'true' }, { done: 1 }, { prediction: false }, { source: 'verified' },
    { projectUrl: 'javascript:alert(1)' }, { projectUrl: 'http://example.com' },
    { projectUrl: 'https://person:secret@example.com/project' }, { projectUrl: '/relative' },
    { note: '\u0000' }, { modelEvidence: {} },
];
for (const invalid of invalidRecords) assert.throws(() => parseRecord(invalid), JSON.stringify(invalid));
for (const field of ['note', 'prediction', 'observation', 'explanation', 'transfer', 'projectUrl']) {
    assert.throws(() => parseRecord({ [field]: 'x'.repeat(limits[field] + 1) }), `${field} is bounded`);
}
for (const field of ['note', 'prediction', 'observation', 'explanation', 'transfer']) {
    assert.equal(parseRecord({ [field]: 'x'.repeat(limits[field]) })[field].length, limits[field]);
}
for (const value of ['', '{', '[]', 'null', '{}', backupText({ unknown: {} }), backupText({ led: {}, unknown: {} })]) {
    assert.throws(() => parseCourseBackup(value, course));
}
assert.throws(() => parseCourseBackup(JSON.stringify({ course: 'microbit', records: { led: complete } }), course));
assert.throws(() => parseCourseBackup(JSON.stringify({ schemaVersion: 99, course: course.id, records: {} }), course));
assert.throws(() => parseCourseBackup(JSON.stringify({ course: course.id, records: {}, exportedAt: 'yesterday' }), course));
assert.throws(() => parseCourseBackup(' '.repeat(limits.backupBytes + 1), course));
assert.throws(() => parseCourseBackup(JSON.stringify({ course: course.id, records: {}, ignored: '😀'.repeat(limits.backupBytes / 3) }), course), 'UTF-8 bytes are bounded');
assert.throws(() => parseCourseBackup(backupText({}), { ...course, lessons: [{ ...lesson, id: '__proto__' }] }));

// Every JSON level is protected, even keys in unknown fields that will otherwise be discarded.
for (const value of [
    '{"course":"arduino","records":{"__proto__":{"done":true}}}',
    '{"course":"arduino","records":{"led":{"__proto__":{"polluted":true}}}}',
    '{"course":"arduino","records":{"led":{"constructor":{"prototype":{"polluted":true}}}}}',
    '{"course":"arduino","records":{"led":{}},"ignored":{"prototype":{"polluted":true}}}',
]) assert.throws(() => parseCourseBackup(value, course));
assert.equal({}.polluted, undefined);

// A local-model run needs actions from this lesson and the prediction captured before that run.
const evidence = {
    kind: 'local-model', lessonId: 'led', summary: 'Chu kỳ 1000 ms; LED sáng và tắt mỗi giây.',
    actions: ['Đặt thời gian 1000 ms', 'Chạy mô hình'], prediction: complete.prediction,
};
const local = { ...complete, source: 'local-model', modelEvidence: evidence };
assert.deepEqual(assessPracticeRecord(local, { lesson }), { ready: true, missing: [], verified: false });
const localImported = parseRecord(local);
assert.equal(localImported.modelEvidence.prediction, complete.prediction);
assert.equal(assessPracticeRecord(localImported, { lesson }).verified, false);
assert.notEqual(localImported.modelEvidence, evidence);
assert.notEqual(localImported.modelEvidence.actions, evidence.actions);
for (const model of [
    undefined,
    { ...evidence, lessonId: 'button' },
    { ...evidence, actions: [] },
    { ...evidence, actions: ['  '] },
    { ...evidence, summary: ' ' },
    { ...evidence, prediction: 'Một dự đoán khác' },
    { ...evidence, prediction: undefined },
]) assert.equal(assessPracticeRecord({ ...local, modelEvidence: model }, { lesson }).ready, false);
for (const model of [
    { ...evidence, kind: 'external' },
    { ...evidence, lessonId: 'button' },
    { ...evidence, actions: 1 },
    { ...evidence, actions: new Array(limits.actions + 1).fill('run') },
    { ...evidence, actions: ['a'.repeat(limits.action + 1)] },
    { ...evidence, summary: 'a'.repeat(limits.summary + 1) },
    { ...evidence, prediction: 'a'.repeat(limits.prediction + 1) },
]) assert.throws(() => parseRecord({ ...local, modelEvidence: model }));

// Assessment checks the learner's required entries without pretending to judge their truth.
for (const field of ['prediction', 'observation', 'explanation', 'transfer']) {
    const incomplete = assessPracticeRecord({ ...complete, [field]: '  ' }, { lesson });
    assert.equal(incomplete.ready, false);
    assert.ok(incomplete.missing.length > 0);
    assert.equal(incomplete.verified, false);
}
assert.equal(assessPracticeRecord({ ...complete, choice: 0 }, { lesson }).ready, false);
assert.equal(assessPracticeRecord({ ...complete, source: '' }, { lesson }).ready, false);
assert.equal(assessPracticeRecord({ ...complete, projectUrl: 'http://example.com' }, { lesson }).ready, false);
assert.equal(assessPracticeRecord({ ...complete, projectUrl: '' }, { lesson }).ready, true);
assert.throws(() => parseRecord({ completedAt: 'yesterday' }));
assert.equal(assessPracticeRecord(complete, { lesson: { ...lesson, answer: 99 } }).ready, false);
assert.equal(assessPracticeRecord(complete, { lesson, course: { lessons: [] } }).ready, false);
assert.equal(assessPracticeRecord(null, { lesson }).ready, false);
assert.equal(assessPracticeRecord(complete).ready, false);
assert.equal(assessPracticeRecord({ ...complete, prediction: 'x', observation: 'y', explanation: 'z', transfer: 'w' }, { lesson }).ready, true,
    'Text length is not a claim of correctness; completion stays self-reported');

console.log('Practice portfolio: legacy/new backups, atomic validation, safe bounds and self-assessment passed.');
