import { choiceQuestion, formatNumber as n, mixedRadix, numericQuestion } from '../helpers.js';

const range = (start, length, step = 1) => Array.from({ length }, (_, i) => start + i * step);
const entry = (id, lessonId, skillId, level, domains, render) => ({
    id, courseId: 'arduino', lessonId, skillId, level,
    variantCount: domains.reduce((total, values) => total * values.length, 1),
    render(index) { return render(...mixedRadix(index, domains)); }
});

export const arduinoTemplates = [
    entry('arduino-led-current', 'led', 'led-current', 'basic', [range(1.6, 9, 0.1), range(220, 40, 20)], (vf, resistance) => {
        vf = Number(vf.toFixed(1));
        const current = (5 - vf) / resistance * 1000;
        return numericQuestion({ stem: `Nguồn 5 V cấp cho LED có điện áp rơi giả định ${n(vf, 1)} V qua điện trở nối tiếp ${resistance} Ω. Theo mô hình Vf cố định, dòng điện xấp xỉ bằng bao nhiêu? Làm tròn đến 0,01 mA.`, correct: current,
            distractors: [5 / resistance * 1000, current * 2, current / 10], unit: 'mA', digits: 2,
            explanation: `I = (Vs − Vf)/R = (5 − ${n(vf, 1)})/${resistance} A = ${n(current)} mA. Đây là ước lượng; khi lắp mạch phải đối chiếu datasheet và giới hạn dòng của chân.` });
    }),
    entry('arduino-led-resistor', 'led', 'led-resistor', 'apply', [range(1.6, 9, 0.1), range(3, 14)], (vf, current) => {
        vf = Number(vf.toFixed(1));
        const resistance = (5 - vf) / (current / 1000);
        return numericQuestion({ stem: `Trong mô hình LED có nguồn 5 V, Vf = ${n(vf, 1)} V, muốn dòng ${current} mA thì điện trở tính theo R = (Vs − Vf)/I bằng bao nhiêu? Chọn giá trị tính toán, làm tròn 0,01 Ω.`, correct: resistance,
            distractors: [5 / (current / 1000), resistance / 1000, resistance * 2], unit: 'Ω',
            explanation: `Đổi ${current} mA thành ${n(current / 1000, 3)} A. R = (5 − ${n(vf, 1)})/${n(current / 1000, 3)} = ${n(resistance)} Ω. Giá trị linh kiện thực tế cần chọn theo dãy điện trở và giới hạn dòng.` });
    }),
    entry('arduino-timing-frequency', 'timing', 'period-frequency', 'basic', [range(50, 20, 25), range(75, 20, 25)], (on, off) => {
        const period = on + off, frequency = 1000 / period;
        return numericQuestion({ stem: `LED lặp lại HIGH ${on} ms rồi LOW ${off} ms. Bỏ qua thời gian thực hiện lệnh, tần số chu kỳ đầy đủ là bao nhiêu? Làm tròn 0,01 Hz.`, correct: frequency,
            distractors: [1000 / on, 1000 / off, period / 1000, frequency * 10, frequency / 10], unit: 'Hz',
            explanation: `T = ${on} + ${off} = ${period} ms = ${n(period / 1000, 3)} s. f = 1000/${period} = ${n(frequency)} Hz; một chu kỳ gồm cả pha HIGH và LOW.` });
    }),
    entry('arduino-timing-duty', 'timing', 'duty-cycle', 'apply', [range(200, 20, 50), range(10, 17, 5)], (period, duty) => {
        const on = period * duty / 100;
        return numericQuestion({ stem: `Tín hiệu có chu kỳ ${period} ms và duty cycle HIGH ${duty}%. Thời gian HIGH của mỗi chu kỳ là bao nhiêu?`, correct: on,
            distractors: [period - on, period / duty, period * duty], unit: 'ms',
            explanation: `t_HIGH = D × T = ${duty}/100 × ${period} = ${n(on)} ms. Thời gian LOW còn lại là ${n(period - on)} ms.` });
    }),
    entry('arduino-distance-echo', 'distance', 'echo-distance', 'basic', [range(500, 100, 50), [0.033, 0.034, 0.035]], (echo, speed) => {
        const distance = speed * echo / 2;
        return numericQuestion({ stem: `Xung Echo hợp lệ dài ${echo} µs. Dùng tốc độ âm giả định ${n(speed, 3)} cm/µs, khoảng cách một chiều tới vật là bao nhiêu? Làm tròn 0,01 cm.`, correct: distance,
            distractors: [speed * echo, speed * echo / 4, distance / 10], unit: 'cm',
            explanation: `Echo đo thời gian đi và về, nên d = v × t/2 = ${n(speed, 3)} × ${echo}/2 = ${n(distance)} cm. Chỉ áp dụng cho xung hợp lệ.` });
    }),
    entry('arduino-distance-valid-mean', 'distance', 'timeout-filtering', 'apply', [range(20, 20, 2), range(70, 20, 2)], (first, second) => {
        const average = (first + second) / 2;
        return numericQuestion({ stem: `Ba lần đọc đã đổi ra dữ liệu: ${first} cm, TIMEOUT, ${second} cm. TIMEOUT là lỗi đo. Trung bình của các số đo hợp lệ là bao nhiêu?`, correct: average,
            distractors: [(first + second) / 3, first + second, Math.abs(second - first)], unit: 'cm',
            explanation: `Giữ hai mẫu ${first} và ${second} cm, ghi riêng mẫu lỗi. Trung bình = (${first} + ${second})/2 = ${n(average)} cm; TIMEOUT không được đưa vào như 0 cm.` });
    }),
    entry('arduino-alarm-boundary', 'alarm', 'strict-threshold', 'basic', [range(10, 40), range(1, 10)], (threshold, gap) => {
        const values = [threshold - gap, threshold, threshold + gap];
        return choiceQuestion({ stem: `Cảnh báo bật khi khoảng cách hợp lệ d < ${threshold} cm và tắt ở các trường hợp hợp lệ còn lại. Với lần lượt ${values.join('; ')} cm, chuỗi LED là gì?`, correct: 'ON → OFF → OFF',
            distractors: ['ON → ON → OFF', 'OFF → ON → ON', 'ON → OFF → ON'],
            explanation: `${threshold - gap} < ${threshold} nên ON. Đúng ngưỡng ${threshold} và giá trị ${threshold + gap} thuộc nhánh OFF. Dấu < không gồm giá trị bằng ngưỡng.` });
    }),
    entry('arduino-alarm-test-boundary', 'alarm', 'boundary-test-design', 'apply', [range(10, 40), range(1, 10)], (threshold, gap) => choiceQuestion({
        stem: `Đặc tả bật cảnh báo khi d < ${threshold} cm, nhưng một phiên bản viết d ≤ ${threshold} cm. Chọn một số đo hợp lệ để phát hiện chính xác lỗi khác dấu này; các mức dự kiến là ${threshold - gap}, ${threshold}, ${threshold + gap} và ${threshold + gap * 2} cm.`,
        correct: `${threshold} cm`, distractors: [`${threshold - gap} cm`, `${threshold + gap} cm`, `${threshold + gap * 2} cm`],
        explanation: `Tại ${threshold} cm, điều kiện d < ${threshold} là sai còn d ≤ ${threshold} là đúng. Các mức còn lại nằm hẳn dưới hoặc trên ngưỡng nên hai phiên bản cho cùng kết quả.`
    })),
    entry('arduino-calibration-offset', 'calibration', 'offset-correction', 'basic', [range(-5, 11), range(15, 40)], (offset, measured) => {
        const corrected = measured - offset;
        return numericQuestion({ stem: `Trong phạm vi đã hiệu chuẩn, sai lệch cố định d_đo − d_chuẩn = ${offset} cm. Dùng d_sửa = d_đo − offset để sửa số đo mới ${measured} cm. Kết quả bằng bao nhiêu?`, correct: corrected,
            distractors: [measured + offset + (offset === 0 ? 1 : 0), corrected + 2, corrected - 2], unit: 'cm',
            explanation: `Offset có dấu là ${offset} cm, nên d_sửa = ${measured} − (${offset}) = ${corrected} cm. Giữ nguyên dấu của offset khi thay vào công thức.` });
    }),
    entry('arduino-calibration-absolute-error', 'calibration', 'absolute-error', 'apply', [range(15, 40), range(1, 10)], (reference, error) => {
        const measured = reference - error;
        return numericQuestion({ stem: `Mốc chuẩn ${reference} cm, số đo ${measured} cm. Với e = d_đo − d_chuẩn, sai số tuyệt đối |e| là bao nhiêu?`, correct: error,
            distractors: [-error, reference + measured, error / 10], unit: 'cm',
            explanation: `e = ${measured} − ${reference} = ${-error} cm; |e| = ${error} cm. Sai số có dấu cho biết lệch về phía nào, còn sai số tuyệt đối luôn không âm.` });
    }),
    entry('arduino-project-hysteresis', 'project', 'hysteresis-state', 'basic', [range(10, 20), range(3, 10)], (low, width) => {
        const high = low + width;
        return choiceQuestion({ stem: `Cảnh báo bắt đầu OFF; d < ${low} cm thì ON, d > ${high} cm thì OFF, còn lại giữ trạng thái. Các số đo đều hợp lệ: ${low + 1}, ${low - 1}, ${high}, ${high + 1} cm. Chuỗi trạng thái là gì?`, correct: 'OFF → ON → ON → OFF',
            distractors: ['OFF → ON → OFF → OFF', 'ON → ON → ON → OFF', 'OFF → OFF → ON → OFF'],
            explanation: `${low + 1} cm giữ OFF; ${low - 1} cm bật ON; đúng ${high} cm vẫn trong vùng giữ nên ON; ${high + 1} cm vượt ngưỡng trên nên OFF.` });
    }),
    entry('arduino-project-timeout-memory', 'project', 'timeout-state-memory', 'apply', [range(10, 20), range(3, 10), ['OFF', 'ON']], (low, width, initial) => {
        const high = low + width, inside = low + 1;
        return choiceQuestion({ stem: `Bộ nhớ cảnh báo đang ${initial}. Quy tắc hai ngưỡng: d < ${low} bật, d > ${high} tắt, còn lại giữ bộ nhớ. TIMEOUT bật đèn báo lỗi nhưng giữ nguyên bộ nhớ. Sau TIMEOUT rồi số đo hợp lệ ${inside} cm, bộ nhớ và đèn cuối cùng là gì?`, correct: `${initial}; đèn ${initial === 'ON' ? 'sáng' : 'tắt'}`,
            distractors: [`${initial === 'ON' ? 'OFF' : 'ON'}; đèn ${initial === 'ON' ? 'tắt' : 'sáng'}`, `${initial}; đèn phải báo lỗi mãi`, 'TIMEOUT được tính là khoảng cách 0 cm'],
            explanation: `TIMEOUT giữ bộ nhớ ${initial}. Khi ${inside} cm hợp lệ trở lại, giá trị nằm giữa hai ngưỡng nên vẫn ${initial}; đèn trở về trạng thái bộ nhớ, thay cho báo lỗi.` });
    })
];
