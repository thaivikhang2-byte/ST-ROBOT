/* Declared mathematical and event models. This module does not execute Python. */
export function gearTransmission({ teethIn, teethOut, angleIn = 0, speedIn = 0, torqueIn = 0, efficiency = 1 }) {
    const values = [teethIn, teethOut, angleIn, speedIn, torqueIn, efficiency];
    if (!values.every(Number.isFinite) || !Number.isInteger(teethIn) || !Number.isInteger(teethOut) || teethIn <= 0 || teethOut <= 0 || efficiency <= 0 || efficiency > 1) {
        throw new RangeError('Số răng phải là số nguyên dương; hiệu suất cần lớn hơn 0 và không quá 1.');
    }
    const speedRatio = teethIn / teethOut;
    return {
        angleOut: -angleIn * speedRatio,
        speedOut: -speedIn * speedRatio,
        torqueOut: Math.abs(torqueIn) * efficiency / speedRatio,
        speedRatio,
        idealTorqueRatio: 1 / speedRatio
    };
}

export function colorBranch(label) {
    return label === 'red' ? 'A' : label === 'blue' ? 'B' : 'CHECK';
}

export function createSorterState() {
    return { state: 'WAIT', phase: '', received: 0, successful: 0, needsCheck: 0, clearSamples: 0, group: '', message: 'Đợi một vật mới.' };
}

/** One declared sample or mechanism event; unknown is present, never clear. */
export function advanceSorter(previous, event, { detailed = false, clearRequired = 1 } = {}) {
    const next = { ...previous };
    const required = Math.max(1, Math.min(5, Math.trunc(clearRequired) || 1));
    if (next.state === 'ERROR') {
        next.message = 'ERROR: đã dừng mô hình. Kiểm tra nguyên nhân rồi Đặt lại để bắt đầu lượt mới.';
        return next;
    }
    if (event.type === 'timeout') {
        if (next.state === 'CLASSIFY') {
            next.state = 'ERROR';
            next.message = `Timeout ở pha ${next.phase}: dừng cơ cấu; không tăng số thành công.`;
        } else next.message = 'Không có chu kỳ đang chạy để tạo timeout cơ cấu.';
        return next;
    }
    if (event.type === 'advance') {
        if (next.state !== 'CLASSIFY') {
            next.message = 'Chưa có pha cơ cấu đang chạy. Đọc một vật đỏ hoặc xanh ở WAIT.';
        } else if (next.phase === 'ACT') {
            next.phase = 'RETURN';
            next.message = 'Pha gạt hoàn tất theo giả định; đang trở về mốc. Chưa tính thành công.';
        } else {
            next.state = 'WAIT_CLEAR';
            next.phase = '';
            next.successful += 1;
            next.clearSamples = 0;
            next.message = 'Đã về mốc theo giả định: tăng một chu kỳ thành công, chờ vật rời đi.';
        }
        return next;
    }
    if (event.type !== 'sample') return next;
    if (!['red', 'blue', 'unknown', 'empty'].includes(event.label)) throw new RangeError('Nhãn mẫu không được hỗ trợ.');
    if (next.state === 'CLASSIFY') {
        next.message = 'Chu kỳ đang chạy; mẫu mới không khởi tạo thêm chu kỳ. Tiến pha hoặc thử timeout.';
        return next;
    }
    if (next.state === 'WAIT_CLEAR') {
        next.clearSamples = event.label === 'empty' ? next.clearSamples + 1 : 0;
        if (next.clearSamples >= required) {
            next.state = 'WAIT';
            next.clearSamples = 0;
            next.message = 'Đã xác nhận trống theo quy tắc mô hình: cho phép nhận vật tiếp theo.';
        } else {
            next.message = event.label === 'empty'
                ? `Trống ${next.clearSamples}/${required} mẫu liên tiếp; vẫn chờ xác nhận.`
                : 'Vật còn ở vùng đọc; giữ chốt, không tăng lượt nhận. “Chưa biết” không chứng minh trống.';
        }
        return next;
    }
    if (event.label === 'empty') {
        next.message = 'Vùng trống, tiếp tục WAIT; chưa nhận vật.';
        return next;
    }
    next.received += 1;
    next.group = colorBranch(event.label);
    next.clearSamples = 0;
    if (next.group === 'CHECK') {
        next.needsCheck += 1;
        next.state = 'WAIT_CLEAR';
        next.message = 'Nhận một vật chưa biết: chuyển kiểm tra, chưa tính chu kỳ gạt thành công; giữ chốt tới khi trống.';
    } else if (event.outcome === 'timeout') {
        next.state = 'ERROR';
        next.message = 'Nhận vật nhưng cơ cấu timeout: dừng; số nhận tăng, số thành công giữ nguyên.';
    } else if (detailed) {
        next.state = 'CLASSIFY';
        next.phase = 'ACT';
        next.message = `Nhận đúng một vật nhóm ${next.group}; khởi tạo một lần pha gạt ACT.`;
    } else {
        next.state = 'WAIT_CLEAR';
        next.successful += 1;
        next.message = `Một chu kỳ nhóm ${next.group} hoàn tất theo giả định; chờ vật rời đi để mở chốt.`;
    }
    return next;
}

export function sortingRate(statuses) {
    const result = { total: statuses.length, correct: 0, wrong: 0, unknown: 0, jam: 0, percent: null };
    for (const status of statuses) {
        if (!['correct', 'wrong', 'unknown', 'jam'].includes(status)) throw new RangeError('Kết quả phân loại không hợp lệ.');
        result[status] += 1;
    }
    if (result.total) result.percent = result.correct * 100 / result.total;
    return result;
}

const NAMES = { red: 'đỏ', blue: 'xanh', unknown: 'chưa biết', empty: 'trống' };
const format = value => Number(value.toFixed(3)).toLocaleString('vi-VN');

export function mountLegoBench({ host, lesson, onEvidence = () => {} }) {
    const document = host.ownerDocument;
    const listeners = [];
    const make = (tag, text, className) => {
        const element = document.createElement(tag);
        if (text !== undefined) element.textContent = text;
        if (className) element.className = className;
        return element;
    };
    const listen = (target, type, fn) => {
        target.addEventListener(type, fn);
        listeners.push(() => target.removeEventListener(type, fn));
    };
    const button = (text, fn, parent = actions) => {
        const node = make('button', text);
        node.type = 'button';
        listen(node, 'click', fn);
        parent.append(node);
        return node;
    };
    const controls = make('div', undefined, 'lesson-bench-controls');
    const actions = make('div', undefined, 'lesson-bench-actions');
    const output = make('pre', 'Chưa thực hiện lượt thử. Đọc dự đoán rồi dùng các nút bên dưới.', 'lesson-bench-output');
    output.setAttribute('role', 'status');
    output.setAttribute('aria-live', 'polite');
    const field = (label, { value = '', min, max, step = 'any', options } = {}) => {
        const wrapper = make('label', label, 'lesson-bench-field');
        const input = make(options ? 'select' : 'input');
        if (options) for (const [val, name] of options) {
            const option = make('option', name);
            option.value = val;
            input.append(option);
        }
        else {
            input.type = 'number';
            input.step = step;
            if (min !== undefined) input.min = min;
            if (max !== undefined) input.max = max;
        }
        input.value = String(value);
        wrapper.append(input);
        controls.append(wrapper);
        return input;
    };
    const number = input => {
        if (!input.value.trim() || !input.checkValidity()) throw new RangeError('Kiểm tra số nhập và giới hạn ghi trên trường.');
        const result = Number(input.value);
        if (!Number.isFinite(result)) throw new RangeError('Hãy nhập một số hữu hạn.');
        return result;
    };
    const run = fn => {
        try { fn(); }
        catch (error) { output.textContent = error.message; }
    };
    const evidence = text => onEvidence(text.slice(0, 480));
    const prompt = make('p', undefined, 'lesson-bench-note');
    const visual = make('div', undefined, 'lesson-bench-visual');
    const note = make('p', 'Đầu vào và kết quả ở đây là giả định do em chọn. Mô hình không đo cảm biến, tải, độ rơ, vị trí motor hay ngăn vật thật.', 'lesson-bench-note');
    host.append(prompt, controls, actions, visual, output, note);

    if (lesson.id === 'mechanism' || lesson.id === 'ratio') {
        const ratioLesson = lesson.id === 'ratio';
        prompt.textContent = ratioLesson
            ? 'Dự đoán: đổi 12:36 thành 36:12 thì đầu ra nhanh hơn hay chậm hơn? Mô-men thay đổi thế nào? Nhập dự đoán trên phiếu trước khi tính.'
            : 'Dự đoán: với bánh vào 12 răng, bánh ra 36 răng, motor +90° làm tay gạt đổi bao nhiêu độ và theo chiều nào?';
        const teethIn = field('Răng bánh vào', { value: 12, min: 1, max: 200, step: 1 });
        const teethOut = field('Răng bánh ra', { value: 36, min: 1, max: 200, step: 1 });
        const angle = !ratioLesson ? field('Góc motor (°)', { value: 90, min: -360, max: 360 }) : null;
        const speed = ratioLesson ? field('Tốc độ vào (rpm)', { value: 90, min: -1000, max: 1000 }) : null;
        const torque = ratioLesson ? field('Mô-men vào (N·m)', { value: 0.1, min: 0, max: 20 }) : null;
        const efficiency = ratioLesson ? field('Hiệu suất η (0 < η ≤ 1)', { value: 0.8, min: 0.01, max: 1, step: 0.01 }) : null;
        const evaluate = () => run(() => {
            const input = {
                teethIn: number(teethIn), teethOut: number(teethOut),
                angleIn: angle ? number(angle) : 0, speedIn: speed ? number(speed) : 0,
                torqueIn: torque ? number(torque) : 0, efficiency: efficiency ? number(efficiency) : 1
            };
            const result = gearTransmission(input);
            visual.textContent = `Motor → bánh ${input.teethIn} răng ⇄ bánh ${input.teethOut} răng → trục ra / tay gạt`;
            output.textContent = ratioLesson
                ? `ω_ra = −ω_vào × Z_vào/Z_ra = ${format(result.speedOut)} rpm\nHai bánh răng ngoài quay ngược chiều khi có chuyển động.\nTỷ số mô-men lý tưởng = ${format(result.idealTorqueRatio)}\nMô-men ra theo η = ${format(result.torqueOut)} N·m\nĐây là giá trị tính, chưa phải mô-men hay tốc độ đo được.`
                : `θ_ra = −θ_motor × Z_vào/Z_ra = ${format(result.angleOut)}°\nTay gạt gắn trực tiếp trục ra: đổi ${format(result.angleOut)}° quanh mốc đã chọn.\nMuốn tay gạt +20°: motor cần ${format(-20 * input.teethOut / input.teethIn)}°.\nDấu − chỉ chiều ngược; mô hình không xác định giới hạn an toàn của cơ cấu thật.`;
            evidence(`${ratioLesson ? 'Bộ truyền tốc độ/mô-men' : 'Góc tay gạt'} giả định ${input.teethIn}:${input.teethOut}: ${ratioLesson ? `${format(result.speedOut)} rpm, ${format(result.torqueOut)} N·m` : `${format(input.angleIn)}° vào → ${format(result.angleOut)}° ra`}.`);
        });
        button('Tính và đối chiếu', evaluate);
        button('Đảo hai bánh răng', () => {
            const old = teethIn.value;
            teethIn.value = teethOut.value;
            teethOut.value = old;
            evaluate();
        });
        button('Đặt lại', () => {
            teethIn.value = '12'; teethOut.value = '36';
            if (angle) angle.value = '90';
            if (speed) speed.value = '90';
            if (torque) torque.value = '0.1';
            if (efficiency) efficiency.value = '0.8';
            visual.replaceChildren();
            output.textContent = 'Đã đặt lại thông số. Dự đoán rồi tính lượt mới.';
        });
    } else if (lesson.id === 'colors') {
        prompt.textContent = 'Dự đoán các nhánh của đỏ → xanh → chưa biết → đỏ → chưa biết. Nếu cả 5 mẫu cùng đo một vật đỏ, em biết được số vật từ bảng này không?';
        const label = field('Nhãn cảm biến giả định', { value: 'red', options: [['red', 'Đỏ'], ['blue', 'Xanh'], ['unknown', 'Chưa biết']] });
        const records = [];
        const table = make('table', undefined, 'lesson-bench-table');
        const head = make('thead'); const row = make('tr');
        for (const title of ['Lượt đọc', 'Nhãn giả định', 'Nhánh xử lý']) row.append(make('th', title));
        head.append(row); const rows = make('tbody'); table.append(head, rows); visual.append(table);
        button('Đọc một nhãn', () => {
            const branch = colorBranch(label.value);
            records.push({ label: label.value, branch });
            const row = make('tr');
            for (const text of [records.length, NAMES[label.value], branch === 'CHECK' ? 'CHECK: chờ kiểm tra' : `Ngăn ${branch}`]) row.append(make('td', text));
            rows.append(row);
            while (rows.children.length > 20) rows.firstElementChild.remove();
            const unknown = records.filter(item => item.branch === 'CHECK').length;
            output.textContent = `Mẫu ${records.length}: ${NAMES[label.value]} → ${branch}.\n${unknown}/${records.length} mẫu chưa biết. Đây là số mẫu, chưa phải số vật lạ.\nBảng hiện tối đa 20 mẫu gần nhất.`;
            evidence(`Đọc nhãn giả định ${NAMES[label.value]} → ${branch}; ${records.length} mẫu, ${unknown} mẫu chưa biết. Không suy ra số vật.`);
        });
        button('Đặt lại bảng', () => { records.length = 0; rows.replaceChildren(); output.textContent = 'Bảng trống. Chọn nhãn rồi đọc từng mẫu.'; });
    } else if (lesson.id === 'project') {
        prompt.textContent = 'Chốt trước: “đúng” nghĩa là vật đến đúng ngăn. Dự đoán tỷ lệ của 9 đúng, 1 sai, 1 chưa xác định, 1 kẹt. Cả 12 lượt có nằm trong mẫu số không?';
        const status = field('Kết quả giả định của một vật', { value: 'correct', options: [['correct', 'Tới đúng ngăn'], ['wrong', 'Tới sai ngăn'], ['unknown', 'Chưa xác định / chưa hoàn tất'], ['jam', 'Kẹt / timeout']] });
        const records = [];
        const labels = { correct: 'đúng ngăn', wrong: 'sai ngăn', unknown: 'chưa xác định', jam: 'kẹt/timeout' };
        const render = () => {
            const result = sortingRate(records);
            visual.textContent = records.map((item, index) => `${index + 1}: ${labels[item]}`).join(' · ');
            output.textContent = `${result.correct} đúng + ${result.wrong} sai + ${result.unknown} chưa xác định + ${result.jam} kẹt = ${result.total} lượt giả định.\nTỷ lệ đúng toàn hệ thống = ${result.correct}/${result.total} × 100% = ${format(result.percent)}%.\nKhông loại lỗi khỏi mẫu số. Bảng này chưa chỉ ra lỗi do cảm biến hay cơ cấu; cần thêm nhãn đo và ngăn đến của từng lượt.`;
            evidence(`Bộ thử giả định: ${result.correct}/${result.total} đúng ngăn = ${format(result.percent)}%; gồm ${result.wrong} sai, ${result.unknown} chưa xác định, ${result.jam} kẹt.`);
        };
        button('Thêm kết quả một vật', () => {
            if (records.length >= 50) { output.textContent = 'Bộ thử tối đa 50 vật. Đặt lại để bắt đầu bộ thử mới.'; return; }
            records.push(status.value); render();
        });
        button('Thử bộ 12 vật trong đề', () => {
            records.splice(0, records.length, ...Array(9).fill('correct'), 'wrong', 'unknown', 'jam'); render();
        });
        button('Đặt lại bộ thử', () => { records.length = 0; visual.replaceChildren(); output.textContent = 'Chưa có lượt thử; tỷ lệ chưa xác định. Chốt tiêu chí trước khi thêm dữ liệu giả định.'; });
    } else {
        const detailed = lesson.id === 'state';
        prompt.textContent = detailed
            ? 'Dự đoán: khi WAIT_CLEAR gặp đỏ → chưa biết → đỏ → trống → đỏ, lúc nào mới mở một chu kỳ? Đọc từng mẫu; ở CLASSIFY hãy tiến qua hai pha ACT và RETURN.'
            : 'Dự đoán số vật mới trong đỏ → đỏ → trống → đỏ → chưa biết → trống. “Chưa biết” vẫn có vật; chỉ “trống” mở lại chốt. Thử thêm timeout ở vật thứ hai.';
        const label = field('Mẫu hiện diện/màu giả định', { value: 'red', options: [['red', 'Có vật đỏ'], ['blue', 'Có vật xanh'], ['unknown', 'Có vật, màu chưa biết'], ['empty', 'Xác nhận không có vật']] });
        const outcome = !detailed ? field('Chu kỳ mới sẽ', { value: 'ok', options: [['ok', 'Gạt và về mốc thành công (giả định)'], ['timeout', 'Bị kẹt / timeout (giả định)']] }) : null;
        const required = field('Số mẫu trống liên tiếp để mở chốt', { value: '1', options: [['1', '1 mẫu đã xác nhận (mô hình tối thiểu)'], ['3', '3 mẫu liên tiếp (thử bộ lọc)']] });
        let current = createSorterState();
        let steps = 0;
        const trace = make('ol'); trace.setAttribute('aria-label', 'Lịch sử chuyển trạng thái'); visual.append(trace);
        const dispatch = (event, action) => {
            const previousState = `${current.state}${current.phase ? `/${current.phase}` : ''}`;
            current = advanceSorter(current, event, { detailed, clearRequired: Number(required.value) });
            steps += 1;
            const stateText = `${current.state}${current.phase ? `/${current.phase}` : ''}`;
            const line = `${steps}. ${action}: ${previousState} → ${stateText}; nhận ${current.received}, thành công ${current.successful}.`;
            trace.append(make('li', line.replace(/^\d+\. /, '')));
            while (trace.children.length > 16) trace.firstElementChild.remove();
            output.textContent = `Trạng thái: ${stateText}\nVật đã nhận: ${current.received}; chu kỳ gạt thành công: ${current.successful}; cần kiểm tra: ${current.needsCheck}.\n${current.message}\nCác lần gạt/về mốc “hoàn tất” là sự kiện giả định, chưa đo chuyển động cơ cấu.`;
            evidence(`${action}: ${stateText}; nhận ${current.received}, chu kỳ thành công ${current.successful}, cần kiểm tra ${current.needsCheck}. ${current.message}`);
        };
        button('Đọc một mẫu', () => dispatch({ type: 'sample', label: label.value, outcome: outcome?.value || 'ok' }, `Đọc ${NAMES[label.value]}`));
        if (detailed) {
            button('Tiến một pha cơ cấu', () => dispatch({ type: 'advance' }, 'Hoàn tất pha giả định'));
            button('Giả lập timeout cơ cấu', () => dispatch({ type: 'timeout' }, 'Thử timeout'));
        }
        button('Đặt lại', () => {
            current = createSorterState(); steps = 0; trace.replaceChildren();
            label.value = 'red'; if (outcome) outcome.value = 'ok';
            output.textContent = 'WAIT: nhận 0, thành công 0. Dự đoán rồi đọc một mẫu mới.';
        });
        if (detailed) note.textContent += ' Máy có bốn trạng thái WAIT, CLASSIFY, WAIT_CLEAR, ERROR. ACT (gạt) và RETURN (về mốc) là hai pha bên trong CLASSIFY.';
    }
    return { destroy() { for (const remove of listeners) remove(); host.replaceChildren(); } };
}
