/* Fixed micro:bit teaching models. These controls do not execute learner source. */
export function counterTransition(count, event, buggy = false) {
    if (event === 'B' || event === 'A+B' || event === 'boot') return 0;
    if (event === 'A') return buggy ? 1 : count + 1;
    return count;
}

export function lightDecision(level, threshold) {
    return level < threshold;
}

export function receiveRadio(previous, { group, name, value }) {
    if (group !== 7) return { value: previous, accepted: false, reason: 'Khác nhóm 7: bộ nhận không xử lý bản tin.' };
    if (name !== 'temp') return { value: previous, accepted: false, reason: 'Tên trường phải là temp.' };
    if (!Number.isFinite(value) || value < -20 || value > 60) return { value: previous, accepted: false, reason: 'Giá trị phải là số trong miền đóng −20..60 °C.' };
    return { value, accepted: true, reason: 'Bản tin hợp lệ: cập nhật giá trị đã lưu.' };
}

export function mountMicrobitBench({ host, lesson, onEvidence = () => {} }) {
    const doc = host.ownerDocument;
    const listeners = [];
    const make = (tag, text, cls) => {
        const node = doc.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (cls) node.className = cls;
        return node;
    };
    const listen = (node, event, fn) => { node.addEventListener(event, fn); listeners.push(() => node.removeEventListener(event, fn)); };
    const button = (label, fn) => {
        const node = make('button', label, 'lesson-bench-button');
        node.type = 'button';
        listen(node, 'click', fn);
        return node;
    };
    const row = (...items) => { const n = make('div', undefined, 'lesson-bench-controls'); n.append(...items); return n; };
    const field = (label, value, options = {}) => {
        const wrapper = make('label', undefined, 'lesson-bench-field');
        wrapper.append(make('span', label));
        const input = make('input');
        input.type = options.type || 'number';
        input.value = value;
        for (const key of ['min', 'max', 'step']) if (options[key] !== undefined) input[key] = options[key];
        wrapper.append(input);
        return { wrapper, input };
    };
    const output = make('p', 'Chưa có thao tác. Hãy dự đoán trước rồi thử.', 'lesson-bench-output');
    output.setAttribute('role', 'status');
    output.setAttribute('aria-live', 'polite');
    const note = text => host.append(make('p', text, 'lesson-bench-note'));
    const report = (summary, evidence = true) => {
        output.textContent = summary;
        if (evidence) onEvidence(summary.slice(0, 600));
    };
    const validNumber = (input, min, max, integer = false) => {
        const value = Number(input.value);
        return input.value.trim() !== '' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
    };
    const heart = new Set(['0,1','0,3','1,0','1,1','1,2','1,3','1,4','2,0','2,1','2,2','2,3','2,4','3,1','3,2','3,3','4,2'].map(p => p.split(',').reverse().join(',')));
    const createMatrix = (interactive = false, toggle = () => {}) => {
        const table = make('table', undefined, 'lesson-bench-matrix');
        table.style.cssText = 'max-width:290px;width:100%;table-layout:fixed;text-align:center;border-collapse:separate;border-spacing:3px';
        table.append(make('caption', 'Ma trận LED: x sang phải, y xuống dưới; gốc (0,0) ở trên trái.'));
        const head = make('tr');
        head.append(make('th', 'y \\ x'));
        for (let x = 0; x < 5; x++) { const h = make('th', String(x)); h.scope = 'col'; head.append(h); }
        const thead = make('thead'); thead.append(head); table.append(thead);
        const tbody = make('tbody');
        const cells = [];
        for (let y = 0; y < 5; y++) {
            const tr = make('tr'); const th = make('th', String(y)); th.scope = 'row'; tr.append(th);
            for (let x = 0; x < 5; x++) {
                const td = make('td');
                const cell = interactive ? button('○', () => toggle(x, y)) : make('span', '○');
                cell.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;min-height:2.2rem;width:100%;font-size:1.3rem;border-radius:6px';
                cell.setAttribute('aria-label', `LED (${x},${y}) tắt`);
                if (interactive) cell.setAttribute('aria-pressed', 'false');
                cells.push({ x, y, cell }); td.append(cell); tr.append(td);
            }
            tbody.append(tr);
        }
        table.append(tbody);
        return {
            node: table,
            paint(points) {
                for (const { x, y, cell } of cells) {
                    const on = points.has(`${x},${y}`);
                    cell.textContent = on ? '●' : '○';
                    cell.style.background = on ? '#ffdb5c' : '#142239';
                    cell.style.color = on ? '#4c2c00' : '#94a3b8';
                    cell.setAttribute('aria-label', `LED (${x},${y}) ${on ? 'bật' : 'tắt'}`);
                    if (interactive) cell.setAttribute('aria-pressed', String(on));
                }
            }
        };
    };

    if (lesson.id === 'matrix') {
        note('Mô hình ma trận 5×5. Thử tạo chữ thập 5 điểm, rồi xóa và tự tạo chữ L 9 điểm. Bật thêm một điểm giữ nguyên các điểm cũ.');
        let points = new Set();
        const matrix = createMatrix(true, (x, y) => {
            const key = `${x},${y}`;
            if (points.has(key)) points.delete(key); else points.add(key);
            matrix.paint(points);
            report(`LED (${x},${y}) ${points.has(key) ? 'bật' : 'tắt'}. Có ${points.size} LED đang bật. Tọa độ: ${[...points].sort().map(p => `(${p})`).join(', ') || 'không có'}.`);
        });
        const x = field('Tọa độ x (0..4)', 2, { min: 0, max: 4, step: 1 });
        const y = field('Tọa độ y (0..4)', 2, { min: 0, max: 4, step: 1 });
        const plot = on => {
            if (!validNumber(x.input, 0, 4, true) || !validNumber(y.input, 0, 4, true)) { report('Không đổi hình: x và y phải là số nguyên từ 0 đến 4. Cột thứ năm có x=4.', false); return; }
            const key = `${Number(x.input.value)},${Number(y.input.value)}`;
            if (on) points.add(key); else points.delete(key);
            matrix.paint(points);
            report(`${on ? 'Bật' : 'Tắt'} (${key}); ${points.size} LED đang bật. Bật lại điểm đã sáng không tăng số điểm.`);
        };
        host.append(matrix.node, row(x.wrapper, y.wrapper), row(button('Bật điểm', () => plot(true)), button('Tắt điểm', () => plot(false)), button('Xóa / đặt lại', () => { points = new Set(); matrix.paint(points); report('Đã xóa 25 LED. Hãy thử hình mới.', false); })));
        matrix.paint(points);
    } else if (lesson.id === 'buttons') {
        note('Mô hình sự kiện rời: một lần bấm nút dưới đây phát một sự kiện. A hiện trái tim, B xóa. Dự đoán A,A,B và B,A. Mô hình không đo thời gian giữ nút thật.');
        let events = [];
        const matrix = createMatrix(); matrix.paint(new Set());
        const event = name => {
            events.push(name); events = events.slice(-16);
            matrix.paint(name === 'A' ? heart : new Set());
            report(`Chuỗi ${events.join(' → ')}. Sự kiện cuối ${name}: ${name === 'A' ? 'hiện một trái tim; A lần nữa ghi cùng hình' : 'xóa màn hình'}.`);
        };
        host.append(matrix.node, row(button('Bấm A: hiện trái tim', () => event('A')), button('Bấm B: xóa', () => event('B')), button('Khởi động lại', () => { events = []; matrix.paint(new Set()); report('Khởi động: màn hình trống; chưa nhận sự kiện A/B.', false); })));
    } else if (lesson.id === 'light') {
        note('Mô hình đầu vào ánh sáng tương đối 0..255, không phải lux hay ánh sáng phòng thật. Quy tắc: mức sáng < ngưỡng thì hiện trái tim; bằng ngưỡng thì xóa.');
        const level = field('Mức sáng tương đối (0..255)', 79, { min: 0, max: 255, step: 1 });
        const threshold = field('Ngưỡng (0..255)', 80, { min: 0, max: 255, step: 1 });
        const matrix = createMatrix(); matrix.paint(new Set());
        const read = () => {
            if (!validNumber(level.input, 0, 255, true) || !validNumber(threshold.input, 0, 255, true)) { report('Nhập mức sáng và ngưỡng là số nguyên 0..255.', false); return; }
            const l = Number(level.input.value), t = Number(threshold.input.value), dark = lightDecision(l, t);
            matrix.paint(dark ? heart : new Set());
            report(`Đọc ${l}; kiểm tra ${l} < ${t} là ${dark ? 'đúng' : 'sai'} → ${dark ? 'hiện trái tim (nhánh tối)' : 'xóa màn hình'}.`);
        };
        const boundary = delta => { level.input.value = Math.max(0, Math.min(255, Number(threshold.input.value) + delta)); read(); };
        host.append(row(level.wrapper, threshold.wrapper), row(button('Đọc một mẫu', read), button('Thử ngưỡng − 1', () => boundary(-1)), button('Thử đúng ngưỡng', () => boundary(0)), button('Thử ngưỡng + 1', () => boundary(1)), button('Đặt lại', () => { level.input.value = 79; threshold.input.value = 80; matrix.paint(new Set()); report('Đã đặt lại; dự đoán trước khi đọc mẫu.', false); })), matrix.node);
    } else if (lesson.id === 'radio') {
        note('Mô hình giao thức bản tin: bộ nhận ở nhóm 7, chỉ nhận temp và giá trị −20..60 °C. Không phát sóng thật, không mô phỏng tầm xa hay bảo mật.');
        const group = field('Nhóm bên gửi (0..255)', 7, { min: 0, max: 255, step: 1 });
        const name = field('Tên trường', 'temp', { type: 'text' });
        const value = field('Giá trị gửi (°C giả định)', 23, { step: 'any' });
        let stored = null;
        const display = make('p', 'Bộ nhận: chưa có dữ liệu hợp lệ.', 'lesson-bench-display');
        const send = () => {
            if (!validNumber(group.input, 0, 255, true)) { report('Nhóm bên gửi phải là số nguyên 0..255.', false); return; }
            const numeric = value.input.value.trim() === '' ? NaN : Number(value.input.value);
            const result = receiveRadio(stored, { group: Number(group.input.value), name: name.input.value, value: numeric });
            stored = result.value;
            display.textContent = stored === null ? 'Bộ nhận: chưa có dữ liệu hợp lệ.' : `Bộ nhận đang lưu: ${stored} °C.`;
            report(`${result.accepted ? 'Nhận' : 'Bỏ qua'} (${name.input.value.slice(0, 40)}, ${value.input.value.slice(0, 20)}), nhóm ${group.input.value}. ${result.reason} ${stored === null ? 'Vẫn chưa có giá trị.' : `Giá trị lưu: ${stored} °C.`}`);
        };
        host.append(row(group.wrapper, name.wrapper, value.wrapper), row(button('Gửi một bản tin mô hình', send), button('Không có bản tin mới', () => report(`Không có bản tin mới: ${stored === null ? 'chưa có dữ liệu' : `giữ ${stored} °C`}. Dữ liệu có thể cũ; không tự biến thành 0.`)), button('Đặt lại', () => { stored = null; group.input.value = 7; name.input.value = 'temp'; value.input.value = 23; display.textContent = 'Bộ nhận: chưa có dữ liệu hợp lệ.'; report('Đã đặt lại bộ nhận; chưa có bản tin hợp lệ.', false); })), display);
    } else {
        const project = lesson.id === 'project';
        note(project ? 'Mô hình kiểm thử bộ đếm với hai quy tắc có sẵn. Chọn lỗi, tìm chuỗi tái hiện, đổi lại quy tắc đúng rồi chạy lại các ca. Đây không phải kiểm thử mã Python do bạn viết.' : 'Mô hình bộ đếm sự kiện: A tăng 1, B đặt 0; A+B trong cùng lượt thăm dò ưu tiên B. Số hiển thị dưới đây là giá trị biến, không mô phỏng chữ cuộn trên LED.');
        let count = 0, history = [], buggy = false;
        const results = make('div', undefined, 'lesson-bench-tests');
        const display = make('p', 'count = 0', 'lesson-bench-display');
        display.style.fontSize = '1.8rem';
        const trace = make('p', 'Khởi động: 0.', 'lesson-bench-note');
        const rule = make('select');
        const a = make('option', 'Quy tắc đúng: A → count + 1'); a.value = 'correct';
        const b = make('option', 'Cố ý tạo lỗi: A → 1'); b.value = 'bug'; rule.append(a, b);
        if (project) {
            const label = make('label', 'Quy tắc mô hình '); label.append(rule); host.append(label);
            listen(rule, 'change', () => { buggy = rule.value === 'bug'; count = 0; history = []; results.replaceChildren(); display.textContent = 'count = 0'; trace.textContent = 'Đã đổi quy tắc và khởi động lại từ 0.'; report('Quy tắc mới đã chọn; hãy chạy một ca để quan sát.', false); });
        }
        const event = name => {
            const before = count;
            count = counterTransition(count, name, buggy);
            history.push(`${name}: ${before} → ${count}`); history = history.slice(-12);
            display.textContent = `count = ${count}`; trace.textContent = history.join(' | ');
            report(`Sự kiện ${name}: count ${before} → ${count}.${buggy ? ' Quy tắc lỗi A gán lại 1.' : ' A tăng 1; B đặt 0.'}`);
        };
        const reset = () => { count = 0; history = []; results.replaceChildren(); display.textContent = 'count = 0'; trace.textContent = 'Khởi động: 0.'; report('Khởi động lại: biến count trở về 0.', false); };
        host.append(display, row(button('Bấm A (+1)', () => event('A')), button('Bấm B (đặt 0)', () => event('B')), button('A+B cùng lượt (B ưu tiên)', () => event('A+B')), button('Khởi động lại', reset)), trace);
        if (project) {
            host.append(button('Chạy 3 ca kiểm thử mô hình', () => {
                const cases = [['A', 'A', 'B', 'A'], ['B', 'B', 'A', 'A', 'A'], ['A', 'A', 'A', 'boot']];
                const table = make('table', undefined, 'lesson-bench-table');
                const head = make('tr'); for (const title of ['Đầu vào (từ 0)', 'Kỳ vọng sau từng sự kiện', 'Mô hình quan sát', 'Kết quả']) { const th = make('th', title); th.scope = 'col'; head.append(th); }
                const thead = make('thead'); thead.append(head); table.append(thead); const tbody = make('tbody');
                let pass = 0;
                for (const events of cases) {
                    let expected = 0, actual = 0; const expectedTrace = [], actualTrace = [];
                    for (const name of events) { expected = counterTransition(expected, name); actual = counterTransition(actual, name, buggy); expectedTrace.push(expected); actualTrace.push(actual); }
                    const ok = expectedTrace.every((n, i) => n === actualTrace[i]); if (ok) pass++;
                    const tr = make('tr'); for (const text of [events.join(','), expectedTrace.join(' → '), actualTrace.join(' → '), ok ? 'Đạt' : 'Chưa đạt']) tr.append(make('td', text)); tbody.append(tr);
                }
                table.append(tbody); results.replaceChildren(table);
                report(`Đã chạy 3 ca tuần tự từ count=0; ${pass}/3 ca có mọi trạng thái trung gian đúng. ${buggy ? 'A,A đã tái hiện lỗi: kỳ vọng 1,2 nhưng mô hình lỗi cho 1,1.' : 'Cả tăng, đặt lại lặp và khởi động lại đều khớp quy tắc trong các ca này.'}`);
            }), results);
        }
    }
    host.append(output);
    return { destroy() { for (const remove of listeners) remove(); } };
}
