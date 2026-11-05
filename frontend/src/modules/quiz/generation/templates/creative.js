import { mixedRadix, numericQuestion, choiceQuestion, formatNumber } from '../helpers.js';

const range = (start, end, step = 1) => Array.from({ length: Math.floor((end - start) / step) + 1 }, (_, i) => start + i * step);
const coordinates = range(0, 24);
const point = number => [number % 5, Math.floor(number / 5)];
const label = value => value === 5 ? 'A' : value === 2 ? 'B' : 'CHECK';
const f = formatNumber;

function template(id, courseId, lessonId, skillId, level, dimensions, build) {
    return {
        id, courseId, lessonId, skillId, level,
        variantCount: dimensions.reduce((total, values) => total * values.length, 1),
        render(index) {
            // mixedRadix rejects fractional, negative and out-of-domain indices.
            return build(...mixedRadix(index, dimensions));
        },
    };
}

function numeric(stem, correct, distractors, explanation, unit = '', digits = 2) {
    // Extra offsets keep boundary cases such as zero/reset well-formed.
    return numericQuestion({ stem, correct, distractors: [...distractors, correct + 1, correct + 2, correct + 3], explanation, unit, digits });
}

function choice(stem, correct, distractors, explanation) {
    return choiceQuestion({ stem, correct, distractors, explanation });
}

export const creativeTemplates = [
    template('mb-matrix-pixel', 'microbit', 'matrix', 'matrix-coordinates', 'basic',
        [coordinates, range(1, 9)], (cell, brightness) => {
            const [x, y] = point(cell);
            const description = (column, row, light) => `Cột ${column}, hàng ${row}, độ sáng ${light}`;
            return choice(
                `Trong MicroPython trên micro:bit, x tăng sang phải, y tăng xuống dưới; tọa độ bắt đầu từ 0, còn cột/hàng được gọi từ 1. Sau display.clear() rồi display.set_pixel(${x}, ${y}, ${brightness}), LED nào được bật?`,
                description(x + 1, y + 1, brightness),
                [description((x + 1) % 5 + 1, y + 1, brightness), description(x + 1, (y + 1) % 5 + 1, brightness), 'Không LED nào sáng'],
                `Tọa độ (${x}, ${y}) ứng với cột ${x + 1}, hàng ${y + 1}. set_pixel dùng độ sáng 0..9; ${brightness} lớn hơn 0 nên điểm này sáng.`);
        }),

    template('mb-matrix-update', 'microbit', 'matrix', 'matrix-state-updates', 'apply',
        [coordinates, range(1, 24), [3, 6, 9]], (first, offset, brightness) => {
            const [x, y] = point(first);
            const [u, v] = point((first + offset) % 25);
            return choice(
                `Chạy lần lượt bằng MicroPython: display.clear(); display.set_pixel(${x}, ${y}, 9); display.set_pixel(${u}, ${v}, ${brightness}); display.set_pixel(${x}, ${y}, 0). Không có lệnh khác. Cuối cùng ma trận hiển thị gì?`,
                `Chỉ điểm (${u}, ${v}) sáng ở mức ${brightness}`,
                [`Chỉ điểm (${x}, ${y}) sáng ở mức 9`, `Cả hai điểm (${x}, ${y}) và (${u}, ${v}) cùng sáng`, 'Toàn bộ 25 LED tắt'],
                `Hai tọa độ khác nhau. Bật điểm thứ hai giữ nguyên điểm thứ nhất; lệnh cuối đặt độ sáng điểm (${x}, ${y}) về 0, chỉ tắt điểm đó.`);
        }),

    template('mb-buttons-edges', 'microbit', 'buttons', 'button-edge-events', 'basic',
        [range(2, 20), range(2, 20)], (presses, polls) => numeric(
            `Giả sử button_a.was_pressed() ghi nhận đúng một lần cho mỗi lần nhấn A mới. Người dùng nhấn–giữ–thả A ${presses} lần riêng biệt. Mỗi lần giữ kéo dài ${polls} lượt kiểm tra, và không có lần nhấn nào bị bỏ lỡ. Với if button_a.was_pressed(): display.show(Image.HEART), display.show được gọi bao nhiêu lần?`,
            presses, [presses * polls, presses + polls, polls],
            `Có ${presses} lần nhấn mới nên có ${presses} lần xử lý. Việc giữ qua ${polls} lượt kiểm tra không tự tạo thêm cạnh nhấn.`, 'lần', 0)),

    template('mb-buttons-poll-order', 'microbit', 'buttons', 'button-handler-order', 'apply',
        [range(0, 5), range(1, 5), range(0, 5)], (before, both, after) => {
            const pair = (heart, clear) => `${heart} lần hiển thị trái tim; ${clear} lần xóa`;
            const shows = before + both + after;
            return choice(
                `Mỗi lượt kiểm tra chạy hai if độc lập theo thứ tự bằng MicroPython:\nif button_a.was_pressed():\n    display.show(Image.HEART)\nif button_b.was_pressed():\n    display.clear()\nCó ${before} lượt chỉ A, rồi ${both} lượt cả A và B đều trả True, rồi ${after} lượt chỉ A. Chỉ đếm lệnh trong các lượt này. Tổng số lần gọi mỗi lệnh là bao nhiêu?`,
                pair(shows, both), [pair(before + after, both), pair(shows, 0), pair(shows + 1, both)],
                `Hai if độc lập nên lượt có cả hai nút vẫn gọi cả show và clear; B chạy sau nên xóa ở cuối lượt đó. Số show = ${before} + ${both} + ${after} = ${shows}; số clear = ${both}.`);
        }),

    template('mb-light-threshold', 'microbit', 'light', 'relative-light-boundary', 'basic',
        [range(20, 230, 10), [-2, -1, 0, 1, 2]], (threshold, delta) => {
            const level = threshold + delta;
            const dark = level < threshold;
            const correct = dark ? 'Hiển thị trái tim' : 'Xóa màn hình';
            return choice(
                `Sau khi phép đo đầu đã được khởi tạo, cảm biến micro:bit trả mức sáng tương đối level = ${level} trên thang 0..255. Chạy đoạn MicroPython:\nif level < ${threshold}:\n    display.show(Image.HEART)\nelse:\n    display.clear()\nChương trình làm gì ở lượt này?`,
                correct, [dark ? 'Xóa màn hình' : 'Hiển thị trái tim', 'Dừng vì level ngoài khoảng 0..255'],
                `${level} ${dark ? '<' : '≥'} ${threshold}, nên chạy nhánh ${dark ? 'if và hiển thị trái tim' : 'else và xóa màn hình'}. Đây là mức sáng tương đối, không phải số đo lux.`);
        }),

    template('mb-light-sample-series', 'microbit', 'light', 'light-threshold-series', 'apply',
        [range(40, 200, 20), range(0, 63)], (threshold, mask) => {
            const levels = range(0, 5).map(i => mask & (1 << i) ? threshold - i - 1 : threshold + i % 2);
            const count = levels.filter(level => level < threshold).length;
            return numeric(
                `Sáu lượt đọc mức sáng tương đối đã sẵn sàng cho dãy [${levels.join(', ')}]. Mỗi lượt đọc đúng một lần, nếu level < ${threshold} thì gọi display.show(Image.HEART), ngược lại gọi display.clear(). Lệnh hiển thị trái tim được gọi tổng cộng bao nhiêu lần?`,
                count, [(count + 1) % 7, (count + 2) % 7, (count + 3) % 7],
                `Chỉ các mẫu nhỏ hơn ${threshold} đi vào nhánh hiển thị. Có ${count} mẫu thỏa; mẫu bằng ngưỡng thuộc nhánh xóa.`, 'lần', 0);
        }),

    template('mb-counter-batch', 'microbit', 'counter', 'count-consumed-presses', 'basic',
        [range(0, 49), range(1, 20)], (initial, presses) => numeric(
            `Bộ đếm đang có count = ${initial}. Trong một lượt, presses = button_a.get_presses() trả ${presses}, button_b.was_pressed() trả False. Chương trình chạy count += presses khi presses khác 0. Sau lượt này count bằng bao nhiêu?`,
            initial + presses, [initial, initial + 1, presses, initial + presses - 1],
            `get_presses trả số lần nhấn đã ghi nhận kể từ lần đọc trước; cộng toàn bộ ${presses}, không chỉ cộng 1. count = ${initial} + ${presses} = ${initial + presses}.`, '', 0)),

    template('mb-counter-reset-priority', 'microbit', 'counter', 'count-reset-priority', 'apply',
        [range(0, 9), range(0, 9), range(0, 9)], (initial, discarded, after) => numeric(
            `count ban đầu là ${initial}. Mỗi lượt chạy đoạn MicroPython:\nif reset:\n    count = 0\nelif presses:\n    count += presses\nLượt 1 get_presses() trả ${discarded} và reset = True; lượt 2 trả ${after} và reset = False. Không còn đầu vào khác. count cuối cùng bằng bao nhiêu?`,
            after, [initial + discarded + after, discarded + after, 0, after + 1],
            `Lượt 1 ưu tiên reset nên count thành 0; ${discarded} lần A đã được đọc trong lượt này không được cộng bù về sau. Lượt 2 cộng ${after}, kết quả ${after}.`, '', 0)),

    template('mb-radio-value-validation', 'microbit', 'radio', 'radio-field-range', 'basic',
        [range(-30, 70), ['temp', 'humidity']], (value, field) => {
            const valid = field === 'temp' && value >= -20 && value <= 60;
            const correct = valid ? value : 17;
            return numeric(
                `Hai micro:bit dùng cùng nhóm 7 và giao thức văn bản MicroPython name:value. Bộ nhận chỉ cập nhật nếu name == "temp" và -20 <= value <= 60; gói sai giữ nguyên dữ liệu. last_valid đang là 17, vừa nhận "${field}:${value}". Sau khi xử lý last_valid bằng bao nhiêu?`,
                correct, [value, 17, 0, value + 1, 18, 99],
                valid ? `Tên trường là temp và ${value} thuộc miền đóng [-20, 60], nên nhận giá trị ${value}.` : `Gói không thỏa ${field !== 'temp' ? 'điều kiện tên trường temp' : 'miền giá trị [-20, 60]'}. Bộ nhận giữ last_valid = 17; không thay dữ liệu lỗi bằng 0.`, '', 0);
        }),

    template('mb-radio-last-valid', 'microbit', 'radio', 'radio-ignore-invalid', 'apply',
        [range(-20, 60), range(0, 9), range(0, 2)], (valid, offset, kind) => {
            const invalid = kind === 0 ? `temp:${61 + offset}` : kind === 1 ? `humidity:${offset}` : `temp:${offset}:bad`;
            const reason = kind === 0 ? 'giá trị lớn hơn 60' : kind === 1 ? 'tên trường không phải temp' : 'phần số không chuyển được bằng float';
            return numeric(
                `Bộ nhận MicroPython nhóm 7 xử lý name, raw = message.split(":", 1), value = float(raw); chỉ lưu tên temp với -20 <= value <= 60, còn ValueError bị bỏ qua. last_valid khởi tạo 10. Nhận tuần tự "temp:${valid}" rồi "${invalid}". Sau cả hai gói last_valid là bao nhiêu?`,
                valid, [10, 0, 61 + offset, valid + 1],
                `Gói đầu hợp lệ nên lưu ${valid}. Gói sau bị bỏ qua vì ${reason}; dữ liệu hợp lệ gần nhất vẫn là ${valid}.`, '', 0);
        }),

    template('mb-project-restart-case', 'microbit', 'project', 'counter-restart-test', 'basic',
        [range(1, 5), range(0, 5), range(1, 3), range(0, 9)], (beforeBoot, beforeReset, resets, after) => numeric(
            `Kiểm thử yêu cầu: khởi động count = 0, mỗi A tăng 1, B đặt 0, không lưu qua khởi động lại. Bấm A ${beforeBoot} lần, khởi động lại bo, bấm A ${beforeReset} lần, bấm B ${resets} lần rồi bấm A ${after} lần. Các thao tác tuần tự và đều được nhận. Kết quả kỳ vọng cuối ca là bao nhiêu?`,
            after, [beforeBoot + beforeReset + after, beforeReset + after, after + 1, 0],
            `Khởi động lại xóa phần ${beforeBoot} lần A đầu. Lần B đầu xóa phần ${beforeReset} lần A kế tiếp; bấm B thêm vẫn giữ 0. Sau đó ${after} lần A cho count = ${after}.`, '', 0)),

    template('mb-project-regression-case', 'microbit', 'project', 'counter-bug-regression', 'apply',
        [range(1, 9), range(2, 20)], (first, last) => {
            const pair = (expected, observed) => `Kỳ vọng ${expected}; chương trình lỗi cho ${observed}`;
            return choice(
                `Yêu cầu A tăng bộ đếm, B đặt 0. Một bản lỗi đặt count = 0 rồi count += 1 bên trong mỗi lần xử lý A. Ca thử tuần tự từ khởi động: A ${first} lần, B một lần, A ${last} lần. Sau mọi đầu vào đã được nhận, ghi cặp kỳ vọng theo yêu cầu và kết quả của bản lỗi nào?`,
                pair(last, 1), [pair(1, last), pair(first + last, 1), pair(last, last)],
                `Theo yêu cầu, B xóa lịch sử và ${last} lần A sau B phải cho ${last}. Trong bản lỗi, mỗi A lại xóa count trước khi cộng nên lần A cuối vẫn chỉ cho 1. Đây là ca tái hiện để chạy lại sau khi sửa.`);
        }),

    template('spike-mechanism-output-angle', 'lego-spike', 'mechanism', 'gear-output-angle', 'basic',
        [[ [12, 24], [12, 36], [20, 40], [24, 8] ], range(15, 180, 15), [-1, 1]], ([inputTeeth, outputTeeth], magnitude, direction) => {
            const input = magnitude * direction;
            const output = -input * inputTeeth / outputTeeth;
            return numeric(
                `Mô hình một cặp bánh răng ngoài lý tưởng có bánh vào ${inputTeeth} răng, bánh ra ${outputTeeth} răng; tay gạt gắn trực tiếp trục ra, không trượt. Quy ước cùng chiều dương cho hai trục. Trục vào quay ${input}°. Góc có dấu của tay gạt là bao nhiêu?`,
                output, [-output, input, output + 10, output - 10],
                `Hai bánh răng ngoài quay ngược chiều: góc ra = -(${input}) × ${inputTeeth}/${outputTeeth} = ${f(output)}°. Đây là dự đoán mô hình, chưa phải góc đo dưới tải.`, '°');
        }),

    template('spike-mechanism-required-angle', 'lego-spike', 'mechanism', 'gear-target-inversion', 'apply',
        [[ [12, 24], [12, 36], [20, 40], [24, 8] ], range(1, 30), [-1, 1]], ([inputTeeth, outputTeeth], magnitude, direction) => {
            const target = magnitude * direction;
            const input = -target * outputTeeth / inputTeeth;
            return numeric(
                `Một cặp bánh răng ngoài lý tưởng ${inputTeeth}:${outputTeeth} (số răng vào:ra), tay gạt gắn trục ra. Góc tính từ mốc đã xác lập, hai trục dùng cùng chiều dương. Muốn tay gạt dịch ${target}° thì trục motor cần dịch bao nhiêu độ? Chỉ tính mô hình truyền động.`,
                input, [-input, target, -target * inputTeeth / outputTeeth, input + 10],
                `Từ góc ra = -góc vào × ${inputTeeth}/${outputTeeth}, suy ra góc vào = -(${target}) × ${outputTeeth}/${inputTeeth} = ${f(input)}°. Khi chạy cơ cấu thật vẫn cần giới hạn và timeout.`, '°');
        }),

    template('spike-colors-group-presence', 'lego-spike', 'colors', 'color-presence-separation', 'basic',
        [range(1, 7), [-1, 0, 0.5, 1, 2, 3, 3.5, 5, 7, 8, 10]], (raw, distance) => {
            const group = label(raw);
            const near = distance > 0 && distance <= 3;
            const result = (g, n) => `group = "${g}"; near = ${n ? 'True' : 'False'}`;
            const alternatives = ['A', 'B', 'CHECK'].flatMap(g => [result(g, true), result(g, false)]);
            return choice(
                `Trong bài mô phỏng GearsBot Cage Bot, dùng ID màu EV3: raw == 5 → group = "A", raw == 2 → "B", còn lại → "CHECK". Tính riêng near = 0 < distance <= 3. Với raw = ${raw}, distance = ${f(distance)} cm do đề cung cấp, cặp biến nào đúng?`,
                result(group, near), alternatives,
                `ID ${raw} được ánh xạ thành ${group}; biểu thức 0 < ${f(distance)} <= 3 cho ${near ? 'True' : 'False'}. Nhãn màu không tự chứng minh có vật; near là phép kiểm tra riêng theo khoảng cách đã cho.`);
        }),

    template('spike-colors-stable-samples', 'lego-spike', 'colors', 'stable-color-classifier', 'apply',
        [[0, 2, 5, 7], [0, 2, 5, 7], [0, 2, 5, 7]], (a, b, c) => {
            const stable = a === b && b === c;
            const group = stable ? label(a) : 'CHECK';
            return choice(
                `Bộ phân loại trong mô phỏng lấy đúng 3 ID màu do đề cung cấp: [${a}, ${b}, ${c}]. Quy tắc: chỉ khi cả 3 bằng nhau mới xét ID 5 → A, ID 2 → B; mọi trường hợp khác trả CHECK. Hàm trả nhóm nào?`,
                group, ['A', 'B', 'CHECK'],
                stable ? `Ba mẫu đều bằng ${a}; ${a === 5 || a === 2 ? `ID này thuộc nhóm ${group}` : 'ID này không thuộc hai màu quy định nên trả CHECK'}.` : 'Ba mẫu không hoàn toàn bằng nhau, vì vậy hàm trả CHECK; không tự lấy đa số hoặc ép nhãn chưa rõ thành đỏ.');
        }),

    template('spike-sort-one-cycle-per-object', 'lego-spike', 'sort', 'object-event-latch', 'basic',
        [range(2, 20), range(2, 10)], (objects, samples) => numeric(
            `Trong một ca mô phỏng có ${objects} vật đỏ đi qua lần lượt. Mỗi vật đứng ở vùng near đúng ${samples} lượt đọc. handled ban đầu False; lượt đầu có vật đặt handled = True trước khi gạt; các lượt còn vật không gạt thêm. Giữa hai vật luôn có đủ 3 mẫu trống liên tiếp để đặt lại handled = False. Mọi chu kỳ gạt đều hoàn tất. Tổng số chu kỳ gạt là bao nhiêu?`,
            objects, [objects * samples, samples, objects + samples, objects - 1],
            `Chốt handled biến nhiều mẫu của một vật thành một sự kiện xử lý. Mỗi vật gạt đúng một lần; vùng trống đủ ổn định giữa các vật để cho phép vật tiếp theo. Tổng ${objects} chu kỳ.`, 'chu kỳ', 0)),

    template('spike-sort-clear-debounce', 'lego-spike', 'sort', 'clear-consecutive-samples', 'apply',
        [range(0, 63)], mask => {
            const distances = range(0, 5).map(i => mask & (1 << i) ? 8 : 5);
            let clear = 0;
            let rearmed = false;
            for (const distance of distances) {
                clear = distance >= 8 ? clear + 1 : 0;
                if (clear >= 3) rearmed = true;
            }
            return numeric(
                `Ban đầu handled = True, clear_samples = 0. Sau mỗi mẫu: distance >= 8 thì clear_samples += 1, ngược lại clear_samples = 0; khi clear_samples >= 3 đặt handled = False. Sáu khoảng cách tiếp theo là [${distances.join(', ')}] cm; 5 cm không thuộc vùng near. Sau đó xuất hiện một mẫu 2 cm. Có bao nhiêu sự kiện vật mới được nhận ở mẫu 2 cm, nếu chỉ nhận khi distance <= 3 và not handled rồi chốt handled = True?`,
                rearmed ? 1 : 0, [rearmed ? 0 : 1, 2, 3],
                rearmed ? 'Trong sáu mẫu có ít nhất một đoạn 3 mẫu liên tiếp >= 8 cm nên chốt đã được mở lại. Các mẫu 5 cm không tạo vật mới; mẫu 2 cm tạo đúng một sự kiện.' : 'Không có đoạn 3 mẫu liên tiếp >= 8 cm. Mẫu 5 cm đặt bộ đếm trống về 0, chốt vẫn True nên mẫu 2 cm không tạo sự kiện mới.', 'sự kiện', 0);
        }),

    template('spike-project-complete-denominator', 'lego-spike', 'project', 'trial-success-denominator', 'basic',
        [range(10, 50, 5), range(1, 9)], (attempted, failed) => {
            const passed = attempted - failed;
            const percent = 100 * passed / attempted;
            return numeric(
                `Nhật ký một bộ thử trạm phân loại đã thực hiện đủ ${attempted} lượt, trong đó ${failed} lượt sai đích hoặc timeout và ${passed} lượt đến đúng đích theo tiêu chí đã đặt. Tỷ lệ đúng toàn quy trình trên bộ thử này là bao nhiêu phần trăm? Giữ mọi lượt lỗi trong mẫu số; làm tròn tối đa 2 chữ số thập phân.`,
                percent, [100, 100 * failed / attempted, passed, percent + 5],
                `Tỷ lệ đúng = ${passed}/${attempted} × 100% = ${f(percent)}%. Các lượt timeout/sai vẫn nằm trong ${attempted} lượt đã thử. Kết quả mô tả bộ thử này; không tự suy ra độ đúng ở mọi điều kiện.`, '%');
        }),

    template('spike-project-improvement', 'lego-spike', 'project', 'percentage-point-improvement', 'apply',
        [range(10, 50, 5), range(3, 9), [1, 2]], (attempted, errors, fixed) => {
            const before = attempted - errors;
            const after = before + fixed;
            const improvement = 100 * fixed / attempted;
            return numeric(
                `Hai lần thử đều thực hiện đủ ${attempted} lượt với cùng bộ vật và điều kiện đã ghi. Trước thay đổi có ${before} lượt đúng, sau thay đổi có ${after} lượt đúng. Mọi lượt lỗi vẫn được tính. Tỷ lệ đúng tăng bao nhiêu điểm phần trăm? Làm tròn tối đa 2 chữ số thập phân.`,
                improvement, [100 * fixed / before, 100 * after / attempted, fixed, improvement + 1],
                `Chênh lệch tỷ lệ = (${after}/${attempted} - ${before}/${attempted}) × 100 = ${f(improvement)} điểm phần trăm. Đây là chênh lệch trên hai bộ thử đã nêu, không phải cam kết chắc chắn cho các lần sau.`, 'điểm phần trăm');
        }),

    template('spike-ratio-signed-speed', 'lego-spike', 'ratio', 'gear-signed-speed', 'basic',
        [[8, 12, 16, 20, 24], [24, 36, 40], range(30, 180, 30), [-1, 1]], (inputTeeth, outputTeeth, magnitude, direction) => {
            const input = magnitude * direction;
            const output = -input * inputTeeth / outputTeeth;
            return numeric(
                `Với một cặp bánh răng ngoài lý tưởng, bánh vào ${inputTeeth} răng quay ${input} rpm, bánh ra ${outputTeeth} răng. Hai trục dùng cùng quy ước chiều dương. Tốc độ có dấu của trục ra là bao nhiêu? Bỏ qua trượt và sai lệch do tải; làm tròn tối đa 2 chữ số thập phân.`,
                output, [-output, input * outputTeeth / inputTeeth, output + 10, output - 10],
                `Tốc độ ra = -tốc độ vào × số răng vào/số răng ra = -(${input}) × ${inputTeeth}/${outputTeeth} = ${f(output)} rpm. Dấu âm trong công thức thể hiện hai bánh ngoài quay ngược chiều.`, 'rpm');
        }),

    template('spike-ratio-efficiency-torque', 'lego-spike', 'ratio', 'gear-efficiency-torque', 'apply',
        [[ [12, 24], [12, 36], [20, 40] ], [0.05, 0.1, 0.15, 0.2, 0.25], [0.6, 0.7, 0.8, 0.9, 1]], ([inputTeeth, outputTeeth], inputTorque, efficiency) => {
            const output = efficiency * inputTorque * outputTeeth / inputTeeth;
            return numeric(
                `Mô hình truyền động dùng một cặp bánh răng ${inputTeeth}:${outputTeeth} (vào:ra), độ lớn mô-men vào ${f(inputTorque)} N·m, hiệu suất η = ${f(efficiency)}. Dùng T_out = η × T_in × Z_out/Z_in. Độ lớn mô-men ra dự đoán bằng bao nhiêu? Làm tròn tối đa 3 chữ số thập phân; đây không phải số đo motor thật.`,
                output, [inputTorque * outputTeeth / inputTeeth, efficiency * inputTorque * inputTeeth / outputTeeth, inputTorque, output + 0.1],
                `T_out = ${f(efficiency)} × ${f(inputTorque)} × ${outputTeeth}/${inputTeeth} = ${f(output, 3)} N·m. Hiệu suất được cho trong đề; tỷ số này không tạo thêm năng lượng.`, 'N·m', 3);
        }),

    template('spike-state-entry-actions', 'lego-spike', 'state', 'state-entry-once', 'basic',
        [range(2, 15), range(2, 10)], (objects, polls) => numeric(
            `Máy trạng thái xử lý ${objects} vật hợp lệ. Mỗi vật vào CLASSIFY một lần; lúc vào phát đúng một lệnh đóng, khi đóng xong phát đúng một lệnh mở, rồi sang WAIT_CLEAR. Trong CLASSIFY có ${polls} lượt kiểm tra encoder cho mỗi pha; kiểm tra không phát lại lệnh. Bỏ qua lệnh chuẩn bị ban đầu, tổng số lệnh chuyển động đóng/mở là bao nhiêu?`,
            2 * objects, [2 * objects * polls, objects, 2 * objects + 1],
            `Mỗi vật có hai lệnh: đóng và mở. ${polls} lượt kiểm tra mỗi pha chỉ quan sát tiến độ, không khởi tạo lại chuyển động. Tổng 2 × ${objects} = ${2 * objects} lệnh.`, 'lệnh', 0)),

    template('spike-state-timeout-priority', 'lego-spike', 'state', 'state-timeout-boundary', 'apply',
        [range(10, 29), [-0.2, -0.1, 0, 0.1, 0.2], ['CLOSE', 'OPEN'], [-3, -2, 0, 2, 3]], (deadline, offset, phase, error) => {
            const now = deadline + offset;
            const target = phase === 'CLOSE' ? 0 : 45;
            const encoder = target + error;
            const timedOut = offset >= 0;
            const arrived = Math.abs(error) <= 2;
            const correct = timedOut ? 'Sang ERROR vì hết hạn' : !arrived ? `Giữ CLASSIFY, pha ${phase}, tiếp tục chờ` : phase === 'CLOSE' ? 'Giữ CLASSIFY, đổi sang pha OPEN và phát một lệnh mở' : 'Tăng gate_cycles một lần, sang WAIT_CLEAR';
            return choice(
                `Đang CLASSIFY, pha ${phase}, target = ${target}°, encoder = ${encoder}°. Hạn pha là ${deadline} s; thời điểm hiện tại ${f(now)} s. Thứ tự xử lý: nếu now >= deadline thì ERROR; elif abs(encoder-target) <= 2 thì CLOSE chuyển OPEN, còn OPEN hoàn tất chuyển WAIT_CLEAR; nếu không thì tiếp tục chờ. Bỏ qua đầu vào khác. Bước tiếp theo là gì?`,
                correct, ['Sang ERROR vì hết hạn', `Giữ CLASSIFY, pha ${phase}, tiếp tục chờ`, 'Giữ CLASSIFY, đổi sang pha OPEN và phát một lệnh mở', 'Tăng gate_cycles một lần, sang WAIT_CLEAR'],
                timedOut ? `now = ${f(now)} >= ${deadline}, nên nhánh timeout chạy trước cả kiểm tra encoder. Không tăng đếm thành công cho pha chưa hoàn tất trước hạn.` : !arrived ? `now còn trước hạn nhưng sai lệch |${encoder} - ${target}| = ${Math.abs(error)}° > 2°, nên giữ nguyên pha và chờ.` : `now còn trước hạn và sai lệch ${Math.abs(error)}° <= 2°. ${phase === 'CLOSE' ? 'Pha đóng xong, phát một lệnh mở và vẫn ở CLASSIFY.' : 'Pha mở xong, tăng gate_cycles một lần và chuyển WAIT_CLEAR.'}`);
        }),
];
