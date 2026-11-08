/* Small DOM helpers; labels wrap their controls so mounts need no global IDs. */
export function createBenchUI(host, onEvidence) {
    const doc = host.ownerDocument;
    const make = (tag, text, className) => {
        const element = doc.createElement(tag);
        if (text !== undefined) element.textContent = text;
        if (className) element.className = className;
        return element;
    };
    const controls = make('div', undefined, 'lesson-bench-controls');
    const actions = make('div', undefined, 'lesson-bench-actions');
    const visual = make('div', undefined, 'lesson-bench-visual');
    const output = make('pre', 'Chọn dự đoán của bạn, rồi thực hiện một lượt thử.', 'lesson-bench-output');
    output.setAttribute('role', 'status');
    output.setAttribute('aria-live', 'polite');
    host.append(controls, actions, visual, output);
    const field = (label, value, options = {}) => {
        const wrap = make('label', undefined, 'lesson-bench-field');
        wrap.append(make('span', label));
        let input;
        if (options.choices) {
            input = make('select');
            options.choices.forEach(choice => {
                const item = typeof choice === 'string' ? {value: choice, label: choice} : choice;
                const option = make('option', item.label);
                option.value = item.value;
                input.append(option);
            });
        } else {
            input = make(options.multiline ? 'textarea' : 'input');
            if (!options.multiline) input.type = options.type || 'number';
            for (const attribute of ['min', 'max', 'step', 'maxLength']) if (options[attribute] !== undefined) input[attribute] = options[attribute];
            if (options.multiline) { input.rows = 2; input.maxLength = options.maxLength || 400; }
        }
        input.value = String(value);
        wrap.append(input);
        controls.append(wrap);
        return input;
    };
    const button = (label, handler) => {
        const node = make('button', label);
        node.type = 'button';
        node.addEventListener('click', handler);
        actions.append(node);
        return node;
    };
    const note = text => host.prepend(make('p', text, 'lesson-bench-note'));
    const report = (summary, meaningful = true) => {
        output.textContent = summary;
        if (meaningful) onEvidence(summary);
    };
    const number = (input, min = -1e6, max = 1e6) => {
        const value = input.value.trim() === '' ? NaN : Number(input.value);
        if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Nhập một số từ ${min} đến ${max}.`);
        return value;
    };
    const guard = handler => () => { try { handler(); } catch (error) { report(error.message, false); } };
    return {host, doc, make, controls, actions, visual, output, field, button, note, report, number, guard};
}
export const round = (value, digits = 2) => Number(value.toFixed(digits));
