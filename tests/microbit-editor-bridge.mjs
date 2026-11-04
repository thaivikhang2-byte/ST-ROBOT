import assert from 'node:assert/strict';
import { MicrobitEditorBridge, MICROBIT_EDITOR_ORIGIN, MICROBIT_EDITOR_STORAGE_PREFIX, normalizeMicrobitProject } from '../frontend/src/modules/learning/MicrobitEditorBridge.js';

const key = lesson => `${MICROBIT_EDITOR_STORAGE_PREFIX}${lesson}`;
const source = '# Đếm số lần bấm nút\nfrom microbit import *\ndisplay.scroll("Xin chào")\n';
const project = (code = source) => ({ files: { 'main.py': Buffer.from(code).toString('base64') }, projectName: 'Bộ đếm nút' });
const envelope = (lesson, value = project()) => JSON.stringify({ version: 1, courseId: 'microbit', lessonId: lesson, savedAt: 1, project: value });
function environment(values = new Map()) {
    const listeners = new Set();
    const storage = {
        getItem: name => values.get(name) ?? null,
        setItem: (name, value) => values.set(name, value),
        removeItem: name => values.delete(name)
    };
    const window = {
        addEventListener(type, listener) { assert.equal(type, 'message'); listeners.add(listener); },
        removeEventListener(type, listener) { assert.equal(type, 'message'); listeners.delete(listener); }
    };
    const newFrame = () => ({ isConnected: true, contentWindow: { sent: [], postMessage(data, origin) { this.sent.push({ data, origin }); } } });
    const statuses = [];
    const frame = newFrame();
    const bridge = new MicrobitEditorBridge({ window, storage });
    const attach = (lesson = 'matrix', target = frame) => bridge.attach(target, { courseId: 'microbit', lessonId: lesson, code: source, title: 'Ma trận LED', onStatus: (message, state) => statuses.push({ message, state }) });
    const emit = (data, { origin = MICROBIT_EDITOR_ORIGIN, sender = frame.contentWindow } = {}) => {
        for (const listener of [...listeners]) listener({ origin, source: sender, data });
    };
    const message = (action, rest = {}, opts) => emit({ type: 'pyeditor', action, ...rest }, opts);
    const ready = (opts) => { message('workspacesync', {}, opts); message('workspaceloaded', {}, opts); };
    return { values, listeners, storage, window, frame, newFrame, bridge, attach, emit, message, ready, statuses };
}

// Follow the official editor handshake; UTF-8 survives a full save/reload.
{
    const e = environment();
    assert.equal(e.attach(), e.bridge);
    assert.equal(e.listeners.size, 1);
    assert.equal(e.statuses.at(-1).state, 'loading');
    assert.equal(e.bridge.getSource(), null);
    e.message('workspacesave', { project: project('too early') });
    assert.equal(e.values.size, 0, 'A save before workspace initialization must be ignored');
    e.message('workspacesync');
    assert.deepEqual(e.frame.contentWindow.sent, [{ data: { type: 'pyeditor', action: 'workspacesync', projects: [source] }, origin: MICROBIT_EDITOR_ORIGIN }]);
    e.message('workspacesync');
    assert.equal(e.frame.contentWindow.sent.length, 1, 'Repeated sync must not send an unsupported action after initialization');
    e.message('workspacesave', { project: project('still too early') });
    assert.equal(e.values.size, 0);
    e.message('workspaceloaded');
    assert.equal(e.bridge.getSource(), source);
    const edited = `${source}display.scroll("Việt Nam 🚀")\n`;
    const incoming = project(edited);
    incoming.files['helper.py'] = Buffer.from('def count(x):\n    return x + 1\n').toString('base64');
    incoming.untrustedMetadata = '<script>throw new Error("do not execute")</script>';
    e.message('workspacesave', { project: incoming });
    assert.equal(e.bridge.getSource(), edited);
    assert.equal(e.statuses.at(-1).state, 'saved');
    const record = JSON.parse(e.values.get(key('matrix')));
    assert.equal(record.courseId, 'microbit');
    assert.equal(record.lessonId, 'matrix');
    assert.equal(record.version, 1);
    assert.equal(record.project.files['helper.py'], incoming.files['helper.py']);
    assert.ok(!Object.hasOwn(record.project, 'untrustedMetadata'));
    assert.ok(Number.isSafeInteger(record.savedAt));
    const next = e.newFrame();
    e.attach('matrix', next);
    e.ready({ sender: next.contentWindow });
    assert.deepEqual(JSON.parse(JSON.stringify(next.contentWindow.sent[0].data.projects[0])), record.project);
    assert.equal(e.bridge.getSource(), edited);
    assert.equal(e.listeners.size, 1, 'Attaching again replaces the previous listener');
}

// Same-origin alone is insufficient: only the current editor WindowProxy is trusted.
{
    const e = environment();
    e.attach();
    for (const origin of ['https://evil.example', 'https://python.microbit.org.evil.example', 'http://python.microbit.org', 'null', '']) e.message('workspacesync', {}, { origin });
    e.message('workspacesync', {}, { sender: {} });
    e.emit({ type: 'wrong-editor', action: 'workspacesync' });
    e.emit(null);
    e.emit('workspacesync');
    e.message('importproject', { project: project() });
    assert.equal(e.frame.contentWindow.sent.length, 0);
    e.ready();
    e.message('workspacesave', { project: project('spoofed') }, { sender: {} });
    e.message('workspacesave', { project: project('spoofed') }, { origin: 'https://evil.example' });
    assert.equal(e.values.size, 0);
    assert.equal(e.bridge.getSource(), source);
    e.frame.isConnected = false;
    e.message('workspacesave', { project: project('removed iframe') });
    assert.equal(e.values.size, 0);
    e.bridge.destroy();
    assert.equal(e.listeners.size, 0);
}

// Moving between lessons retains separate projects and rejects late saves from the old iframe.
{
    const e = environment();
    e.values.set('unrelated-progress', 'keep');
    e.attach('matrix'); e.ready();
    e.message('workspacesave', { project: project('matrix source') });
    const next = e.newFrame();
    e.attach('buttons', next);
    e.message('workspacesync');
    e.message('workspacesave', { project: project('late old source') });
    assert.equal(next.contentWindow.sent.length, 0);
    e.ready({ sender: next.contentWindow });
    e.message('workspacesave', { project: project('buttons source') }, { sender: next.contentWindow });
    assert.equal(Buffer.from(JSON.parse(e.values.get(key('matrix'))).project.files['main.py'], 'base64').toString(), 'matrix source');
    assert.equal(Buffer.from(JSON.parse(e.values.get(key('buttons'))).project.files['main.py'], 'base64').toString(), 'buttons source');
    assert.equal(e.values.get('unrelated-progress'), 'keep');
    const count = e.values.size;
    e.bridge.destroy();
    e.message('workspacesave', { project: project('after destroy') }, { sender: next.contentWindow });
    assert.equal(e.values.size, count);
}

// Strict project bounds protect the parent; source is treated only as text.
{
    const e = environment(); e.attach(); e.ready();
    const invalid = [
        null, {}, { files: { 'helper.py': 'YQ==' } }, { files: [] },
        { files: { 'main.py': 'not base64' } }, { files: { 'main.py': 'YR==' } },
        { files: { 'main.py': '/w==' } },
        { files: { 'main.py': '', '../secret.py': '' } },
        { files: { 'main.py': '', 'folder/main.py': '' } },
        { files: { 'main.py': '', 'folder\\main.py': '' } },
        { files: { 'main.py': '', 'bad\u0000.py': '' } },
        JSON.parse('{"files":{"main.py":"","__proto__":""}}'),
        { files: { 'main.py': '', constructor: '' } },
        { files: { 'main.py': '' }, projectName: 'bad\nname' },
        { files: { 'main.py': '' }, projectName: { name: 'invalid' } },
        { files: Object.fromEntries([['main.py', ''], ...Array.from({ length: 16 }, (_, i) => [`f${i}.py`, ''])]) },
        project('x'.repeat(256 * 1024 + 1))
    ];
    for (const value of invalid) {
        assert.throws(() => normalizeMicrobitProject(value));
        e.message('workspacesave', { project: value });
        assert.equal(e.statuses.at(-1).state, 'invalid-project');
        assert.equal(e.values.size, 0);
    }
    const file = Buffer.alloc(256 * 1024).toString('base64');
    assert.throws(() => normalizeMicrobitProject({ files: { 'main.py': file, 'one.bin': file, 'two.bin': 'YQ==' } }));
    const neverExecute = 'globalThis.__microbitBridgeExecuted = true; <script>alert(1)</script>';
    e.message('workspacesave', { project: project(neverExecute) });
    assert.equal(e.bridge.getSource(), neverExecute);
    assert.equal(globalThis.__microbitBridgeExecuted, undefined);
    e.message('workspacesave', { project: project('') });
    assert.equal(e.bridge.getSource(), '', 'An intentionally empty file remains a valid learner project');
}

// Corruption stays recoverable: use a starter without silently overwriting the damaged record.
for (const raw of ['{broken', envelope('buttons'), envelope('matrix', { files: { 'main.py': '/w==' } }), 'x'.repeat(750001)]) {
    const e = environment(new Map([[key('matrix'), raw]])); e.attach(); e.ready();
    assert.equal(e.bridge.getSource(), source);
    assert.equal(e.frame.contentWindow.sent[0].data.projects[0], source);
    assert.equal(e.statuses.at(-1).state, 'corrupt');
    e.message('workspacesave', { project: project('recover this in memory') });
    assert.equal(e.bridge.getSource(), 'recover this in memory');
    assert.equal(e.values.get(key('matrix')), raw);
    assert.equal(e.statuses.at(-1).state, 'corrupt');
}

// Blocked reads, failed writes and quota errors never produce a saved claim.
{
    const e = environment(new Map([[key('matrix'), envelope('matrix', project('existing source'))]]));
    const previous = e.values.get(key('matrix'));
    e.storage.getItem = () => { throw new Error('SecurityError'); };
    e.attach(); e.ready();
    e.message('workspacesave', { project: project('new source') });
    assert.equal(e.values.get(key('matrix')), previous, 'A failed read must not allow a silent overwrite of an unknown existing project');
    assert.equal(e.statuses.at(-1).state, 'storage-error');
}
{
    const e = environment();
    e.storage.getItem = () => { throw new Error('SecurityError'); };
    e.storage.setItem = () => { throw new Error('QuotaExceededError'); };
    e.attach(); e.ready();
    assert.equal(e.statuses.at(-1).state, 'storage-error');
    e.message('workspacesave', { project: project('downloadable unsaved source') });
    assert.equal(e.bridge.getSource(), 'downloadable unsaved source');
    assert.equal(e.statuses.at(-1).state, 'storage-error');
    assert.ok(!e.statuses.some(status => status.state === 'saved'));
}
{
    const e = environment(); e.attach(); e.ready();
    e.storage.setItem = () => { throw new Error('QuotaExceededError'); };
    e.message('workspacesave', { project: project('first change') });
    assert.equal(e.statuses.at(-1).state, 'storage-error');
    e.storage.setItem = (name, value) => e.values.set(name, value);
    e.message('workspacesave', { project: project('second change') });
    assert.equal(e.statuses.at(-1).state, 'saved');
    assert.equal(e.bridge.getSource(), 'second change');
}

// Explicit reset deletes only this lesson and detaches before any late autosave.
{
    const e = environment(new Map([[key('matrix'), '{corrupt'], [key('buttons'), envelope('buttons')], ['quiz', 'keep']]));
    e.attach(); e.ready();
    assert.equal(e.bridge.clearSavedProject(), true);
    assert.equal(e.listeners.size, 0);
    assert.equal(e.values.has(key('matrix')), false);
    assert.equal(e.values.has(key('buttons')), true);
    assert.equal(e.values.get('quiz'), 'keep');
    e.message('workspacesave', { project: project('late old save') });
    assert.equal(e.values.has(key('matrix')), false);
    const fresh = e.newFrame(); e.attach('matrix', fresh); e.ready({ sender: fresh.contentWindow });
    assert.equal(fresh.contentWindow.sent[0].data.projects[0], source);
    assert.equal(e.bridge.getSource(), source);
    e.storage.removeItem = () => { throw new Error('SecurityError'); };
    assert.equal(e.bridge.clearSavedProject(), false);
    assert.equal(e.listeners.size, 1, 'Failed reset must leave the current editor available');
    assert.equal(e.statuses.at(-1).state, 'storage-error');
    e.bridge.destroy();
    assert.equal(e.bridge.clearSavedProject(), false);
}

{
    const e = environment();
    for (const lesson of ['../matrix', '__proto__', 'unknown', '']) assert.throws(() => e.attach(lesson));
    assert.throws(() => e.bridge.attach(e.frame, { courseId: 'arduino', lessonId: 'matrix', code: source }));
    assert.throws(() => e.bridge.attach({ contentWindow: null }, { courseId: 'microbit', lessonId: 'matrix', code: source }));
    const blocked = { addEventListener: e.window.addEventListener, removeEventListener: e.window.removeEventListener, get localStorage() { throw new Error('SecurityError'); } };
    const bridge = new MicrobitEditorBridge({ window: blocked });
    const states = [];
    bridge.attach(e.frame, { courseId: 'microbit', lessonId: 'matrix', code: source, onStatus: (_, state) => states.push(state) });
    e.ready();
    assert.equal(states.at(-1), 'storage-error');
    bridge.destroy();
}

// Official unnamed projects carry an own undefined projectName across postMessage.
{
    const e = environment(); e.attach(); e.ready();
    const actualProject = { ...project('print("unnamed official project")'), projectName: undefined };
    e.message('workspacesave', { project: actualProject });
    assert.equal(e.statuses.at(-1).state, 'saved');
    const stored = JSON.parse(e.values.get(key('matrix')));
    assert.equal(Object.hasOwn(stored.project, 'projectName'), false);
    assert.equal(e.bridge.getSource(), 'print("unnamed official project")');
    e.bridge.destroy();
}

console.log('Micro:bit editor bridge: handshake, UTF-8 persistence, lesson isolation, origin/source checks, project validation, storage failures and reset passed.');
