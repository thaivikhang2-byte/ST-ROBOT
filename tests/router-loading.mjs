import assert from 'node:assert/strict';
import { Router } from '../frontend/src/router/Router.js';

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const location = pathname => Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { pathname } } });
try {
    // Exact paths, base directories, omitted index names and unknown pages retain their old fallback.
    for (const [pathname, expected] of [
        ['/frontend/public/quiz.html', 'quiz'], ['/frontend/public/index.html', 'home'],
        ['/frontend/public/', 'home'], ['/frontend/public', 'home'],
        ['/frontend/public/account.html', 'home'], ['/unmatched', 'home'],
    ]) {
        location(pathname);
        const loaded = [], initialized = [];
        const route = (path, name) => ({ path, loadController: async () => {
            loaded.push(name);
            return class { init() { initialized.push(name); } };
        } });
        const router = new Router([route('/frontend/public/index.html', 'home'), route('/frontend/public/quiz.html', 'quiz')]);
        await router.init();
        assert.deepEqual(loaded, [expected]);
        assert.deepEqual(initialized, [expected]);
    }

    // A matching directory route still wins over the generic homepage fallback.
    location('/learning');
    const initialized = [];
    await new Router([
        { path: '/public/index.html', loadController: () => { throw Error('Must not load fallback for a matched directory'); } },
        { path: '/learning/index.html', loadController: async () => class { init() { initialized.push('learning'); } } },
    ]).init();
    assert.deepEqual(initialized, ['learning']);

    // Module loading finishes before construction; await init also observes an async controller.
    location('/quiz.html');
    const module = deferred(), finish = deferred(), stages = [];
    const router = new Router([{ path: '/quiz.html', loadController: () => { stages.push('load'); return module.promise; } }]);
    const initializing = router.init();
    assert.deepEqual(stages, ['load']);
    module.resolve(class {
        constructor() { stages.push('construct'); }
        async init() { stages.push('init'); await finish.promise; stages.push('complete'); return 'initialized'; }
    });
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(stages, ['load', 'construct', 'init']);
    finish.resolve();
    assert.equal(await initializing, 'initialized');
    assert.deepEqual(stages, ['load', 'construct', 'init', 'complete']);

    // Existing injected eager controllers retain synchronous construction and init.
    location('/legacy.html');
    const legacy = [];
    const result = new Router([{ path: '/legacy.html', controller: class {
        constructor() { legacy.push('construct'); }
        init() { legacy.push('init'); }
    } }]).init();
    assert.deepEqual(legacy, ['construct', 'init']);
    await result;

    // Missing routes are inert and loader errors remain observable to their caller.
    location('/none.html');
    assert.equal(await new Router([]).init(), undefined);
    location('/broken.html');
    await assert.rejects(new Router([{ path: '/broken.html', loadController: async () => { throw Error('fixture import failure'); } }]).init(), /fixture import failure/);
} finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete globalThis.window;
}
console.log('PASS route-specific loading, exact/base/trailing-slash/fallback paths, controller lifecycle and eager compatibility');
