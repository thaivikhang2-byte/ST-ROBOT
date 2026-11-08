const POSITION_KEY = 'strobot.learning.tutor.position.v1';
const MARGIN = 12;
const GAP = 10;
const DRAG_THRESHOLD = 6;
const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));

/** Keep the lesson tutor beside a movable launcher without taking lesson space. */
export function createFloatingTutor({ panel, launcher, handle, closeButton }) {
    if (!panel || !launcher || !handle || !closeButton) {
        throw new TypeError('Floating tutor requires a panel, launcher, drag handle and close button.');
    }
    const doc = panel.ownerDocument;
    const view = doc.defaultView;
    const listeners = [];
    let destroyed = false;
    let drag = null;
    let suppressClick = null;
    let alignment = { right: true, above: true };
    let position = { x: 0, y: 0 };

    const listen = (target, name, listener, options) => {
        target.addEventListener(name, listener, options);
        listeners.push(() => target.removeEventListener(name, listener, options));
    };
    const viewport = () => {
        const visual = view.visualViewport;
        return {
            x: visual?.offsetLeft || 0,
            y: visual?.offsetTop || 0,
            width: visual?.width || view.innerWidth,
            height: visual?.height || view.innerHeight
        };
    };
    const launcherSize = () => {
        const rect = launcher.getBoundingClientRect();
        return { width: rect.width || 56, height: rect.height || 56 };
    };
    const defaults = () => {
        const bounds = viewport();
        const size = launcherSize();
        return { x: bounds.x + bounds.width - size.width - MARGIN, y: bounds.y + bounds.height - size.height - MARGIN };
    };
    const savePosition = () => {
        const bounds = viewport();
        const size = launcherSize();
        try {
            view.localStorage.setItem(POSITION_KEY, JSON.stringify({
                version: 1,
                x: clamp((position.x - bounds.x - MARGIN) / Math.max(1, bounds.width - size.width - MARGIN * 2), 0, 1),
                y: clamp((position.y - bounds.y - MARGIN) / Math.max(1, bounds.height - size.height - MARGIN * 2), 0, 1)
            }));
        } catch { /* Moving the tutor still works when browser storage is unavailable. */ }
    };
    const restorePosition = () => {
        position = defaults();
        try {
            const raw = view.localStorage.getItem(POSITION_KEY);
            if (!raw || raw.length > 200) return;
            const saved = JSON.parse(raw);
            if (saved?.version !== 1 || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)
                || saved.x < 0 || saved.x > 1 || saved.y < 0 || saved.y > 1) return;
            const bounds = viewport();
            const size = launcherSize();
            position = {
                x: bounds.x + MARGIN + saved.x * Math.max(0, bounds.width - size.width - MARGIN * 2),
                y: bounds.y + MARGIN + saved.y * Math.max(0, bounds.height - size.height - MARGIN * 2)
            };
        } catch { /* Ignore stale, corrupt or blocked storage. */ }
    };
    const chooseAlignment = () => {
        const bounds = viewport();
        const size = launcherSize();
        alignment = {
            right: position.x + size.width / 2 >= bounds.x + bounds.width / 2,
            above: position.y + size.height / 2 >= bounds.y + bounds.height / 2
        };
    };
    const render = () => {
        const bounds = viewport();
        const size = launcherSize();
        panel.style.setProperty('--tutor-viewport-width', `${bounds.width}px`);
        panel.style.setProperty('--tutor-viewport-height', `${bounds.height}px`);
        panel.toggleAttribute('data-compact', bounds.height < 560);
        let panelX = 0;
        let panelY = 0;
        let panelWidth = 0;
        let panelHeight = 0;
        if (!panel.hidden) {
            const rect = panel.getBoundingClientRect();
            panelWidth = rect.width;
            panelHeight = rect.height;
            panelX = alignment.right ? size.width - panelWidth : 0;
            panelY = alignment.above ? -panelHeight - GAP : size.height + GAP;
            panel.style.setProperty('--tutor-panel-height', `${panelHeight}px`);
        }
        // Clamp the whole open widget, including the launcher, to the visible viewport.
        position.x = clamp(position.x,
            bounds.x + MARGIN - Math.min(0, panelX),
            bounds.x + bounds.width - MARGIN - Math.max(size.width, panelX + panelWidth));
        position.y = clamp(position.y,
            bounds.y + MARGIN - Math.min(0, panelY),
            bounds.y + bounds.height - MARGIN - Math.max(size.height, panelY + panelHeight));
        for (const [element, x, y] of [[launcher, position.x, position.y], [panel, position.x + panelX, position.y + panelY]]) {
            element.style.left = `${Math.round(x)}px`;
            element.style.top = `${Math.round(y)}px`;
            element.style.right = 'auto';
            element.style.bottom = 'auto';
        }
    };
    const focus = element => element.focus({ preventScroll: true });
    const open = () => {
        if (destroyed || !panel.hidden) return;
        chooseAlignment();
        panel.hidden = false;
        launcher.setAttribute('aria-expanded', 'true');
        render();
        // Focusing the handle announces the dialog without opening a mobile keyboard.
        focus(handle);
    };
    const close = () => {
        if (destroyed || panel.hidden) return;
        panel.hidden = true;
        launcher.setAttribute('aria-expanded', 'false');
        render();
        focus(launcher);
    };
    const toggle = () => panel.hidden ? open() : close();
    const finishDrag = event => {
        if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.id)) return;
        const completed = drag;
        drag = null;
        completed.source.classList.remove('is-dragging');
        panel.classList.remove('is-dragging');
        try {
            if (completed.source.hasPointerCapture(completed.id)) completed.source.releasePointerCapture(completed.id);
        } catch { /* Capture may already have been released by the browser. */ }
        if (completed.active) {
            suppressClick = { source: completed.source, until: view.performance.now() + 500 };
            savePosition();
        }
    };
    const startDrag = event => {
        if (destroyed || drag || !event.isPrimary || event.button !== 0) return;
        const source = event.currentTarget;
        const control = event.target.closest?.('button, a, input, textarea, select, [contenteditable="true"]');
        if (control && control !== source) return;
        drag = {
            id: event.pointerId, source, startX: event.clientX, startY: event.clientY,
            x: position.x, y: position.y, active: false
        };
        try { source.setPointerCapture(event.pointerId); } catch { /* Window listeners also finish a drag outside the handle. */ }
    };
    const moveDrag = event => {
        if (!drag || event.pointerId !== drag.id) return;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (!drag.active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        drag.active = true;
        drag.source.classList.add('is-dragging');
        panel.classList.add('is-dragging');
        event.preventDefault();
        position = { x: drag.x + dx, y: drag.y + dy };
        render();
    };
    const preventDragClick = event => {
        if (event.detail !== 0 && suppressClick?.source === event.currentTarget && view.performance.now() < suppressClick.until) {
            event.preventDefault();
            event.stopImmediatePropagation();
            suppressClick = null;
        }
    };
    const moveWithKeyboard = event => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (event.key === 'Home') {
            event.preventDefault();
            position = defaults();
            chooseAlignment();
        } else if (directions[event.key]) {
            event.preventDefault();
            const [dx, dy] = directions[event.key];
            const distance = event.shiftKey ? 40 : 10;
            position.x += dx * distance;
            position.y += dy * distance;
        } else return;
        render();
        savePosition();
    };

    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    launcher.setAttribute('aria-expanded', 'false');
    if (panel.id) launcher.setAttribute('aria-controls', panel.id);
    for (const source of [launcher, handle]) {
        listen(source, 'pointerdown', startDrag);
        listen(source, 'lostpointercapture', finishDrag);
        listen(source, 'click', preventDragClick, true);
        listen(source, 'keydown', moveWithKeyboard);
    }
    listen(launcher, 'click', toggle);
    listen(closeButton, 'click', close);
    listen(view, 'pointermove', moveDrag, { passive: false });
    listen(view, 'pointerup', finishDrag);
    listen(view, 'pointercancel', finishDrag);
    listen(view, 'blur', () => finishDrag());
    listen(doc, 'keydown', event => {
        if (event.key === 'Escape' && !event.defaultPrevented && !panel.hidden) {
            // Let the page's PDF/import dialogs keep their own Escape behavior.
            const modalOpen = doc.querySelector('dialog[open]') || [...doc.querySelectorAll('[aria-modal="true"]')]
                .some(element => element !== panel && element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length);
            if (modalOpen) return;
            event.preventDefault();
            close();
        }
    });
    const resize = () => { finishDrag(); render(); };
    listen(view, 'resize', resize);
    if (view.visualViewport) {
        listen(view.visualViewport, 'resize', resize);
        listen(view.visualViewport, 'scroll', resize);
    }
    restorePosition();
    render();

    return {
        open, close, toggle,
        destroy() {
            if (destroyed) return;
            finishDrag();
            destroyed = true;
            listeners.forEach(remove => remove());
            panel.hidden = true;
            launcher.setAttribute('aria-expanded', 'false');
        }
    };
}
