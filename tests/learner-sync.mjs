import assert from 'node:assert/strict';
import { LearnerSyncService, LEARNER_WORKSPACE_PREFIX } from '../frontend/src/services/LearnerSyncService.js';

const COURSE = 'strobot.original.course.v3';
const QUIZ = 'strobot.quiz.history.v1';
const ASSESSMENT = 'strobot.assessment.v1';
const copy = value => JSON.parse(JSON.stringify(value));
const user = id => ({ id, isEmailVerified: true });
function memoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => { values.set(key, String(value)); },
        removeItem: key => { values.delete(key); }, values
    };
}
function account(initialUser, snapshots = {}) {
    const listeners = new Set();
    return {
        user: initialUser, snapshots: copy(snapshots), calls: [], online: true,
        ready() { return Promise.resolve(this.user); },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        change(next) { this.user = next; for (const fn of listeners) fn(next); },
        async request(path, options = {}) {
            const owner = this.user.id;
            this.calls.push({ owner, path, ...copy(options) });
            if (!this.online) throw new Error('offline');
            const state = this.snapshots[owner] ||= { revision: 0, values: {}, updatedAt: null };
            if (options.method === 'PUT') {
                if (options.body.revision !== state.revision) throw Object.assign(new Error('conflict'), { status: 409 });
                this.snapshots[owner] = { revision: state.revision + 1, values: copy(options.body.values), updatedAt: new Date().toISOString() };
            }
            return copy(this.snapshots[owner]);
        }
    };
}
const make = (auth, storage = memoryStorage()) => new LearnerSyncService({ account: auth, storage,
    window: null, events: null, debounceMs: 60000, retryMs: 60000 });
const tick = () => new Promise(resolve => setImmediate(resolve));
const waitForSave = (auth, edit) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Automatic learner synchronization did not save')), 2000);
    const request = auth.request.bind(auth);
    auth.request = async (path, options) => {
        const result = await request(path, options);
        if (options?.method === 'PUT') { clearTimeout(timeout); resolve(result); }
        return result;
    };
    edit();
});

// Editing an owned journal reaches the account without a manual sync call.
{
    const auth = account(user('alice'));
    const sync = new LearnerSyncService({ account: auth, storage: memoryStorage(),
        events: null, window: null, debounceMs: 5, retryMs: 60000 });
    await sync.ready();
    await waitForSave(auth, () => sync.scopedStorage().setItem(COURSE,
        '{"arduino":{"led":{"note":"automatic journal save"}}}'));
    await tick();
    assert.match(auth.snapshots.alice.values[COURSE], /automatic journal save/);
    assert.equal(sync.exportDraft().dirty, false);
    sync.destroy();
}

// Reconnecting the browser drains a durable offline draft without another edit.
{
    const auth = account(user('alice')), window = new EventTarget();
    const sync = new LearnerSyncService({ account: auth, storage: memoryStorage(),
        events: null, window, debounceMs: 60000, retryMs: 60000 });
    await sync.ready();
    auth.online = false;
    sync.scopedStorage().setItem(COURSE, '{"arduino":{"led":{"note":"queued until online"}}}');
    await sync.sync();
    assert.equal(sync.status.status, 'offline');
    auth.online = true;
    await waitForSave(auth, () => window.dispatchEvent(new Event('online')));
    await tick();
    assert.match(auth.snapshots.alice.values[COURSE], /queued until online/);
    assert.equal(sync.exportDraft().dirty, false);
    sync.destroy();
}

// Existing guest progress remains untouched and is never assigned to a new account.
{
    const storage = memoryStorage({ [COURSE]: '{"last":"arduino"}', [ASSESSMENT]: '{"participants":[{"code":"other-student"}]}' });
    const auth = account(null), sync = make(auth, storage);
    await sync.ready();
    const guest = sync.scopedStorage();
    assert.equal(guest.getItem(COURSE), '{"last":"arduino"}');
    auth.change(user('alice'));
    await tick();
    const alice = sync.scopedStorage();
    assert.equal(alice.getItem(COURSE), null);
    assert.equal(auth.calls.filter(call => call.method === 'PUT').length, 0);
    await sync.importGuest();
    assert.equal(alice.getItem(COURSE), '{"last":"arduino"}');
    assert.equal(auth.snapshots.alice.values[ASSESSMENT], undefined, 'Shared assessment participants must never upload automatically or through guest import');
    assert.equal(storage.getItem(ASSESSMENT), '{"participants":[{"code":"other-student"}]}');
    assert.equal(storage.getItem(COURSE), '{"last":"arduino"}', 'Guest copy must remain available after import');
    sync.destroy();
}

// Independently loaded course tabs merge disjoint lessons and fields, while
// overlapping journal edits are paused and remain available for draft export.
{
    const initial = { last: 'arduino', arduino: { led: { note: 'original', choice: null, done: false } } };
    const snapshot = { revision: 4, values: { [COURSE]: JSON.stringify(initial) }, updatedAt: null };
    const storage = memoryStorage();
    const first = make(account(user('alice'), { alice: snapshot }), storage);
    const second = make(account(user('alice'), { alice: snapshot }), storage);
    await first.ready(); await second.ready();
    const tabA = first.scopedStorage(), tabB = second.scopedStorage();
    const editA = JSON.parse(tabA.getItem(COURSE)), editB = JSON.parse(tabB.getItem(COURSE));
    editA.arduino.led.note = 'journal from first tab';
    tabA.setItem(COURSE, JSON.stringify(editA));
    editB.last = 'microbit';
    editB.microbit = { matrix: { note: 'matrix from second tab', choice: null, done: false } };
    tabB.setItem(COURSE, JSON.stringify(editB));
    let saved = JSON.parse(first.exportDraft().values[COURSE]);
    assert.equal(saved.arduino.led.note, 'journal from first tab');
    assert.equal(saved.microbit.matrix.note, 'matrix from second tab');
    // A second edit from the stale second tab must still retain the first tab's
    // journal; the consumer baseline is its own prior input, not merged data.
    editB.arduino.led.prediction = 'different field from second tab';
    tabB.setItem(COURSE, JSON.stringify(editB));
    saved = JSON.parse(first.exportDraft().values[COURSE]);
    assert.equal(saved.arduino.led.note, 'journal from first tab');
    assert.equal(saved.arduino.led.prediction, 'different field from second tab');
    editA.arduino.led.source = 'hardware';
    tabA.setItem(COURSE, JSON.stringify(editA));
    saved = JSON.parse(first.exportDraft().values[COURSE]);
    assert.equal(saved.arduino.led.prediction, 'different field from second tab');
    assert.equal(saved.arduino.led.source, 'hardware');
    const before = first.exportDraft().values[COURSE];
    editB.arduino.led.note = 'overlapping unsaved second-tab draft';
    assert.throws(() => tabB.setItem(COURSE, JSON.stringify(editB)), { code: 'TAB_EDIT_CONFLICT' });
    assert.equal(first.exportDraft().values[COURSE], before, 'An overlapping stale edit cannot replace saved work');
    assert.equal(second.hasTabDrafts(), true);
    assert.equal(second.status.status, 'tab-conflict');
    assert.match(second.exportDraft().tabDraftValues[COURSE], /overlapping unsaved second-tab draft/);
    // A later sync status must not hide the still-unsaved tab draft.
    second._status('synced', 'remote copy saved');
    assert.equal(second.status.status, 'tab-conflict');
    second.discardTabDraft(COURSE, 'bob');
    assert.equal(second.hasTabDrafts(), true, 'A stale account callback cannot clear another account draft');
    second.discardTabDraft(COURSE, 'alice');
    assert.equal(second.hasTabDrafts(), false);
    assert.equal(first.exportDraft().values[COURSE], before, 'Discarding a tab draft preserves the shared saved copy');
    first.destroy(); second.destroy();
}

// The same protection applies when free guest labs are opened in separate tabs.
{
    const storage = memoryStorage();
    const first = make(account(null), storage), second = make(account(null), storage);
    await first.ready(); await second.ready();
    const tabA = first.scopedStorage(), tabB = second.scopedStorage();
    tabA.setItem(COURSE, '{"last":"arduino","arduino":{"led":{"note":"guest A"}}}');
    tabB.setItem(COURSE, '{"last":"microbit","microbit":{"matrix":{"note":"guest B"}}}');
    let saved = JSON.parse(storage.getItem(COURSE));
    assert.equal(saved.arduino.led.note, 'guest A');
    assert.equal(saved.microbit.matrix.note, 'guest B');
    assert.throws(() => tabB.setItem(COURSE,
        '{"last":"arduino","arduino":{"led":{"note":"conflicting guest B"}}}'), { code: 'TAB_EDIT_CONFLICT' });
    saved = JSON.parse(storage.getItem(COURSE));
    assert.equal(saved.arduino.led.note, 'guest A');
    assert.match(second.exportDraft().tabDraftValues[COURSE], /conflicting guest B/);
    first.destroy(); second.destroy();
}

// Frozen storage facades prevent an old page's callbacks from writing into a new account.
{
    const auth = account(user('alice'), { alice: { revision: 3, values: { [COURSE]: '{"last":"arduino"}' }, updatedAt: null } });
    const storage = memoryStorage(), sync = make(auth, storage);
    await sync.ready();
    const alice = sync.scopedStorage();
    auth.change(user('bob'));
    await tick();
    const bob = sync.scopedStorage();
    assert.equal(bob.getItem(COURSE), null);
    alice.setItem(COURSE, '{"last":"microbit"}');
    assert.equal(bob.getItem(COURSE), null);
    assert.equal(auth.snapshots.bob.revision, 0);
    auth.change(null);
    await tick();
    alice.setItem(QUIZ, '[]');
    assert.equal(storage.getItem(QUIZ), null, 'Signed-out callbacks must not modify guest history');
    assert.equal(JSON.parse(storage.getItem(`${LEARNER_WORKSPACE_PREFIX}alice`)).dirty, true);
    sync.destroy();
}

// Local writes survive a network failure and a complete page/service restart.
{
    const auth = account(user('alice')), storage = memoryStorage(), first = make(auth, storage);
    await first.ready();
    auth.online = false;
    first.scopedStorage().setItem(COURSE, '{"arduino":{"led":{"note":"kept offline"}}}');
    await first.sync();
    assert.equal(first.status.status, 'offline');
    first.destroy();
    const reopened = make(auth, storage);
    await reopened.ready();
    assert.match(reopened.scopedStorage().getItem(COURSE), /kept offline/);
    auth.online = true;
    await reopened.sync();
    assert.equal(reopened.status.status, 'synced');
    assert.match(auth.snapshots.alice.values[COURSE], /kept offline/);
    assert.equal(JSON.parse(storage.getItem(`${LEARNER_WORKSPACE_PREFIX}alice`)).dirty, false);
    reopened.destroy();
}

// A stale revision cannot silently overwrite another device. Both alternatives remain available.
{
    const auth = account(user('alice')), sync = make(auth);
    await sync.ready();
    const local = sync.scopedStorage();
    local.setItem(COURSE, '{"last":"arduino"}');
    auth.snapshots.alice = { revision: 1, values: { [COURSE]: '{"last":"microbit"}' }, updatedAt: null };
    await sync.sync();
    assert.equal(sync.status.status, 'conflict');
    assert.equal(local.getItem(COURSE), '{"last":"arduino"}');
    assert.equal(auth.snapshots.alice.values[COURSE], '{"last":"microbit"}');
    assert.equal(sync.exportDraft().values[COURSE], '{"last":"arduino"}');
    const calls = auth.calls.length;
    await sync.sync();
    assert.equal(auth.calls.length, calls, 'An unresolved conflict must not retry a destructive write');
    await sync.useServerCopy();
    assert.equal(local.getItem(COURSE), '{"last":"microbit"}');
    local.setItem(COURSE, '{"last":"vex-iq"}');
    auth.snapshots.alice.revision++;
    await sync.sync();
    assert.equal(sync.status.status, 'conflict');
    await sync.keepLocalCopy();
    assert.equal(auth.snapshots.alice.values[COURSE], '{"last":"vex-iq"}');
    sync.destroy();
}

// An edit made while PUT is in flight stays dirty and uses the acknowledged next revision.
{
    const auth = account(user('alice')), sync = make(auth);
    await sync.ready();
    const original = auth.request.bind(auth);
    let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    auth.request = async (path, options) => {
        if (options?.method === 'PUT' && !release) {
            await new Promise(resolve => { release = resolve; entered(); });
        }
        return original(path, options);
    };
    const local = sync.scopedStorage();
    local.setItem(COURSE, '{"last":"arduino"}');
    const saving = sync.sync();
    await started;
    local.setItem(COURSE, '{"last":"microbit"}');
    release();
    await saving;
    assert.equal(sync.exportDraft().dirty, true);
    assert.equal(sync.exportDraft().revision, 1);
    assert.equal(local.getItem(COURSE), '{"last":"microbit"}');
    await sync.sync();
    assert.equal(auth.snapshots.alice.revision, 2);
    assert.equal(auth.snapshots.alice.values[COURSE], '{"last":"microbit"}');
    sync.destroy();
}

// Verification remains a real server prerequisite, and import never overwrites an account section.
{
    const auth = account({ id: 'alice', isEmailVerified: false }, {
        alice: { revision: 2, values: { [COURSE]: '{"last":"vex-iq"}' }, updatedAt: null }
    });
    const storage = memoryStorage({ [COURSE]: '{"last":"arduino"}', [QUIZ]: '[]' }), sync = make(auth, storage);
    await sync.ready();
    await sync.importGuest();
    assert.equal(sync.scopedStorage().getItem(COURSE), '{"last":"vex-iq"}');
    assert.equal(sync.scopedStorage().getItem(QUIZ), '[]');
    await sync.sync();
    assert.equal(sync.status.status, 'verification');
    assert.equal(auth.calls.filter(call => call.method === 'PUT').length, 0);
    sync.destroy();
}

// Corrupt device data remains recoverable rather than being silently replaced with an empty workspace.
{
    const broken = '{"version":1,"revision":';
    const storage = memoryStorage({ [`${LEARNER_WORKSPACE_PREFIX}alice`]: broken });
    const auth = account(user('alice')), sync = make(auth, storage);
    await sync.ready();
    assert.equal(sync.status.status, 'error');
    assert.equal(sync.status.conflict, true);
    assert.equal(auth.calls.length, 0);
    assert.equal(sync.exportDraft().recoveryEnvelope, broken);
    assert.throws(() => sync.scopedStorage().setItem(COURSE, '{}'));
    assert.equal(storage.getItem(`${LEARNER_WORKSPACE_PREFIX}alice`), broken);
    sync.destroy();
}

// Reconfirming an offline user's profile during refresh cannot launch two competing saves.
{
    const auth = account(user('alice')), sync = make(auth);
    await sync.ready();
    const original = auth.request.bind(auth);
    let announced = false;
    auth.request = async (path, options) => {
        if (options?.method === 'PUT' && !announced) {
            announced = true;
            auth.change({ ...user('alice'), firstName: 'Alice' });
        }
        return original(path, options);
    };
    sync.scopedStorage().setItem(COURSE, '{"last":"arduino"}');
    await sync.sync();
    await tick();
    assert.equal(auth.snapshots.alice.revision, 1);
    assert.equal(sync.status.status, 'synced');
    assert.equal(sync.exportDraft().dirty, false);
    sync.destroy();
}

// Auth/session keys returned by a misconfigured server are never copied into learner storage.
{
    const auth = account(user('alice'), { alice: { revision: 1, values: { 'strobot.account.session.v1': 'not learner data' }, updatedAt: null } });
    const storage = memoryStorage(), sync = make(auth, storage);
    await sync.ready();
    assert.equal(sync.status.status, 'error');
    assert.equal(storage.getItem(`${LEARNER_WORKSPACE_PREFIX}alice`), null);
    sync.destroy();
}

console.log('Learner sync: guest preservation, account isolation, offline queue, CAS conflicts and in-flight edits passed.');
