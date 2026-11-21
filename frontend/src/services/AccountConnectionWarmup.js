import { accountService } from './AccountService.js';

// Start waking the account server while a visitor reads the rendered page.
// This runs once for this visit, without recurring keepalives or session refresh.
export function warmAccountConnection({ account = accountService, page = globalThis.document, view = globalThis.window } = {}) {
    if (!account.configured || !page || !view || typeof account.prepareConnection !== 'function') return () => {};
    let stopped = false, attempted = false, frame = null, timer = null, controller;
    const visible = () => page.visibilityState === 'visible' && page.prerendering !== true;
    const cancelScheduled = () => {
        if (frame !== null) { view.cancelAnimationFrame?.(frame); frame = null; }
        if (timer !== null) { view.clearTimeout(timer); timer = null; }
    };
    const removeVisibilityListeners = () => {
        page.removeEventListener('visibilitychange', schedule);
        page.removeEventListener('prerenderingchange', schedule);
    };
    const stop = () => {
        if (stopped) return;
        stopped = true;
        cancelScheduled();
        removeVisibilityListeners();
        view.removeEventListener('pagehide', stop);
        controller?.abort();
    };
    const begin = () => {
        timer = null;
        if (stopped || attempted || !visible()) return;
        attempted = true;
        removeVisibilityListeners();
        controller = new AbortController();
        void Promise.resolve().then(() => {
            if (!controller.signal.aborted) return account.prepareConnection({ signal: controller.signal });
        }).catch(() => {
            // Connection errors belong to a later explicit account action.
            // Reading the public page must remain independent of this prefetch.
        }).finally(() => view.removeEventListener('pagehide', stop));
    };
    function schedule() {
        if (stopped || attempted || frame !== null || timer !== null || !visible()) return;
        // Yield a render opportunity before starting any background request.
        if (typeof view.requestAnimationFrame === 'function') frame = view.requestAnimationFrame(() => {
            frame = null;
            if (!stopped) timer = view.setTimeout(begin, 0);
        });
        else timer = view.setTimeout(begin, 0);
    }
    page.addEventListener('visibilitychange', schedule);
    page.addEventListener('prerenderingchange', schedule);
    view.addEventListener('pagehide', stop, { once: true });
    schedule();
    return stop;
}
