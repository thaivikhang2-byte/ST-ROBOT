import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { roboticsTemplates } from '../frontend/src/modules/quiz/generation/templates/robotics.js';

// Answer oracles below read the student-visible inputs, not template internals.
// They independently check every finite variant, including the domain edges.
const number = text => Number(String(text).replace(',', '.'));
const match = (text, pattern) => {
    const result = text.match(pattern);
    assert.ok(result, `Cannot read question inputs: ${pattern}\n${text}`);
    return result.slice(1);
};
const numeric = (value, unit = '', digits = 2) => {
    // A change in operation order may put a mathematical halfway value on
    // either side by one floating point ulp. Stabilize that test oracle only.
    const scale = 10 ** digits;
    const rounded = Math.round((value + Number.EPSILON * Math.max(1, Math.abs(value)) * 4) * scale) / scale;
    return `${rounded.toString().replace('.', ',')}${unit ? ` ${unit}` : ''}`;
};
const headings = ['đông', 'nam', 'tây', 'bắc'];
const showPose = ([x, y, heading]) => `(${x}, ${y}, ${heading})`;
const shortestSigned = angle => {
    while (angle >= 180) angle -= 360;
    while (angle < -180) angle += 360;
    return angle;
};
const limit = value => value < -100 ? -100 : value > 100 ? 100 : value;
const wheelAnswer = (left, right) => `Trái ${numeric(left)}%; phải ${numeric(right)}%`;

// A separate state interpreter uses named directions, and asserts every
// intermediate pose stays in the bounds published in the question.
function trace(start, route, width, height) {
    let [x, y, heading] = start;
    let forwards = 0, turns = 0;
    for (const action of route.split(/\s+/)) {
        if (action === 'F') {
            if (heading === 'đông') x++;
            if (heading === 'nam') y++;
            if (heading === 'tây') x--;
            if (heading === 'bắc') y--;
            forwards++;
        } else {
            assert.ok(action === 'R' || action === 'L');
            heading = headings[(headings.indexOf(heading) + (action === 'R' ? 1 : 3)) % 4];
            turns++;
        }
        assert.ok(x >= 0 && x < width && y >= 0 && y < height, `Route leaves ${width}×${height}`);
    }
    return { pose: [x, y, heading], forwards, turns };
}

const routeA = 'F R F L F F R F';
const routeB = 'F F F F R F F R F';
const aInfo = trace([0, 0, 'đông'], routeA, 5, 4);
const bInfo = trace([0, 0, 'đông'], routeB, 5, 4);
assert.deepEqual(aInfo, { pose: [3, 2, 'nam'], forwards: 5, turns: 3 });
assert.deepEqual(bInfo, { pose: [3, 2, 'tây'], forwards: 7, turns: 2 });
assert.deepEqual(trace([0, 0, 'đông'], `${routeB} L`, 5, 4).pose, [3, 2, 'nam']);

function expectedAnswer(template, question) {
    const q = question.q;
    switch (template.id) {
    case 'iq-drive-distance': {
        const [speed, seconds] = match(q, /tuyến (\d+) mm\/s, chạy thẳng trong (\d+) s/).map(Number);
        return numeric(speed * seconds, 'mm');
    }
    case 'iq-drive-grid-pose': {
        const [x, y, route] = match(q, /Từ \((\d+), (\d+), đông\), chạy ([FR ]+)\./);
        return showPose(trace([+x, +y, 'đông'], route, 12, 10).pose);
    }
    case 'iq-turn-wheel-angle': {
        const [diameter, track, angle] = match(q, /D = (\d+) mm, khoảng cách tâm bánh b = (\d+) mm\. Muốn thân robot quay (\d+)°/).map(Number);
        const arcMm = (track / 2) * (angle * Math.PI / 180);
        return numeric(arcMm / (Math.PI * diameter) * 360, '°');
    }
    case 'iq-turn-signed-error': {
        const target = +match(q, /Yêu cầu robot quay (\d+)°/)[0];
        const readings = match(q, /được (.+?)\. Quy ước/)[0].match(/-?\d+/g).map(Number);
        assert.equal(readings.length, 3);
        return numeric(readings.reduce((sum, angle) => sum + angle - target, 0) / 3, '°');
    }
    case 'iq-detect-valid-threshold': {
        const [threshold, raw, unit] = match(q, /T = (\d+) cm và số đọc d = (-?\d+) (cm|mm)/);
        const cm = Number(raw) / (unit === 'mm' ? 10 : 1);
        return cm <= 0 || cm > 255 ? 'Dừng vì dữ liệu cảm biến ngoài miền hợp lệ' : cm < +threshold ? 'Dừng vì phát hiện vật cản' : 'Tiếp tục tiến chậm';
    }
    case 'iq-detect-braking-distance': {
        const [v, tau, a] = match(q, /v = ([\d,]+) m\/s, trễ phản ứng τ = ([\d,]+) s và độ lớn gia tốc hãm a = ([\d,]+) m\/s²/).map(number);
        // During constant deceleration, average speed is v/2 and stop time v/a.
        return numeric(100 * (v * tau + (v / 2) * (v / a)), 'cm');
    }
    case 'iq-mission-success-criteria': {
        const [gx, gy, gh] = match(q, /đạt đủ trạng thái \((\d+), (\d+), (đông|nam|tây|bắc)\)/);
        const route = match(q, /chạy ([FR ]+)\./)[0];
        const [x, y, heading] = trace([0, 0, 'đông'], route, 12, 10).pose;
        if (x === +gx && y === +gy) return heading === gh ? 'Đạt cả vị trí và hướng yêu cầu' : 'Vị trí đã đúng; cần sửa hướng';
        return heading === gh ? 'Cần sửa vị trí; hướng đã đúng' : 'Cần sửa cả vị trí và hướng';
    }
    case 'iq-mission-gps-displacement': {
        const [x1, y1, x2, y2] = match(q, /đầu \((-?\d+), (-?\d+)\), cuối \((-?\d+), (-?\d+)\)/).map(Number);
        return numeric(Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) * 10, 'mm');
    }
    case 'iq-odometry-motor-turns': {
        const [diameter, distance, ratio] = match(q, /D = (\d+) mm; quãng đường s = (\d+) mm\. Tỉ số truyền được định nghĩa là motor quay (\d+) vòng/).map(Number);
        const wheelTurns = distance / (2 * Math.PI * (diameter / 2));
        return numeric(wheelTurns * ratio, 'vòng', 3);
    }
    case 'iq-odometry-calibration-factor': {
        const [target, measurements] = match(q, /yêu cầu (\d+) mm, đo được ([\d, ]+) mm\./);
        const readings = measurements.match(/\d+/g).map(Number);
        assert.equal(readings.length, 3);
        return numeric(+target * readings.length / readings.reduce((a, b) => a + b), '', 3);
    }
    case 'iq-control-shortest-angle': {
        const [target, measured] = match(q, /Mục tiêu (-?\d+)°, góc đo (-?\d+)°/).map(Number);
        const error = shortestSigned(target - measured);
        assert.ok(error >= -180 && error < 180);
        return numeric(error, '°');
    }
    case 'iq-control-p-wheel-commands': {
        const [target, measured, base, kp] = match(q, /Với mục tiêu (-?\d+)°, đo (-?\d+)°, v = (\d+)% và Kp = ([\d,]+) điểm/).map(number);
        const correction = shortestSigned(target - measured) * kp;
        return wheelAnswer(limit(base - correction), limit(base + correction));
    }
    case 'vr-sequence-pose': {
        const [x, y, heading, route] = match(q, /Từ \((\d+), (\d+), (đông|nam|tây|bắc)\), chạy ([FRL ]+)\./);
        return showPose(trace([+x, +y, heading], route, 13, 13).pose);
    }
    case 'vr-sequence-translation-distance': {
        const cell = +match(q, /F tiến (\d+) mm/)[0];
        const [repeats, body] = match(q, /Lặp (\d+) lần nhóm \{([^}]+)\}/);
        const run = trace([0, 0, 'đông'], Array(+repeats).fill(body).join(' '), 60, 20);
        return numeric(run.forwards * cell, 'mm');
    }
    case 'vr-loop-square-distance': {
        const side = +match(q, /F (\d+) ô; R/)[0], laps = +match(q, /lặp (\d+) vòng vuông/)[0], cell = +match(q, /mỗi ô (\d+) mm/)[0];
        const body = `${Array(side).fill('F').join(' ')} R`;
        const run = trace([1, 1, 'đông'], Array(4 * laps).fill(body).join(' '), 20, 20);
        assert.deepEqual(run.pose, [1, 1, 'đông']);
        return numeric(run.forwards * cell, 'mm');
    }
    case 'vr-loop-final-pose': {
        const [x, y, repeats, side, turn] = match(q, /Từ \((\d+), (\d+), đông\), chạy REPEAT (\d+) \{F (\d+) ô; (R|L) 90°/);
        const body = `${Array(+side).fill('F').join(' ')} ${turn}`;
        return showPose(trace([+x, +y, 'đông'], Array(+repeats).fill(body).join(' '), 20, 20).pose);
    }
    case 'vr-avoid-sensor-branch': {
        const threshold = +match(q, /d < (\d+) cm/)[0], step = +match(q, /còn lại tiến (\d+) mm/)[0], d = +match(q, /Với d = (-?\d+) cm/)[0];
        return d <= 0 || d > 255 ? 'Dừng do dữ liệu cảm biến ngoài miền hợp lệ' : d < threshold ? 'Rẽ phải 90° tại chỗ rồi đo lại ở lượt sau' : `Tiến ${step} mm rồi đo lại ở lượt sau`;
    }
    case 'vr-avoid-control-limits': {
        const max = +match(q, /actions < (\d+)/)[0], deadline = +match(q, /đã chạy ≥ (\d+) s/)[0];
        const [actions, elapsed, distance] = match(q, /Hiện actions = (\d+), thời gian (\d+) s, cách đích (\d+) cm/).map(Number);
        return actions >= max ? 'Dừng vì hết số hành động' : elapsed >= deadline ? 'Dừng vì hết thời gian' : distance <= 5 ? 'Dừng vì đã vào vùng đích' : 'Thực hiện tiếp một hành động';
    }
    case 'vr-challenge-route-cost': {
        const [f, t] = match(q, /Mỗi F tốn ([\d,]+) s, mỗi lần rẽ tốn ([\d,]+) s/).map(number);
        const a = aInfo.forwards * f + aInfo.turns * t, b = bInfo.forwards * f + bInfo.turns * t;
        return Math.abs(a - b) < 1e-9 ? 'Hai tuyến có thời gian mô hình bằng nhau' : a < b ? 'Tuyến A có thời gian mô hình thấp hơn' : 'Tuyến B có thời gian mô hình thấp hơn';
    }
    case 'vr-challenge-final-heading': {
        const [f, t] = match(q, /mỗi F tốn ([\d,]+) s; mỗi R hoặc L tốn ([\d,]+) s/).map(number);
        const run = trace([0, 0, 'đông'], `${routeB} L`, 5, 4);
        return numeric(run.forwards * f + run.turns * t, 's');
    }
    case 'vr-search-open-grid': {
        const [x1, y1, x2, y2] = match(q, /Từ \((\d+),(\d+)\) đến \((\d+),(\d+)\)/).map(Number);
        return numeric(Math.abs(x2 - x1) + Math.abs(y2 - y1), 'bước');
    }
    case 'vr-search-wall-gap': {
        const [width, height] = match(q, /Lưới (\d+)×(\d+)/).map(Number);
        const [sy, gx, gy] = match(q, /Đầu \(0,(\d+)\), đích \((\d+),(\d+)\)/).map(Number);
        assert.equal(gx, width - 1);
        const blocked = [...match(q, /các ô bị chặn: \{([^}]+)\}/)[0].matchAll(/\((\d+),(\d+)\)/g)].map(m => [Number(m[1]), Number(m[2])]);
        const wallX = blocked[0][0], ys = new Set(blocked.map(cell => cell[1]));
        assert.ok(wallX > 0 && wallX < width - 1);
        assert.ok(blocked.every(([x, y]) => x === wallX && y >= 0 && y < height));
        assert.equal(ys.size, blocked.length);
        if (ys.size === height) return 'Không có đường hợp lệ';
        assert.equal(ys.size, height - 1);
        const gap = Array.from({ length: height }, (_, y) => y).find(y => !ys.has(y));
        // Every valid path must cross this gap. Horizontal traversal + vertical
        // travel to/from the gap is both a lower bound and an explicit route.
        const path = [];
        for (let y = sy; y !== gap; y += Math.sign(gap - sy)) path.push([0, y]);
        for (let x = 0; x < width; x++) path.push([x, gap]);
        for (let y = gap + Math.sign(gy - gap); gy !== gap && Math.sign(gy - gap) * y <= Math.sign(gy - gap) * gy; y += Math.sign(gy - gap)) path.push([width - 1, y]);
        const blockedKeys = new Set(blocked.map(cell => cell.join(',')));
        assert.ok(path.every(([x, y]) => x >= 0 && x < width && y >= 0 && y < height && !blockedKeys.has(`${x},${y}`)));
        assert.equal(path.length - 1, width - 1 + Math.abs(sy - gap) + Math.abs(gy - gap));
        return `${path.length - 1} bước`;
    }
    case 'vr-experiment-completion-rate': {
        const trials = +match(q, /trên cùng (\d+) sân/)[0], a = +match(q, /A hoàn thành (\d+)\//)[0], b = +match(q, /B hoàn thành (\d+)\//)[0];
        return numeric((b / trials - a / trials) * 100, 'điểm phần trăm');
    }
    case 'vr-experiment-timeout-average': {
        const timeout = +match(q, /mỗi lượt timeout được tính (\d+) s/)[0];
        const [total, count, measurements, failed] = match(q, /Trong (\d+) lượt, thuật toán hoàn thành (\d+) lượt với thời gian \[([\d, ]+)\] s; (\d+) lượt/);
        const times = measurements.match(/\d+/g).map(Number);
        assert.equal(times.length, +count);
        assert.equal(+count + +failed, +total);
        assert.ok(times.every(time => time < timeout));
        return numeric([...times, ...Array(+failed).fill(timeout)].reduce((a, b) => a + b, 0) / +total, 's');
    }
    default: assert.fail(`Missing independent oracle for ${template.id}`);
    }
}

const curriculum = JSON.parse(await readFile(new URL('../ai-server/curriculum.json', import.meta.url), 'utf8'));
assert.equal(roboticsTemplates.length, 24);
assert.equal(new Set(roboticsTemplates.map(t => t.id)).size, 24);
const expectedScopes = curriculum.filter(course => ['vex-iq', 'vex-vr'].includes(course.id))
    .flatMap(course => course.lessons.map(lesson => `${course.id}/${lesson.id}`));
assert.equal(expectedScopes.length, 12);
assert.deepEqual([...new Set(roboticsTemplates.map(t => `${t.courseId}/${t.lessonId}`))].sort(), expectedScopes.sort());
for (const scope of expectedScopes) assert.equal(roboticsTemplates.filter(t => `${t.courseId}/${t.lessonId}` === scope).length, 2);

let checked = 0;
const allStems = new Set();
for (const template of roboticsTemplates) {
    assert.match(template.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(template.skillId && ['basic', 'apply', 'reason'].includes(template.level));
    assert.ok(Number.isSafeInteger(template.variantCount) && template.variantCount >= 100);
    for (const invalid of [-1, template.variantCount, template.variantCount + 1, 0.5, NaN, Infinity, '0', null, undefined]) {
        assert.throws(() => template.render(invalid), RangeError, `${template.id} rejects invalid index ${invalid}`);
    }
    for (let index = 0; index < template.variantCount; index++) {
        const question = template.render(index), context = `${template.id}:${index}`;
        assert.ok(question.q.trim() && question.exp.trim(), context);
        assert.equal(question.opts.length, 4, `${context}: four distinct choices`);
        assert.equal(new Set(question.opts).size, 4, `${context}: unique choices after rounding`);
        assert.ok(Number.isInteger(question.ans) && question.ans >= 0 && question.ans < 4, context);
        assert.ok(!allStems.has(question.q), `${context}: input changes must create a new question, not an option shuffle`);
        allStems.add(question.q);
        const expected = expectedAnswer(template, question);
        assert.equal(question.opts[question.ans], expected, `${context}: independent answer`);
        assert.equal(question.opts.filter(option => option === expected).length, 1, `${context}: one correct answer`);
        if (index % 73 === 0 || index === template.variantCount - 1) assert.deepEqual(template.render(index), question, `${context}: deterministic identity`);
        checked++;
    }
}

// Explicit regression points: strict threshold equality, sensor upper bound,
// wraparound, saturated P commands, blocked columns, and tied route costs.
const rendered = id => {
    const t = roboticsTemplates.find(t => t.id === id);
    return Array.from({ length: t.variantCount }, (_, i) => t.render(i));
};
assert.ok(rendered('iq-control-shortest-angle').some(q => q.q.includes('Mục tiêu 179°, góc đo -179°') && q.opts[q.ans] === '-2 °'));
assert.ok(rendered('iq-control-p-wheel-commands').some(q => q.opts[q.ans].includes('-100%') && q.opts[q.ans].includes('100%')));
assert.ok(rendered('iq-detect-valid-threshold').some(q => q.q.includes('T = 20 cm và số đọc d = 200 mm') && q.opts[q.ans] === 'Tiếp tục tiến chậm'));
assert.ok(rendered('vr-avoid-sensor-branch').some(q => q.q.includes('Với d = 255 cm') && q.opts[q.ans].startsWith('Tiến')));
assert.ok(rendered('vr-avoid-sensor-branch').some(q => q.q.includes('Với d = 256 cm') && q.opts[q.ans].startsWith('Dừng')));
assert.ok(rendered('vr-challenge-route-cost').some(q => q.opts[q.ans] === 'Hai tuyến có thời gian mô hình bằng nhau'));
assert.ok(rendered('vr-search-wall-gap').some(q => q.opts[q.ans] === 'Không có đường hợp lệ'));

console.log(`Generated robotics: ${checked} independent answer checks, 24 templates, all 12 VEX lessons; bounds, determinism and invalid indices passed.`);
