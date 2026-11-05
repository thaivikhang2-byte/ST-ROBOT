import { mixedRadix, numericQuestion, choiceQuestion, formatNumber } from '../helpers.js';

// These finite models are practice exercises, not measurements of a real robot.
// Every input combination has an independently computable answer. An index is a
// stable identity; changing option order never creates another variant.
const range = (from, to, step = 1) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
const product = dimensions => {
    const count = dimensions.reduce((n, values) => n * values.length, 1);
    return Array.from({ length: count }, (_, index) => mixedRadix(index, dimensions));
};
const template = (id, courseId, lessonId, skillId, level, dimensions, render) => ({
    id, courseId, lessonId, skillId, level,
    variantCount: dimensions.reduce((n, values) => n * values.length, 1),
    render(index) { return render(...mixedRadix(index, dimensions)); }
});
const names = ['đông', 'nam', 'tây', 'bắc'];
const vectors = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const poseText = ([x, y, h]) => `(${x}, ${y}, ${names[h]})`;
const commands = (a, turn, b) => `${Array(a).fill('F').join(' ')} ${turn} ${Array(b).fill('F').join(' ')}`;
const wrap = angle => ((angle + 180) % 360 + 360) % 360 - 180;
const clamp = value => Math.max(-100, Math.min(100, value));
const wheelText = (left, right) => `Trái ${formatNumber(left)}%; phải ${formatNumber(right)}%`;

function follow(start, moves, width, height) {
    let [x, y, h] = start;
    for (const command of moves.split(/\s+/).filter(Boolean)) {
        if (command === 'R') h = (h + 1) % 4;
        else if (command === 'L') h = (h + 3) % 4;
        else if (command === 'F') {
            x += vectors[h][0]; y += vectors[h][1];
            if (x < 0 || y < 0 || x >= width || y >= height) throw new RangeError('Template route leaves its declared grid');
        } else throw new TypeError('Unknown grid command');
    }
    return [x, y, h];
}

function poseQuestion(stem, pose, explanation) {
    return choiceQuestion({ stem, correct: poseText(pose), distractors: [
        poseText([pose[0] + 1, pose[1], pose[2]]),
        poseText([pose[0], pose[1] + 1, pose[2]]),
        poseText([pose[0], pose[1], (pose[2] + 1) % 4])
    ], explanation });
}

function shortestSteps(width, height, start, goal, blocked) {
    const obstacles = new Set(blocked.map(([x, y]) => `${x},${y}`));
    const valid = ([x, y]) => x >= 0 && y >= 0 && x < width && y < height && !obstacles.has(`${x},${y}`);
    if (!valid(start) || !valid(goal)) return null;
    const queue = [[...start, 0]], visited = new Set([start.join(',')]);
    for (let head = 0; head < queue.length; head++) {
        const [x, y, distance] = queue[head];
        if (x === goal[0] && y === goal[1]) return distance;
        for (const [dx, dy] of vectors) {
            const next = [x + dx, y + dy], key = next.join(',');
            if (valid(next) && !visited.has(key)) {
                visited.add(key); queue.push([...next, distance + 1]);
            }
        }
    }
    return null;
}

const controlPairs = product([
    [-179, -170, -150, -120, -90, -45, 0, 45, 90, 120, 150, 170, 179],
    [-179, -170, -150, -120, -90, -45, 0, 45, 90, 120, 150, 170, 179]
]).filter(([target, measured]) => wrap(target - measured) !== 0 && wrap(target - measured) !== -180);
const forwardCosts = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];
const turnCosts = [0.1, 0.2, 0.4, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5];
const unequalCosts = product([forwardCosts, turnCosts]).filter(([f, t]) => Math.abs(2 * f - t) > 1e-9);
const wallCases = [];
for (const width of range(5, 9)) for (const height of range(4, 8)) for (const wallX of [1, 2, 3]) {
    for (const startY of [0, height - 1]) for (const goalY of [0, height - 1]) {
        wallCases.push({ width, height, wallX, startY, goalY, gap: null });
        for (const gap of range(0, height - 1)) wallCases.push({ width, height, wallX, startY, goalY, gap });
    }
}
const completionCases = [];
for (const trials of [5, 6, 8, 10, 12, 15, 20]) for (const a of range(1, trials - 1)) for (const b of range(a + 1, trials)) completionCases.push([trials, a, b]);
const timingCases = product([range(2, 5), [5, 8, 10, 12], [1, 2, 3], [20, 30, 45], [2, 3, 4]])
    .filter(([count, first, step, timeout]) => first + (count - 1) * step < timeout);

export const roboticsTemplates = [
    template('iq-drive-distance', 'vex-iq', 'drive', 'linear-motion', 'basic', [range(20, 200, 20), range(1, 12)], (speed, seconds) => {
        const distance = speed * seconds;
        return numericQuestion({ stem: `Mô hình truyền động lý tưởng: hai bánh cùng vận tốc tiếp tuyến ${speed} mm/s, chạy thẳng trong ${seconds} s, không trượt. Quãng đường robot đi là bao nhiêu mm?`, correct: distance,
            distractors: [speed / seconds, distance * 10, distance / 10].filter(value => value !== distance).concat([distance + speed]), unit: 'mm',
            explanation: `s = v × t = ${speed} × ${seconds} = ${distance} mm. Đây là dự đoán của mô hình; cần đo lại để biết quãng đường thực tế.` });
    }),
    template('iq-drive-grid-pose', 'vex-iq', 'drive', 'position-heading', 'apply', [range(0, 3), range(0, 2), range(1, 5), range(1, 4)], (x, y, east, south) => {
        const moves = commands(east, 'R', south), result = follow([x, y, 0], moves, 12, 10);
        return poseQuestion(`Lưới 12×10 có 0 ≤ x < 12, 0 ≤ y < 10; đông tăng x, nam tăng y. Từ ${poseText([x, y, 0])}, chạy ${moves}. F tiến 1 ô; R quay phải 90° tại chỗ. Trạng thái cuối (x, y, hướng) là gì?`, result,
            `Tiến ${east} ô về đông đến (${x + east}, ${y}); rẽ phải hướng nam rồi tiến ${south} ô. Kết quả ${poseText(result)}; lệnh rẽ không đổi vị trí.`);
    }),
    template('iq-turn-wheel-angle', 'vex-iq', 'turn', 'turn-geometry', 'apply', [[40, 48, 56, 60, 64, 70], [112, 120, 140, 152, 168, 180], [30, 45, 60, 90, 120, 180]], (diameter, track, angle) => {
        const degrees = angle * track / diameter;
        return numericQuestion({ stem: `Mô hình quay tại chỗ, hai bánh quay ngược chiều, không trượt: đường kính bánh D = ${diameter} mm, khoảng cách tâm bánh b = ${track} mm. Muốn thân robot quay ${angle}°, mỗi bánh cần quay bao nhiêu độ (lấy độ lớn)?`, correct: degrees,
            distractors: [degrees / 2, degrees * 2, angle * diameter / track], unit: '°',
            explanation: `Mỗi bánh đi cung s = π × b × ${angle}/360. Chia cho chu vi πD rồi nhân 360: góc bánh = ${angle} × ${track}/${diameter} ≈ ${formatNumber(degrees)}°. Cấu hình lab mặc định dùng D = 56 mm, b = 152 mm; ở đây dùng thông số đề cho.` });
    }),
    template('iq-turn-signed-error', 'vex-iq', 'turn', 'measurement-error', 'reason', [[30, 45, 60, 90, 120, 150, 180], [...range(-6, -1), ...range(1, 6)], [1, 3, 5]], (target, offset, spread) => {
        const readings = [target + offset - spread, target + offset, target + offset + spread];
        return numericQuestion({ stem: `Yêu cầu robot quay ${target}°. Ba lượt đo độc lập được ${readings.join('°, ')}°. Quy ước sai số có dấu = góc đo − góc yêu cầu. Sai số trung bình là bao nhiêu độ?`, correct: offset,
            distractors: [offset - spread, offset + spread, offset * 3], unit: '°',
            explanation: `Ba sai số là ${offset - spread}°, ${offset}°, ${offset + spread}°. Trung bình = (${offset * 3})/3 = ${offset}°. Trung bình có dấu không thay thế kiểm tra sai số từng lượt.` });
    }),
    template('iq-detect-valid-threshold', 'vex-iq', 'detect', 'sensor-validation', 'apply', [range(10, 50, 5), ['below2', 'below1', 'equal', 'above1', 'above2', 'negative', 'zero', 'tooFar', 'overflow'], ['cm', 'mm']], (threshold, sample, unit) => {
        const cm = ({ below2: threshold - 2, below1: threshold - 1, equal: threshold, above1: threshold + 1, above2: threshold + 2, negative: -1, zero: 0, tooFar: 256, overflow: 300 })[sample];
        const reading = unit === 'mm' ? cm * 10 : cm;
        const outcomes = ['Dừng vì dữ liệu cảm biến ngoài miền hợp lệ', 'Dừng vì phát hiện vật cản', 'Tiếp tục tiến chậm', 'Tăng tốc để vượt vật cản'];
        const correct = outcomes[!(cm > 0 && cm <= 255) ? 0 : cm < threshold ? 1 : 2];
        return choiceQuestion({ stem: `Quy tắc kiểm tra theo thứ tự: đổi về cm; chỉ chấp nhận 0 < d ≤ 255 cm; dữ liệu ngoài miền thì dừng; dữ liệu hợp lệ thì d < T mới dừng vì vật cản, còn lại tiến chậm. Với T = ${threshold} cm và số đọc d = ${reading} ${unit}, robot làm gì?`, correct, distractors: outcomes.filter(value => value !== correct),
            explanation: `Số đọc tương ứng ${cm} cm. ${cm <= 0 || cm > 255 ? 'Kiểm tra miền hợp lệ thất bại nên dừng trước khi so ngưỡng.' : `${cm} ${cm < threshold ? '<' : '≥'} ${threshold}, nên ${cm < threshold ? 'dừng vì vật cản' : 'tiến chậm'}. Dấu < không bao gồm trường hợp bằng ngưỡng.`}` });
    }),
    template('iq-detect-braking-distance', 'vex-iq', 'detect', 'braking-model', 'reason', [[0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5], [0.05, 0.1, 0.15, 0.2], [0.25, 0.5, 0.75, 1]], (speed, delay, deceleration) => {
        const cm = (speed * delay + speed ** 2 / (2 * deceleration)) * 100;
        return numericQuestion({ stem: `Ước lượng dừng theo mô hình s = vτ + v²/(2a), chưa cộng dự phòng. Cho v = ${formatNumber(speed)} m/s, trễ phản ứng τ = ${formatNumber(delay)} s và độ lớn gia tốc hãm a = ${formatNumber(deceleration)} m/s². Quãng đường dừng dự đoán là bao nhiêu cm?`, correct: cm,
            distractors: [cm * 10, cm / 10, (speed * delay + speed ** 2 / deceleration) * 100], unit: 'cm',
            explanation: `Đổi từ m sang cm sau khi tính: s = (${formatNumber(speed)} × ${formatNumber(delay)} + ${formatNumber(speed)}²/(2 × ${formatNumber(deceleration)})) × 100 ≈ ${formatNumber(cm)} cm. Ngưỡng thực tế còn cần dự phòng và kiểm chứng.` });
    }),
    template('iq-mission-success-criteria', 'vex-iq', 'mission', 'explicit-goal', 'reason', [range(1, 6), range(1, 5), [[0, 0, 1], [0, 0, 0], [1, 0, 1], [0, 1, 1], [1, 1, 0]]], (east, south, [dx, dy, goalHeading]) => {
        const goal = [east + dx, south + dy, goalHeading], moves = commands(east, 'R', south), result = follow([0, 0, 0], moves, 12, 10);
        const positionOK = result[0] === goal[0] && result[1] === goal[1], headingOK = result[2] === goal[2];
        const outcomes = ['Đạt cả vị trí và hướng yêu cầu', 'Cần sửa vị trí; hướng đã đúng', 'Vị trí đã đúng; cần sửa hướng', 'Cần sửa cả vị trí và hướng'];
        const correct = outcomes[positionOK ? (headingOK ? 0 : 2) : (headingOK ? 1 : 3)];
        return choiceQuestion({ stem: `Lưới 12×10, đông tăng x, nam tăng y, F tiến 1 ô, R quay phải 90° tại chỗ. Nhiệm vụ chỉ hoàn thành khi đạt đủ trạng thái ${poseText(goal)}. Robot xuất phát (0, 0, đông), chạy ${moves}. Đánh giá kết quả theo tiêu chí đã chốt?`, correct, distractors: outcomes.filter(value => value !== correct),
            explanation: `Chạy lệnh cho ${poseText(result)}. So riêng tọa độ và hướng với ${poseText(goal)}: ${correct.toLowerCase()}. Đếm ít hành động hơn chỉ có ý nghĩa sau khi đáp ứng nhiệm vụ.` });
    }),
    template('iq-mission-gps-displacement', 'vex-iq', 'mission', 'gps-units', 'apply', [[-20, -10, 0, 10, 20], [-15, 0, 15], [3, 6, 9, 12], [4, 8, 12, 16]], (x, z, dx, dz) => {
        const distanceCm = Math.hypot(dx, dz);
        return numericQuestion({ stem: `Đã đọc đúng hai tọa độ mặt phẳng từ GPS, đơn vị cm: đầu (${x}, ${z}), cuối (${x + dx}, ${z + dz}). Độ lớn độ dời thẳng giữa hai vị trí là bao nhiêu mm? Không yêu cầu tính tổng chiều dài đường đã chạy.`, correct: distanceCm * 10,
            distractors: [distanceCm, distanceCm * 100, (dx + dz) * 10], unit: 'mm',
            explanation: `Δx = ${dx} cm, Δz = ${dz} cm. Độ dời = √(${dx}² + ${dz}²) ≈ ${formatNumber(distanceCm)} cm = ${formatNumber(distanceCm * 10)} mm. GPS của lab dùng cm; độ dời có thể nhỏ hơn chiều dài đường đi.` });
    }),
    template('iq-odometry-motor-turns', 'vex-iq', 'odometry', 'gear-ratio-distance', 'apply', [[40, 48, 56, 60, 64, 70], [100, 150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800], [1, 2, 3, 4]], (diameter, distance, ratio) => {
        const turns = distance * ratio / (Math.PI * diameter);
        return numericQuestion({ stem: `Lăn thẳng không trượt: đường kính bánh D = ${diameter} mm; quãng đường s = ${distance} mm. Tỉ số truyền được định nghĩa là motor quay ${ratio} vòng cho mỗi 1 vòng bánh. Motor cần quay bao nhiêu vòng?`, correct: turns,
            distractors: [distance * ratio / diameter, turns * 360, turns / 360], unit: 'vòng', digits: 3,
            explanation: `Chu vi bánh = πD. Số vòng bánh = s/(πD); số vòng motor = ${ratio} × ${distance}/(π × ${diameter}) ≈ ${formatNumber(turns, 3)} vòng. Tỉ số ở đây là vòng motor/vòng bánh.` });
    }),
    template('iq-odometry-calibration-factor', 'vex-iq', 'odometry', 'calibration-evidence', 'reason', [[200, 300, 400, 500, 600, 700, 800], [-40, -30, -20, -10, 10, 20, 30, 40], [2, 4, 6]], (target, offset, spread) => {
        const mean = target + offset, readings = [mean - spread, mean, mean + spread], factor = target / mean;
        return numericQuestion({ stem: `Ba lượt cùng điều kiện, yêu cầu ${target} mm, đo được ${readings.join(', ')} mm. Thử hiệu chỉnh tuyến tính bằng k = quãng đường yêu cầu / trung bình quãng đường đo, rồi nhân lệnh cũ với k. Giá trị k là bao nhiêu (làm tròn 3 chữ số thập phân)?`, correct: factor,
            distractors: [mean / target, target / (mean - spread), target / (mean + spread)], digits: 3,
            explanation: `Trung bình = ${mean} mm. k = ${target}/${mean} ≈ ${formatNumber(factor, 3)}. Đây là hệ số để thử lại trong cùng điều kiện; một lần tính chưa chứng minh đã hiệu chuẩn thành công.` });
    }),
    template('iq-control-shortest-angle', 'vex-iq', 'control', 'angle-wrapping', 'apply', [controlPairs], ([target, measured]) => {
        const error = wrap(target - measured);
        return numericQuestion({ stem: `Góc tăng ngược chiều kim đồng hồ. Mục tiêu ${target}°, góc đo ${measured}°. Tính sai lệch ngắn nhất e = wrap(mục tiêu − góc đo) về miền [−180°, 180°). e bằng bao nhiêu?`, correct: error,
            distractors: [-error, error + 360, error - 360], unit: '°',
            explanation: `Hiệu ban đầu = ${target - measured}°. Cộng/trừ đủ vòng 360° để về [−180°, 180°) được e = ${error}°. Dấu của sai lệch tuân theo quy ước ngược chiều kim đồng hồ.` });
    }),
    template('iq-control-p-wheel-commands', 'vex-iq', 'control', 'p-control-limits', 'reason', [[-170, -90, -30, 0, 30, 90, 170], [-175, -120, -60, -10, 10, 60, 120, 175], [20, 40, 60], [0.5, 1, 2]], (target, measured, base, kp) => {
        const error = wrap(target - measured), correction = kp * error, left = clamp(base - correction), right = clamp(base + correction);
        return choiceQuestion({ stem: `Điều khiển P: góc tăng ngược chiều kim đồng hồ; e = wrap(mục tiêu − góc đo) về [−180°, 180°); u = Kp·e. Lệnh trái = clamp(v − u), phải = clamp(v + u), clamp giới hạn [−100%, 100%]. Với mục tiêu ${target}°, đo ${measured}°, v = ${base}% và Kp = ${formatNumber(kp)} điểm %/độ, hai lệnh là gì?`, correct: wheelText(left, right),
            distractors: [wheelText(right, left), wheelText(base, base), wheelText(right, right)],
            explanation: `e = ${error}°, u = ${formatNumber(correction)} điểm %. Trước giới hạn: trái ${formatNumber(base - correction)}%, phải ${formatNumber(base + correction)}%. Sau clamp: ${wheelText(left, right)}. Giới hạn lệnh không bảo đảm hệ thống tự ổn định.` });
    }),
    template('vr-sequence-pose', 'vex-vr', 'sequence', 'position-heading', 'apply', [[4, 5, 6], [4, 5, 6], [0, 1, 2, 3], [1, 2, 3], [1, 2, 3], ['R', 'L']], (x, y, heading, first, second, turn) => {
        const moves = commands(first, turn, second), start = [x, y, heading], result = follow(start, moves, 13, 13);
        return poseQuestion(`Lưới 13×13: 0 ≤ x,y < 13; đông tăng x, nam tăng y. F tiến 1 ô; R/L quay phải/trái 90° tại chỗ. Từ ${poseText(start)}, chạy ${moves}. Trạng thái cuối (x, y, hướng) là gì?`, result,
            `Theo dõi từng F theo hướng hiện tại; ${turn} chỉ đổi hướng. Sau ${first} bước, ${turn === 'R' ? 'rẽ phải' : 'rẽ trái'} và ${second} bước, trạng thái cuối là ${poseText(result)}.`);
    }),
    template('vr-sequence-translation-distance', 'vex-vr', 'sequence', 'actions-versus-distance', 'basic', [[1, 2, 3, 4], range(2, 11), [50, 75, 100, 125, 150, 200]], (forwardCount, repeats, cell) => {
        const body = `${Array(forwardCount).fill('F').join(' ')} R F L`, steps = (forwardCount + 1) * repeats, distance = steps * cell;
        return numericQuestion({ stem: `Lưới 60×20, xuất phát (0, 0, đông), đông tăng x, nam tăng y. F tiến ${cell} mm (= 1 ô); R/L quay 90° tại chỗ, không tịnh tiến. Lặp ${repeats} lần nhóm {${body}}. Tổng quãng đường tịnh tiến theo mô hình là bao nhiêu mm?`, correct: distance,
            distractors: [(forwardCount + 3) * repeats * cell, (steps - 1) * cell, (forwardCount + 1) * cell], unit: 'mm',
            explanation: `Mỗi nhóm có ${forwardCount + 1} F và 2 lần rẽ. Số bước tiến = ${repeats} × ${forwardCount + 1} = ${steps}; quãng đường = ${steps} × ${cell} = ${distance} mm. Không cộng lệnh rẽ vào quãng đường tịnh tiến.` });
    }),
    template('vr-loop-square-distance', 'vex-vr', 'loop', 'nested-loop-distance', 'apply', [range(1, 8), range(2, 6), [50, 75, 100, 150]], (side, laps, cell) => {
        const distance = 4 * side * laps * cell;
        return numericQuestion({ stem: `Lưới 20×20, xuất phát (1, 1, đông); đông tăng x, nam tăng y. Một vòng vuông là REPEAT 4 {F ${side} ô; R 90° tại chỗ}. Robot lặp ${laps} vòng vuông; mỗi ô ${cell} mm. Tổng quãng đường tịnh tiến là bao nhiêu mm?`, correct: distance,
            distractors: [(4 * side + 4) * laps * cell, side * laps * cell, 4 * side * cell, distance + cell], unit: 'mm',
            explanation: `Mỗi vòng có 4 cạnh, mỗi cạnh ${side} ô. Tổng = 4 × ${side} × ${laps} × ${cell} = ${distance} mm. Sau mỗi vòng đủ bốn lần rẽ, robot trở về cả vị trí lẫn hướng ban đầu trong mô hình.` });
    }),
    template('vr-loop-final-pose', 'vex-vr', 'loop', 'loop-state-tracing', 'reason', [range(1, 6), range(1, 15), ['R', 'L'], [[8, 8], [9, 8]]], (side, repeats, turn, [x, y]) => {
        const body = `${Array(side).fill('F').join(' ')} ${turn}`, moves = Array(repeats).fill(body).join(' '), result = follow([x, y, 0], moves, 20, 20);
        return poseQuestion(`Lưới 20×20: 0 ≤ x,y < 20; đông tăng x, nam tăng y. Từ (${x}, ${y}, đông), chạy REPEAT ${repeats} {F ${side} ô; ${turn} 90° tại chỗ}. F đi theo hướng hiện tại. Trạng thái cuối là gì?`, result,
            `Mỗi 4 nhóm đưa robot về cả vị trí và hướng đầu. Sau các nhóm còn lại, kết quả là ${poseText(result)}. Lệnh ${turn} ở cuối nhóm cuối vẫn được thực hiện.`);
    }),
    template('vr-avoid-sensor-branch', 'vex-vr', 'avoid', 'sensor-branch', 'apply', [range(10, 50, 5), ['below', 'equal', 'above', 'zero', 'negative', 'overflow', 'max'], [25, 50, 75, 100]], (threshold, sample, step) => {
        const d = ({ below: threshold - 1, equal: threshold, above: threshold + 1, zero: 0, negative: -1, overflow: 256, max: 255 })[sample];
        const outcomes = ['Dừng do dữ liệu cảm biến ngoài miền hợp lệ', 'Rẽ phải 90° tại chỗ rồi đo lại ở lượt sau', `Tiến ${step} mm rồi đo lại ở lượt sau`, 'Báo đã đạt đích ngay'];
        const correct = outcomes[!(d > 0 && d <= 255) ? 0 : d < threshold ? 1 : 2];
        return choiceQuestion({ stem: `Lượt tránh vật cản đã qua kiểm tra thời gian, số hành động và còn cách đích trên 5 cm. Số đọc cảm biến chỉ hợp lệ khi 0 < d ≤ 255 cm; ngoài miền thì dừng. Nếu hợp lệ: d < ${threshold} cm thì rẽ phải 90°, còn lại tiến ${step} mm. Với d = ${d} cm, hành động đúng của lượt này là gì?`, correct, distractors: outcomes.filter(value => value !== correct),
            explanation: `d = ${d} cm. ${!(d > 0 && d <= 255) ? 'Dữ liệu ngoài miền hợp lệ nên dừng.' : `Dữ liệu hợp lệ; ${d} ${d < threshold ? '<' : '≥'} ${threshold}, nên ${d < threshold ? 'rẽ phải' : `tiến ${step} mm`}. Cần đo lại ở lượt sau; một lần rẽ chưa bảo đảm tới đích.`}` });
    }),
    template('vr-avoid-control-limits', 'vex-vr', 'avoid', 'bounded-control', 'reason', [[20, 30, 40, 50], ['oneLeft', 'exhausted'], [10, 20, 30], [-1, 0, 1], [4, 5, 6]], (maximum, actionState, limit, delta, goalDistance) => {
        const actions = actionState === 'exhausted' ? maximum : maximum - 1, elapsed = limit + delta;
        const outcomes = ['Dừng vì hết số hành động', 'Dừng vì hết thời gian', 'Dừng vì đã vào vùng đích', 'Thực hiện tiếp một hành động'];
        const correct = outcomes[actions >= maximum ? 0 : elapsed >= limit ? 1 : goalDistance <= 5 ? 2 : 3];
        return choiceQuestion({ stem: `Bộ điều khiển kiểm tra đúng thứ tự: (1) chỉ vào vòng lặp khi actions < ${maximum}; (2) dừng nếu thời gian đã chạy ≥ ${limit} s; (3) dừng đạt đích nếu khoảng cách GPS ≤ 5 cm; (4) mới đọc cảm biến và hành động. Hiện actions = ${actions}, thời gian ${elapsed} s, cách đích ${goalDistance} cm. Kết quả lượt kiểm tra là gì?`, correct, distractors: outcomes.filter(value => value !== correct),
            explanation: `Kiểm tra từ trên xuống: ${actions} ${actions >= maximum ? '≥' : '<'} ${maximum}. ${actions >= maximum ? 'Vòng lặp kết thúc do giới hạn hành động, các kiểm tra bên trong không chạy.' : elapsed >= limit ? `${elapsed} ≥ ${limit} s nên dừng do thời gian, trước khi kiểm tra đích.` : goalDistance <= 5 ? `${elapsed} < ${limit} s và ${goalDistance} ≤ 5 cm nên ghi nhận vào vùng đích.` : `${elapsed} < ${limit} s và ${goalDistance} > 5 cm nên chuyển sang hành động.`}` });
    }),
    template('vr-challenge-route-cost', 'vex-vr', 'challenge', 'fair-route-comparison', 'reason', [forwardCosts, turnCosts], (forward, turn) => {
        const a = 5 * forward + 3 * turn, b = 7 * forward + 2 * turn;
        const outcomes = ['Tuyến A có thời gian mô hình thấp hơn', 'Tuyến B có thời gian mô hình thấp hơn', 'Hai tuyến có thời gian mô hình bằng nhau', 'Cần cùng số bước tiến mới so sánh được'];
        const correct = outcomes[Math.abs(a - b) < 1e-9 ? 2 : a < b ? 0 : 1];
        follow([0, 0, 0], 'F R F L F F R F', 5, 4); follow([0, 0, 0], 'F F F F R F F R F', 5, 4);
        return choiceQuestion({ stem: `Lưới 5×4, đông tăng x, nam tăng y; từ (0,0,đông) tới (3,2), hướng cuối tùy ý. F tiến 1 ô; R/L quay 90° tại chỗ. A: F R F L F F R F (5 F, 3 rẽ); B: F F F F R F F R F (7 F, 2 rẽ). Mỗi F tốn ${formatNumber(forward)} s, mỗi lần rẽ tốn ${formatNumber(turn)} s, không có chi phí khác. Chọn nhận xét đúng.`, correct, distractors: outcomes.filter(value => value !== correct),
            explanation: `Cả hai tuyến nằm trong lưới và tới cùng đích. TA = 5 × ${formatNumber(forward)} + 3 × ${formatNumber(turn)} = ${formatNumber(a)} s; TB = 7 × ${formatNumber(forward)} + 2 × ${formatNumber(turn)} = ${formatNumber(b)} s. ${correct}. Đây là chi phí khai báo của mô hình, không phải thời gian đo robot.` });
    }),
    template('vr-challenge-final-heading', 'vex-vr', 'challenge', 'goal-heading-cost', 'apply', [unequalCosts], ([forward, turn]) => {
        const cost = 7 * forward + 3 * turn;
        return numericQuestion({ stem: `Lưới 5×4, đông tăng x, nam tăng y. Từ (0,0,đông), tuyến B = F F F F R F F R F tới (3,2,tây). Nhiệm vụ yêu cầu (3,2,nam), nên thêm đúng một L 90° tại chỗ. F tiến 1 ô, mỗi F tốn ${formatNumber(forward)} s; mỗi R hoặc L tốn ${formatNumber(turn)} s. Tổng thời gian mô hình của B sau khi thêm L là bao nhiêu giây?`, correct: cost,
            distractors: [7 * forward + 2 * turn, 5 * forward + 3 * turn, 7 * forward + 4 * turn], unit: 's',
            explanation: `B có 7 F, 2 R; L cuối đổi hướng tây sang nam, giữ tọa độ (3,2). Tổng 7 bước tiến và 3 lần rẽ: T = 7 × ${formatNumber(forward)} + 3 × ${formatNumber(turn)} = ${formatNumber(cost)} s.` });
    }),
    template('vr-search-open-grid', 'vex-vr', 'search', 'shortest-grid-path', 'basic', [range(5, 8), range(5, 8), [0, 1], [0, 1], [1, 2], [1, 2]], (width, height, sx, sy, xInset, yInset) => {
        const gx = width - xInset, gy = height - yInset, dx = gx - sx, dy = gy - sy, distance = shortestSteps(width, height, [sx, sy], [gx, gy], []);
        return numericQuestion({ stem: `Lưới ${width}×${height}, 0 ≤ x < ${width}, 0 ≤ y < ${height}, không vật cản. Từ (${sx},${sy}) đến (${gx},${gy}), mỗi bước chỉ đi sang một ô kề cạnh theo bắc/nam/đông/tây, chi phí 1; không đi chéo, không tính hướng hay thời gian rẽ. BFS trả về số bước ngắn nhất là bao nhiêu?`, correct: distance,
            distractors: [distance - 1, distance + 1, dx * dx + dy * dy], unit: 'bước',
            explanation: `Cần đổi x ${dx} ô và y ${dy} ô. Cận dưới Manhattan = |${gx}−${sx}| + |${gy}−${sy}| = ${distance}; lưới trống đạt được cận này. Nhiều tuyến có thể cùng số bước; câu hỏi chỉ yêu cầu độ dài.` });
    }),
    template('vr-search-wall-gap', 'vex-vr', 'search', 'bfs-obstacles', 'reason', [wallCases], ({ width, height, wallX, startY, goalY, gap }) => {
        const blocked = range(0, height - 1).filter(y => y !== gap).map(y => [wallX, y]);
        const distance = shortestSteps(width, height, [0, startY], [width - 1, goalY], blocked), none = 'Không có đường hợp lệ';
        const base = width - 1 + Math.abs(goalY - startY), correct = distance === null ? none : `${distance} bước`;
        return choiceQuestion({ stem: `Lưới ${width}×${height}: 0 ≤ x < ${width}, 0 ≤ y < ${height}. Đầu (0,${startY}), đích (${width - 1},${goalY}); các ô bị chặn: {${blocked.map(([x, y]) => `(${x},${y})`).join(', ')}}. Mỗi bước sang 1 ô kề cạnh, không đi chéo, không ra ngoài lưới. BFS đầy đủ trả về kết quả nào (chỉ đếm bước, không tính rẽ)?`, correct,
            distractors: distance === null ? [`${base} bước`, `${base + 2} bước`, `${base + 4} bước`] : [none, `${distance - 1} bước`, `${distance + 1} bước`],
            explanation: distance === null ? `Toàn bộ cột x = ${wallX} bị chặn. Đầu và đích nằm hai phía; giới hạn lưới cấm đi vòng bên ngoài, nên không có đường hợp lệ.` : `Chỉ ô (${wallX},${gap}) cho đi qua cột chắn. Cần ít nhất ${width - 1} bước ngang và |${startY}−${gap}| + |${goalY}−${gap}| bước dọc, tổng ${distance}. Có đường đạt đúng cận này, trùng kết quả BFS.` });
    }),
    template('vr-experiment-completion-rate', 'vex-vr', 'experiment', 'completion-statistics', 'apply', [completionCases], ([trials, a, b]) => {
        const difference = 100 * (b - a) / trials;
        return numericQuestion({ stem: `So sánh trên cùng ${trials} sân, mỗi thuật toán chạy đúng 1 lượt/sân với cùng giới hạn. A hoàn thành ${a}/${trials} sân; B hoàn thành ${b}/${trials} sân. Tỉ lệ hoàn thành của B cao hơn A bao nhiêu điểm phần trăm?`, correct: difference,
            distractors: [-difference, b - a, 100 * (b - a) / (trials - 1)], unit: 'điểm phần trăm',
            explanation: `Tỉ lệ A = ${formatNumber(100 * a / trials)}%; B = ${formatNumber(100 * b / trials)}%. Chênh lệch B−A = (${b}−${a})/${trials} × 100 ≈ ${formatNumber(difference)} điểm phần trăm. Kết quả chỉ mô tả các sân đã thử, chưa đủ suy rộng mọi sân.` });
    }),
    template('vr-experiment-timeout-average', 'vex-vr', 'experiment', 'timeout-statistics', 'reason', [timingCases], ([count, first, step, timeout, failed]) => {
        const times = range(0, count - 1).map(i => first + i * step), sum = times.reduce((a, b) => a + b, 0), total = count + failed;
        const mean = (sum + failed * timeout) / total;
        return numericQuestion({ stem: `Chốt trước quy tắc: mỗi lượt timeout được tính ${timeout} s vào trung bình toàn bộ lượt. Trong ${total} lượt, thuật toán hoàn thành ${count} lượt với thời gian [${times.join(', ')}] s; ${failed} lượt còn lại đều timeout. Thời gian trung bình theo quy tắc này là bao nhiêu giây?`, correct: mean,
            distractors: [sum / count, sum / total, timeout], unit: 's',
            explanation: `Tổng thời gian tính vào báo cáo = ${sum} + ${failed} × ${timeout} = ${sum + failed * timeout} s. Chia cho đủ ${total} lượt: ${formatNumber(mean)} s. Nếu báo riêng trung bình lượt thành công (${formatNumber(sum / count)} s), phải kèm tỉ lệ hoàn thành ${count}/${total}.` });
    })
];
