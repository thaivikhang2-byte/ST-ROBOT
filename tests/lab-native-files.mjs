import assert from 'node:assert/strict';
import { encodeLabFile, decodeLabFile, normalizeLabFiles } from '../frontend/src/modules/learning/LabArtifacts.js';
import { normalizeLabWork, normalizeLabWorkMap } from '../frontend/src/modules/learning/LabWorkspace.js';
import { createCourseBackup, parseCourseBackup } from '../frontend/src/modules/learning/PracticePortfolio.js';
import { buildTutorLearningContext } from '../frontend/src/services/TutorLearningContext.js';

const base = { version: 2, savedAt: '2026-11-25T00:00:00.000Z', code: 'print("resume robot")',
    notes: 'Sân có hai hộp; robot xuất phát ở góc trái.', projectUrl: '', fileName: 'main.py' };
const bytes = Uint8Array.from([80, 75, 3, 4, 0, 255, 128, 13, 10]);
const file = (name, data = bytes) => ({ name, dataBase64: encodeLabFile(data) });
const work = { ...base, files: [file('robot.zip'), file('Map_config.json', new TextEncoder().encode('{"groundType":"box"}'))] };
assert.deepEqual(decodeLabFile(work.files[0].dataBase64), bytes);
assert.deepEqual(normalizeLabWork(work, 'gears'), work);
assert.deepEqual(normalizeLabWork(JSON.parse(JSON.stringify(work)), 'gears'), work);
assert.deepEqual(normalizeLabWorkMap({ gears: work }, 'vex-iq').gears.files, work.files);
const course = { id: 'vex-iq', lessons: [{ id: 'drive', opts: ['a', 'b'], answer: 0 }] };
const snapshot = createCourseBackup(course, { drive: { labWork: { gears: work } } });
const restored = parseCourseBackup(JSON.stringify(snapshot), course).records.drive.labWork.gears;
assert.deepEqual(decodeLabFile(restored.files[0].dataBase64), bytes, 'Native backup bytes survive course export/import');

const max = file('full.zip', new Uint8Array(256 * 1024));
assert.deepEqual(normalizeLabFiles([max], 'gears'), [max]);
for (const malformed of [
    [{ name: 'robot.zip', dataBase64: 'Zh==' }], [{ name: 'robot.zip', dataBase64: 'Zg==\n' }],
    [file('../robot.zip')], [file('robot..zip')], [file('folder/robot.zip')], [file('robot.exe')],
    [file('A.py'), file('a.py')], [max, file('extra.py')],
    Array.from({ length: 5 }, (_, index) => file(index + '.py')),
    [{ ...file('robot.zip'), ownerId: 'another-account' }],
]) assert.throws(() => normalizeLabFiles(malformed, 'gears'));
assert.throws(() => encodeLabFile(new Uint8Array(256 * 1024 + 1)));
assert.throws(() => normalizeLabWork({ ...work, ownerId: 'another-account' }, 'gears'));
assert.throws(() => normalizeLabWork({ ...work, version: 1 }, 'gears'));
assert.throws(() => normalizeLabWork(work, 'circuit'));
assert.throws(() => normalizeLabWork({ ...work, files: [file('board.json')] }, 'phet'));
assert.throws(() => normalizeLabWork({ ...work, files: [file('board.txt')] }, 'local'));

// Retired players disappear from the menu, while old account backups remain intact.
const legacy = { ...base, version: 1 };
const oldCourse = { id: 'microbit', lessons: [{ id: 'matrix', opts: ['a', 'b'], answer: 0 }] };
const archived = createCourseBackup(oldCourse, { matrix: { labWork: { scratch: legacy, arcade: legacy } } });
assert.deepEqual(parseCourseBackup(JSON.stringify(archived), oldCourse).records.matrix.labWork.scratch, legacy);

const privateBody = 'opaque archive contents must never be sent to the AI';
const report = buildTutorLearningContext({ courses: [course], courseId: 'vex-iq', lessonId: 'drive', platformKey: 'gears',
    currentRecord: { labWork: { gears: { ...work, files: [file('robot.zip', new TextEncoder().encode(privateBody))] } } } });
assert.match(report.currentLesson.journal.note, /resume robot/);
assert.ok(!JSON.stringify(report).includes(privateBody));
assert.ok(!JSON.stringify(report).includes(encodeLabFile(new TextEncoder().encode(privateBody))));
assert.ok(!JSON.stringify(report).includes('dataBase64'));
console.log('PASS native lab files: byte-exact round trips, platform types, aggregate limits, archived backups and bounded AI context');
