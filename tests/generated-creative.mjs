import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { creativeTemplates } from '../frontend/src/modules/quiz/generation/templates/creative.js';

const curriculum = JSON.parse(readFileSync(new URL('../ai-server/curriculum.json', import.meta.url), 'utf8'));
const byId = new Map(creativeTemplates.map(template => [template.id, template]));
const template = id => {
    assert.ok(byId.has(id), `Missing template ${id}`);
    return byId.get(id);
};
const render = (id, index) => template(id).render(index);
const answer = question => question.opts[question.ans];
const numericAnswer = question => Number(answer(question).split(' ')[0].replace(',', '.'));
const rounded = (number, digits = 2) => Number(number.toFixed(digits));
const assertNumber = (question, expected, digits = 2) => assert.equal(numericAnswer(question), rounded(expected, digits), question.q);
const find = (id, predicate) => {
    const source = template(id);
    for (let index = 0; index < source.variantCount; index++) {
        const question = source.render(index);
        if (predicate(question)) return question;
    }
    throw new Error(`No matching boundary case in ${id}`);
};

assert.equal(creativeTemplates.length, 24);
assert.equal(byId.size, creativeTemplates.length, 'Template IDs cannot collide');
let rendered = 0;
for (const source of creativeTemplates) {
    assert.match(source.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(source.skillId);
    assert.ok(['basic', 'apply', 'reason'].includes(source.level));
    const course = curriculum.find(course => course.id === source.courseId);
    assert.ok(course?.lessons.some(lesson => lesson.id === source.lessonId), `${source.id}: unknown curriculum lesson`);
    assert.ok(Number.isSafeInteger(source.variantCount) && source.variantCount >= 50);
    for (const invalid of [-1, source.variantCount, 0.5, undefined, null, '0', NaN, Infinity]) {
        assert.throws(() => source.render(invalid), RangeError, `${source.id}: rejects ${String(invalid)}`);
    }
    const stems = new Set();
    for (let index = 0; index < source.variantCount; index++) {
        const question = source.render(index);
        assert.ok(question.q.length > 25 && question.exp.length > 25, `${source.id}:${index}: complete question and explanation`);
        assert.ok([3, 4].includes(question.opts.length));
        assert.equal(new Set(question.opts).size, question.opts.length);
        assert.ok(question.opts.every(option => typeof option === 'string' && option.trim()));
        assert.ok(Number.isInteger(question.ans) && question.ans >= 0 && question.ans < question.opts.length);
        assert.deepEqual(source.render(index), question, `${source.id}:${index}: deterministic`);
        assert.ok(!stems.has(question.q), `${source.id}:${index}: duplicate case cannot increase capacity`);
        stems.add(question.q);
        rendered++;
    }
}
assert.equal(rendered, 11255);
for (const courseId of ['microbit', 'lego-spike']) {
    const course = curriculum.find(course => course.id === courseId);
    assert.equal(course.lessons.length, 6);
    for (const lesson of course.lessons) {
        const sources = creativeTemplates.filter(source => source.courseId === courseId && source.lessonId === lesson.id);
        assert.equal(sources.length, 2, `${courseId}/${lesson.id}: two complementary templates`);
        assert.deepEqual(new Set(sources.map(source => source.level)), new Set(['basic', 'apply']));
    }
}

// Check calculations from the generated problem data, independently of its index decoder.
for (const source of creativeTemplates) {
    for (let index = 0; index < source.variantCount; index++) {
        const question = source.render(index);
        const stem = question.q;
        if (source.id === 'mb-matrix-pixel') {
            const [, x, y, brightness] = stem.match(/display\.set_pixel\((\d), (\d), (\d)\)/).map(Number);
            assert.equal(answer(question), `Cột ${x + 1}, hàng ${y + 1}, độ sáng ${brightness}`);
        } else if (source.id === 'mb-matrix-update') {
            const instructions = [...stem.matchAll(/display\.set_pixel\((\d), (\d), (\d)\)/g)];
            const display = Array(25).fill(0);
            for (const [, rawX, rawY, rawBrightness] of instructions) display[Number(rawX) + 5 * Number(rawY)] = Number(rawBrightness);
            const remaining = display.flatMap((brightness, cell) => brightness ? [[cell % 5, Math.floor(cell / 5), brightness]] : []);
            assert.equal(remaining.length, 1);
            const [x, y, brightness] = remaining[0];
            assert.equal(answer(question), `Chỉ điểm (${x}, ${y}) sáng ở mức ${brightness}`);
        } else if (source.id === 'mb-light-threshold') {
            const level = Number(stem.match(/level = (\d+)/)[1]);
            const threshold = Number(stem.match(/if level < (\d+)/)[1]);
            assert.equal(answer(question), level < threshold ? 'Hiển thị trái tim' : 'Xóa màn hình');
        } else if (source.id === 'mb-light-sample-series') {
            const readings = stem.match(/\[([^\]]+)\]/)[1].split(', ').map(Number);
            const threshold = Number(stem.match(/level < (\d+)/)[1]);
            assertNumber(question, readings.reduce((count, reading) => count + Number(reading < threshold), 0), 0);
        } else if (source.id === 'mb-counter-batch') {
            const initial = Number(stem.match(/count = (\d+)/)[1]);
            const presses = Number(stem.match(/trả (\d+), button_b/)[1]);
            assertNumber(question, initial + presses, 0);
        } else if (source.id === 'mb-radio-value-validation') {
            const [, field, raw] = stem.match(/vừa nhận "([^:]+):(-?\d+)"/);
            const value = Number(raw);
            assertNumber(question, field === 'temp' && value >= -20 && value <= 60 ? value : 17, 0);
        } else if (source.id === 'mb-radio-last-valid') {
            const packets = [...stem.matchAll(/"((?:temp|humidity):[^"]+)"/g)].map(match => match[1]);
            assert.equal(packets.length, 2);
            let last = 10;
            for (const packet of packets) {
                const delimiter = packet.indexOf(':');
                const field = packet.slice(0, delimiter);
                const number = Number(packet.slice(delimiter + 1));
                if (field === 'temp' && Number.isFinite(number) && number >= -20 && number <= 60) last = number;
            }
            assertNumber(question, last, 0);
        } else if (source.id === 'spike-colors-group-presence') {
            const raw = Number(stem.match(/Với raw = (\d+)/)[1]);
            const distance = Number(stem.match(/distance = (-?[\d,]+) cm/)[1].replace(',', '.'));
            const group = raw === 2 ? 'B' : raw === 5 ? 'A' : 'CHECK';
            assert.equal(answer(question), `group = "${group}"; near = ${distance > 0 && distance <= 3 ? 'True' : 'False'}`);
        } else if (source.id === 'spike-colors-stable-samples') {
            const samples = stem.match(/\[([^\]]+)\]/)[1].split(', ').map(Number);
            const onlyValue = new Set(samples);
            const expected = onlyValue.size === 1 && samples[0] === 2 ? 'B' : onlyValue.size === 1 && samples[0] === 5 ? 'A' : 'CHECK';
            assert.equal(answer(question), expected);
        } else if (source.id === 'spike-sort-clear-debounce') {
            // Independent criterion: a substring of three clear readings must exist.
            const readings = stem.match(/\[([^\]]+)\]/)[1].split(', ').map(Number);
            const threeClear = readings.some((_, offset) => offset <= readings.length - 3 && readings.slice(offset, offset + 3).every(value => value >= 8));
            assertNumber(question, Number(threeClear), 0);
        } else if (source.id === 'spike-project-complete-denominator') {
            const total = Number(stem.match(/đủ (\d+) lượt/)[1]);
            const correct = Number(stem.match(/và (\d+) lượt đến đúng/)[1]);
            assertNumber(question, correct / total * 100);
        } else if (source.id === 'spike-project-improvement') {
            const total = Number(stem.match(/đủ (\d+) lượt/)[1]);
            const before = Number(stem.match(/có (\d+) lượt đúng, sau/)[1]);
            const after = Number(stem.match(/sau thay đổi có (\d+)/)[1]);
            assertNumber(question, after / total * 100 - before / total * 100);
        }
    }
}

// Coordinate and state boundaries that previously cause off-by-one and precedence bugs.
assert.equal(answer(render('mb-matrix-pixel', 0)), 'Cột 1, hàng 1, độ sáng 1');
assert.equal(answer(render('mb-matrix-pixel', 224)), 'Cột 5, hàng 5, độ sáng 9');
assertNumber(render('mb-buttons-edges', 0), 2, 0);
assertNumber(render('mb-buttons-edges', 360), 20, 0);
assert.equal(answer(render('mb-buttons-poll-order', 0)), '1 lần hiển thị trái tim; 1 lần xóa');
for (const [level, result] of [[79, 'Hiển thị trái tim'], [80, 'Xóa màn hình'], [81, 'Xóa màn hình']]) {
    assert.equal(answer(find('mb-light-threshold', q => q.q.includes(`level = ${level} `) && q.q.includes('if level < 80:'))), result);
}
assertNumber(render('mb-counter-reset-priority', 999), 9, 0); // 9 + 9 with reset must not become 27 or 18.
assertNumber(render('mb-counter-reset-priority', 990), 0, 0); // Next get_presses does not replay discarded presses.
for (const [value, expected] of [[-21, 17], [-20, -20], [60, 60], [61, 17]]) {
    assertNumber(find('mb-radio-value-validation', q => q.q.includes(`"temp:${value}"`)), expected, 0);
}
assertNumber(find('mb-radio-value-validation', q => q.q.includes('"humidity:25"')), 17, 0);
assertNumber(find('mb-radio-last-valid', q => q.q.includes('"temp:-20" rồi "temp:0:bad"')), -20, 0);
assertNumber(render('mb-project-restart-case', 899), 9, 0);
assert.equal(answer(render('mb-project-regression-case', 0)), 'Kỳ vọng 2; chương trình lỗi cho 1');

// Gear answers derived from independent kinematic/energy constraints.
assertNumber(render('spike-mechanism-output-angle', 0), 7.5);
assertNumber(find('spike-mechanism-output-angle', q => q.q.includes('vào 12 răng, bánh ra 36 răng') && q.q.includes('vào quay 90°')), -30);
assertNumber(find('spike-mechanism-required-angle', q => q.q.includes('12:36') && q.q.includes('dịch 20°')), -60);
for (const source of [template('spike-ratio-signed-speed'), template('spike-ratio-efficiency-torque')]) {
    for (let index = 0; index < source.variantCount; index++) {
        const question = source.render(index);
        if (source.id === 'spike-ratio-signed-speed') {
            const [, inputTeeth, inputSpeed, outputTeeth] = question.q.match(/bánh vào (\d+) răng quay (-?\d+) rpm, bánh ra (\d+) răng/).map(Number);
            // Teeth crossing the mesh per minute are equal and directions opposite.
            assertNumber(question, -inputSpeed * inputTeeth / outputTeeth);
        } else {
            const [, inputTeeth, outputTeeth] = question.q.match(/bánh răng (\d+):(\d+)/).map(Number);
            const inputTorque = Number(question.q.match(/mô-men vào ([\d,]+) N/)[1].replace(',', '.'));
            const efficiency = Number(question.q.match(/η = ([\d,]+)/)[1].replace(',', '.'));
            const outputSpeedRatio = inputTeeth / outputTeeth;
            assertNumber(question, inputTorque * efficiency / outputSpeedRatio, 3);
        }
    }
}
assertNumber(find('spike-ratio-efficiency-torque', q => q.q.includes('12:36') && q.q.includes('vào 0,1 N') && q.q.includes('η = 0,8.')), 0.24, 3);

assert.equal(answer(find('spike-colors-group-presence', q => q.q.includes('Với raw = 5, distance = 3 cm'))), 'group = "A"; near = True');
assert.equal(answer(find('spike-colors-group-presence', q => q.q.includes('Với raw = 5, distance = 0 cm'))), 'group = "A"; near = False');
assert.equal(answer(find('spike-colors-stable-samples', q => q.q.includes('[5, 5, 2]'))), 'CHECK');
assert.equal(answer(find('spike-colors-stable-samples', q => q.q.includes('[2, 2, 2]'))), 'B');
assert.equal(answer(find('spike-colors-stable-samples', q => q.q.includes('[7, 7, 7]'))), 'CHECK');
for (const [mask, count] of [[0, 0], [7, 1], [21, 0], [28, 1], [56, 1], [63, 1]]) {
    assertNumber(render('spike-sort-clear-debounce', mask), count, 0);
}
assertNumber(render('spike-sort-one-cycle-per-object', 170), 20, 0);
assertNumber(render('spike-project-complete-denominator', 8), 10);
assertNumber(find('spike-project-improvement', q => q.q.includes('đủ 10 lượt') && q.q.includes('có 1 lượt đúng, sau thay đổi có 3 lượt đúng')), 20);
assertNumber(render('spike-state-entry-actions', 125), 30, 0);

for (const phase of ['CLOSE', 'OPEN']) {
    const target = phase === 'CLOSE' ? 0 : 45;
    for (const encoder of [target - 3, target - 2, target, target + 2, target + 3]) {
        const predicate = time => q => q.q.includes(`pha ${phase}, target = ${target}°, encoder = ${encoder}°`) && q.q.includes(`Hạn pha là 10 s; thời điểm hiện tại ${time} s.`);
        assert.equal(answer(find('spike-state-timeout-priority', predicate('10'))), 'Sang ERROR vì hết hạn', 'Timeout wins even when encoder arrives at exact deadline');
        assert.equal(answer(find('spike-state-timeout-priority', predicate('10,1'))), 'Sang ERROR vì hết hạn');
        const beforeDeadline = answer(find('spike-state-timeout-priority', predicate('9,9')));
        const closeEnough = Math.abs(encoder - target) <= 2;
        assert.equal(beforeDeadline, !closeEnough ? `Giữ CLASSIFY, pha ${phase}, tiếp tục chờ` : phase === 'CLOSE' ? 'Giữ CLASSIFY, đổi sang pha OPEN và phát một lệnh mở' : 'Tăng gate_cycles một lần, sang WAIT_CLEAR');
    }
}

console.log(`Creative question templates: ${creativeTemplates.length} templates / ${rendered} unique deterministic cases passed.`);
