// Image selection and cropping stay entirely in this browser until tutor submit.
const SUPPORTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 25000000;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Decode with an iOS/Safari-compatible fallback; always call close(). */
export async function decodeImageBlob(blob, { document: doc = globalThis.document, signal } = {}) {
    const win = doc.defaultView;
    const aborted = () => new win.DOMException('Đã hủy chuẩn bị ảnh.', 'AbortError');
    if (signal?.aborted) throw aborted();
    if (!blob || !SUPPORTED_TYPES.has(blob.type)) throw Error('Chọn ảnh PNG, JPG hoặc WebP.');
    if (typeof win.createImageBitmap === 'function') {
        try {
            const image = await win.createImageBitmap(blob);
            if (signal?.aborted) { image.close(); throw aborted(); }
            let closed = false;
            return { image, width: image.width, height: image.height, close() { if (!closed) { closed = true; image.close(); } } };
        } catch (error) {
            if (signal?.aborted || error?.name === 'AbortError') throw aborted();
            // Safari may expose createImageBitmap but reject a supported encoding.
        }
    }
    const url = win.URL.createObjectURL(blob);
    const image = new win.Image();
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        image.onload = null; image.onerror = null;
        image.removeAttribute('src'); win.URL.revokeObjectURL(url);
    };
    try {
        await new Promise((resolve, reject) => {
            const abort = () => { close(); reject(aborted()); };
            const cleanup = () => signal?.removeEventListener('abort', abort);
            image.onload = () => { cleanup(); resolve(); };
            image.onerror = () => { cleanup(); close(); reject(Error('Ảnh chưa đọc được. Hãy chọn ảnh PNG, JPG hoặc WebP khác.')); };
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) { cleanup(); abort(); return; }
            image.src = url;
        });
        if (signal?.aborted) { close(); throw aborted(); }
        return { image, width: image.naturalWidth, height: image.naturalHeight, close };
    } catch (error) { close(); throw error; }
}

/** Convert pointer coordinates to actual image pixels, independent of preview size. */
export function imagePointFromClient(clientX, clientY, bounds, width, height) {
    if (!(bounds.width > 0 && bounds.height > 0 && width > 0 && height > 0)) throw RangeError('Kích thước ảnh không hợp lệ.');
    return { x: clamp((clientX - bounds.left) * width / bounds.width, 0, width), y: clamp((clientY - bounds.top) * height / bounds.height, 0, height) };
}

/** Round outward so the exported crop includes the entire selected pixel area. */
export function normalizeCropRect(rect, width, height) {
    if (!rect || !(width > 0 && height > 0) || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width < 1 || rect.height < 1) return null;
    const x = clamp(Math.floor(rect.x + 1e-7), 0, width), y = clamp(Math.floor(rect.y + 1e-7), 0, height);
    const right = clamp(Math.ceil(rect.x + rect.width - 1e-7), 0, width), bottom = clamp(Math.ceil(rect.y + rect.height - 1e-7), 0, height);
    if (right <= x || bottom <= y) return null;
    return { x, y, width: right - x, height: bottom - y };
}

export function createImageCropper({ document: doc = globalThis.document } = {}) {
    const win = doc.defaultView;
    let active = null, destroyed = false, drag = null;
    const removers = [];
    const listen = (target, event, handler, options) => { target.addEventListener(event, handler, options); removers.push(() => target.removeEventListener(event, handler, options)); };
    const make = (tag, text, className) => { const el = doc.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; };
    const button = (id, text) => { const el = make('button', text); el.id = id; el.type = 'button'; return el; };
    const dialog = make('dialog', null, 'image-crop-dialog'); dialog.id = 'imgCropDialog'; dialog.setAttribute('aria-labelledby', 'imgCropTitle');
    const heading = make('div', null, 'image-crop-head');
    const title = make('h2', 'Chọn vùng ảnh cần hỏi'); title.id = 'imgCropTitle';
    const help = make('p', 'Kéo chuột hoặc ngón tay để chọn vùng. Kéo góc để chỉnh, kéo giữa vùng để di chuyển.'); help.id = 'imgCropHelp';
    heading.append(title, help);
    const body = make('div', null, 'image-crop-body');
    const surface = make('div', null, 'image-crop-surface'); surface.id = 'imgCropSurface'; surface.tabIndex = 0; surface.setAttribute('role', 'group'); surface.setAttribute('aria-label', 'Vùng ảnh để chọn và cắt'); surface.setAttribute('aria-describedby', 'imgCropHelp imgCropKeyboard');
    const preview = doc.createElement('canvas'); preview.id = 'imgCropCanvas'; preview.setAttribute('aria-hidden', 'true');
    const selection = make('div', null, 'image-crop-selection'); selection.id = 'imgCropSelection'; selection.hidden = true;
    for (const [corner, label] of [['nw', 'trên trái'], ['ne', 'trên phải'], ['sw', 'dưới trái'], ['se', 'dưới phải']]) {
        const handle = button('', ''); handle.removeAttribute('id'); handle.dataset.cropHandle = corner; handle.className = 'image-crop-handle'; handle.setAttribute('aria-label', 'Chỉnh góc ' + label); selection.append(handle);
    }
    surface.append(preview, selection); body.append(surface);
    const dimensions = make('p', 'Chưa chọn vùng.', 'image-crop-dimensions'); dimensions.id = 'imgCropDimensions';
    const keyboard = make('p', 'Có thể nhập tọa độ bên dưới. Trên vùng ảnh, Enter tạo vùng chọn; phím mũi tên di chuyển, Shift + mũi tên di chuyển 10 px.', 'image-crop-keyboard'); keyboard.id = 'imgCropKeyboard';
    const fields = make('div', null, 'image-crop-fields');
    const inputs = {};
    for (const [key, label, id] of [['x', 'Trái (px)', 'imgCropX'], ['y', 'Trên (px)', 'imgCropY'], ['width', 'Rộng (px)', 'imgCropWidth'], ['height', 'Cao (px)', 'imgCropHeight']]) {
        const wrapper = make('label', label); const input = doc.createElement('input'); input.id = id; input.type = 'number'; input.inputMode = 'numeric'; input.step = '1'; input.min = key === 'x' || key === 'y' ? '0' : '1'; wrapper.htmlFor = id; wrapper.append(input); fields.append(wrapper); inputs[key] = input;
    }
    const error = make('p', null, 'image-crop-error'); error.id = 'imgCropError'; error.setAttribute('role', 'alert'); error.hidden = true;
    body.append(dimensions, keyboard, fields, error);
    const actions = make('div', null, 'image-crop-actions');
    const confirm = button('imgCropConfirm', 'Dùng vùng đã chọn'); confirm.className = 'image-crop-primary'; confirm.disabled = true;
    const full = button('imgCropFull', 'Dùng toàn ảnh'), reset = button('imgCropReset', 'Chọn lại vùng'), cancelButton = button('imgCropCancel', 'Hủy');
    actions.append(confirm, full, reset, cancelButton); dialog.append(heading, body, actions); doc.body.append(dialog);

    const live = op => active === op && !op.closed && !destroyed;
    function finish(op, value = null, failure = null) {
        if (!op || op.closed) return;
        op.closed = true;
        op.abortController.abort();
        op.signal?.removeEventListener('abort', op.onAbort);
        op.resource?.close(); op.resource = null;
        if (active === op) {
            active = null;
            if (drag) { try { if (surface.hasPointerCapture(drag.id)) surface.releasePointerCapture(drag.id); } catch { /* The browser may already have released it. */ } }
            drag = null;
            if (dialog.open) dialog.close();
            preview.width = 1; preview.height = 1;
            selection.hidden = true;
            doc.body.style.overflow = op.overflow;
            if (op.focus?.isConnected) { try { op.focus.focus({ preventScroll: true }); } catch { op.focus.focus(); } }
        }
        if (failure) op.reject(failure); else op.resolve(value);
    }
    const cancel = () => finish(active);
    function render() {
        const op = active;
        if (!op?.resource) return;
        op.invalidFields = false;
        const { width, height } = op.resource;
        const rect = normalizeCropRect(op.rect, width, height);
        selection.hidden = !rect;
        if (rect) {
            selection.style.left = (rect.x / width * 100) + '%'; selection.style.top = (rect.y / height * 100) + '%';
            selection.style.width = (rect.width / width * 100) + '%'; selection.style.height = (rect.height / height * 100) + '%';
            dimensions.textContent = `Vùng chọn: ${rect.width} × ${rect.height} px · ảnh gốc ${width} × ${height} px`;
        } else dimensions.textContent = `Ảnh gốc ${width} × ${height} px. Chưa chọn vùng.`;
        const values = rect || { x: 0, y: 0, width, height };
        for (const key of Object.keys(inputs)) {
            inputs[key].value = values[key]; inputs[key].max = key === 'x' ? width - 1 : key === 'y' ? height - 1 : key === 'width' ? width : height;
            inputs[key].disabled = op.encoding;
        }
        confirm.disabled = !rect || op.encoding; full.disabled = op.encoding; reset.disabled = op.encoding;
        dialog.setAttribute('aria-busy', String(Boolean(op.encoding)));
    }
    function resize() {
        const op = active;
        if (!op?.resource || !dialog.open) return;
        const viewport = win.visualViewport;
        const viewWidth = viewport?.width || win.innerWidth, viewHeight = viewport?.height || win.innerHeight;
        dialog.style.setProperty('--crop-view-height', Math.floor(viewHeight) + 'px');
        dialog.style.setProperty('--crop-view-width', Math.floor(viewWidth) + 'px');
        dialog.style.setProperty('--crop-view-left', (viewport?.offsetLeft || 0) + 'px');
        dialog.style.setProperty('--crop-view-top', (viewport?.offsetTop || 0) + 'px');
        const padding = win.getComputedStyle(body);
        const available = body.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight);
        const width = Math.max(1, Math.min(1000, available || viewWidth - 56, Math.max(140, viewHeight * .48) * op.resource.width / op.resource.height));
        surface.style.width = width + 'px';
    }
    const point = event => imagePointFromClient(event.clientX, event.clientY, surface.getBoundingClientRect(), active.resource.width, active.resource.height);
    function pointerStart(event) {
        const op = active;
        if (!op?.resource || op.encoding || drag || event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return;
        event.preventDefault();
        const p = point(event), rect = normalizeCropRect(op.rect, op.resource.width, op.resource.height);
        const corner = event.target.closest?.('[data-crop-handle]')?.dataset.cropHandle;
        const inside = rect && p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
        drag = { id: event.pointerId, previous: op.rect ? { ...op.rect } : null, start: p, mode: corner ? 'resize' : inside ? 'move' : 'new', rect };
        if (corner && rect) drag.anchor = { x: corner.includes('w') ? rect.x + rect.width : rect.x, y: corner.includes('n') ? rect.y + rect.height : rect.y };
        else if (!inside) { drag.anchor = p; op.rect = null; }
        try { surface.setPointerCapture(event.pointerId); } catch { /* Window events also finish the drag. */ }
        surface.focus({ preventScroll: true }); render();
    }
    function pointerMove(event) {
        if (!drag || event.pointerId !== drag.id || !active?.resource) return;
        event.preventDefault();
        const p = point(event), { width, height } = active.resource;
        if (drag.mode === 'move') active.rect = { ...drag.rect, x: clamp(drag.rect.x + p.x - drag.start.x, 0, width - drag.rect.width), y: clamp(drag.rect.y + p.y - drag.start.y, 0, height - drag.rect.height) };
        else active.rect = { x: Math.min(drag.anchor.x, p.x), y: Math.min(drag.anchor.y, p.y), width: Math.abs(drag.anchor.x - p.x), height: Math.abs(drag.anchor.y - p.y) };
        render();
    }
    function pointerEnd(event) {
        if (!drag || event.pointerId !== drag.id) return;
        if (event.type === 'pointercancel' && active) active.rect = drag.previous;
        const id = drag.id; drag = null;
        try { if (surface.hasPointerCapture(id)) surface.releasePointerCapture(id); } catch { /* Browser may have released it already. */ }
        render();
    }
    listen(surface, 'pointerdown', pointerStart);
    listen(win, 'pointermove', pointerMove, { passive: false }); listen(win, 'pointerup', pointerEnd); listen(win, 'pointercancel', pointerEnd);
    listen(surface, 'lostpointercapture', event => pointerEnd({ pointerId: event.pointerId, type: 'pointercancel' }));
    listen(surface, 'keydown', event => {
        const op = active;
        if (!op?.resource || op.encoding) return;
        const rect = normalizeCropRect(op.rect, op.resource.width, op.resource.height), step = event.shiftKey ? 10 : 1;
        if (!rect && ['Enter', ' '].includes(event.key)) {
            event.preventDefault(); op.rect = { x: op.resource.width / 4, y: op.resource.height / 4, width: op.resource.width / 2, height: op.resource.height / 2 }; render(); return;
        }
        if (!rect || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const corner = event.target.dataset.cropHandle;
        if (corner) {
            const anchor = { x: corner.includes('w') ? rect.x + rect.width : rect.x, y: corner.includes('n') ? rect.y + rect.height : rect.y };
            let x = corner.includes('w') ? rect.x : rect.x + rect.width, y = corner.includes('n') ? rect.y : rect.y + rect.height;
            x = clamp(x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), 0, op.resource.width);
            y = clamp(y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0), 0, op.resource.height);
            op.rect = { x: Math.min(anchor.x, x), y: Math.min(anchor.y, y), width: Math.abs(x - anchor.x), height: Math.abs(y - anchor.y) };
        } else op.rect = { ...rect, x: clamp(rect.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), 0, op.resource.width - rect.width), y: clamp(rect.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0), 0, op.resource.height - rect.height) };
        render();
    });
    for (const input of Object.values(inputs)) listen(input, 'input', () => {
        const op = active; if (!op?.resource || op.encoding) return;
        const values = Object.fromEntries(Object.entries(inputs).map(([key, field]) => [key, field.valueAsNumber]));
        if (!Object.values(values).every(Number.isFinite)) {
            op.invalidFields = true; confirm.disabled = true; error.textContent = 'Nhập đủ tọa độ và kích thước bằng số.'; error.hidden = false; return;
        }
        error.hidden = true;
        const { width, height } = op.resource;
        const x = clamp(values.x, 0, width - 1), y = clamp(values.y, 0, height - 1);
        op.rect = { x, y, width: clamp(values.width, 1, width - x), height: clamp(values.height, 1, height - y) }; render();
    });
    listen(reset, 'click', () => { if (active && !active.encoding) { active.rect = null; error.hidden = true; render(); surface.focus(); } });
    listen(cancelButton, 'click', cancel); listen(dialog, 'cancel', event => { event.preventDefault(); cancel(); });
    listen(dialog, 'close', () => { if (active?.opened && !dialog.open) cancel(); });
    listen(full, 'click', () => { if (active && !active.encoding) finish(active, active.blob); });
    listen(confirm, 'click', async () => {
        const op = active;
        if (!op?.resource || op.encoding || op.invalidFields) return;
        const rect = normalizeCropRect(op.rect, op.resource.width, op.resource.height); if (!rect) return;
        op.encoding = true; error.hidden = true; render();
        try {
            const canvas = doc.createElement('canvas'); canvas.width = rect.width; canvas.height = rect.height;
            canvas.getContext('2d').drawImage(op.resource.image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
            const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error('Chưa cắt được ảnh. Hãy chọn lại vùng.')), 'image/png'));
            canvas.width = 1; canvas.height = 1;
            if (live(op)) finish(op, blob);
        } catch (failure) {
            if (live(op)) { op.encoding = false; error.textContent = failure.message || 'Chưa cắt được ảnh. Hãy thử lại.'; error.hidden = false; render(); }
        }
    });
    listen(win, 'resize', resize); if (win.visualViewport) { listen(win.visualViewport, 'resize', resize); listen(win.visualViewport, 'scroll', resize); }

    function edit(blob, { signal } = {}) {
        cancel();
        if (destroyed || signal?.aborted) return Promise.resolve(null);
        return new Promise((resolve, reject) => {
            const op = { blob, resolve, reject, signal, closed: false, opened: false, rect: null, resource: null, encoding: false, abortController: new win.AbortController(), focus: doc.activeElement, overflow: doc.body.style.overflow };
            active = op; op.onAbort = () => finish(op); signal?.addEventListener('abort', op.onAbort, { once: true });
            (async () => {
                if (!blob || !SUPPORTED_TYPES.has(blob.type)) throw Error('Chọn ảnh PNG, JPG hoặc WebP.');
                if (blob.size > MAX_SOURCE_BYTES) throw Error('Ảnh gốc tối đa 8 MB. Hãy chọn ảnh chụp nhỏ hơn.');
                const decoded = await decodeImageBlob(blob, { document: doc, signal: op.abortController.signal });
                if (!live(op)) { decoded.close(); return; }
                op.resource = decoded;
                if (!decoded.width || !decoded.height || decoded.width * decoded.height > MAX_PIXELS) throw Error('Ảnh quá lớn. Hãy chọn ảnh dưới 25 triệu điểm ảnh.');
                const scale = Math.min(1, 1000 / decoded.width, 650 / decoded.height);
                preview.width = Math.max(1, Math.round(decoded.width * scale)); preview.height = Math.max(1, Math.round(decoded.height * scale));
                preview.getContext('2d').drawImage(decoded.image, 0, 0, preview.width, preview.height);
                error.hidden = true; doc.body.style.overflow = 'hidden'; dialog.showModal(); op.opened = true; resize(); render(); surface.focus({ preventScroll: true });
            })().catch(failure => { if (live(op)) finish(op, null, failure); });
        });
    }
    return { edit, cancel, destroy() { if (destroyed) return; cancel(); destroyed = true; removers.forEach(remove => remove()); dialog.remove(); } };
}
