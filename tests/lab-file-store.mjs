import assert from 'node:assert/strict';
import { LabFileStore, LAB_ATTACHMENT_LIMITS, validateLabAttachment } from '../frontend/src/services/LabFileStore.js';

const A = '90d43a57-7597-4417-bbb0-b9785f832cd3';
const B = 'eef14dc0-0cf5-48dd-bc0c-905be80a0f06';
const scope = { ownerId: A, courseId: 'arduino', lessonId: 'led', platformKey: 'phet' };
const id = '95e38c59-d9e8-4317-bd7c-0b3cc742929e';
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const named = (name, bytes) => Object.assign(new Blob([bytes]), { name });
const bytes = Uint8Array.from({ length: LAB_ATTACHMENT_LIMITS.chunkBytes + 37 }, (_, index) => index % 251);

function fixture() {
    const calls = [], files = new Map();
    const account = { user: { id: A }, async request(path, options = {}) {
        assert.ok(!options.signal?.aborted, 'The store must not dispatch aborted work');
        calls.push({ path, method: options.method || 'GET', body: options.body });
        if (path.startsWith('/v1/lab-files?')) return { files: [...files.values()].filter(row => row.ready).map(row => row.meta),
            limits: LAB_ATTACHMENT_LIMITS, usage: { usedBytes: [...files.values()].filter(row => row.ready).reduce((n, row) => n + row.meta.sizeBytes, 0), reservedBytes: 0 } };
        if (path === '/v1/lab-files/uploads') {
            assert.match(options.body.clientUploadId, /^[a-f0-9-]{36}$/);
            const meta = { id, name: options.body.name, sizeBytes: options.body.sizeBytes, createdAt: '2026-11-25T12:00:00Z' };
            files.set(id, { meta, chunks: new Map(), ready: false });
            return { id, chunkBytes: LAB_ATTACHMENT_LIMITS.chunkBytes, chunkCount: Math.ceil(meta.sizeBytes / LAB_ATTACHMENT_LIMITS.chunkBytes) };
        }
        const match = path.match(/^\/v1\/lab-files\/([a-f0-9-]+)(?:\/(complete|chunks\/([0-9]+)))?$/);
        assert.ok(match, 'Only own dedicated attachment endpoints are requested');
        const row = files.get(match[1]);
        assert.ok(row);
        if (options.method === 'DELETE') { files.delete(match[1]); return { deleted: true }; }
        if (match[2] === 'complete') { row.ready = true; return row.meta; }
        const index = Number(match[3]);
        if (options.method === 'PUT') { row.chunks.set(index, options.body.dataBase64); return { index }; }
        assert.ok(row.ready);
        return { index, dataBase64: row.chunks.get(index) };
    } };
    return { account, store: new LabFileStore({ account }), calls, files };
}

// Arbitrary formats and images use byte-exact chunks, not the learner snapshot.
{
    const { store, calls } = fixture(), sent = [], received = [];
    const file = named('Bài thực hành.custom-format', bytes);
    // A file that cannot be read whole still uploads using small Blob slices.
    file.arrayBuffer = () => { throw new Error('Whole file read forbidden'); };
    const meta = await store.upload(scope, file, { onProgress: item => sent.push(item) });
    assert.equal(meta.name, file.name);
    assert.equal(calls.filter(call => call.method === 'PUT').length, 2);
    for (const call of calls.filter(call => call.method === 'PUT'))
        assert.ok(Buffer.from(call.body.dataBase64, 'base64').length <= LAB_ATTACHMENT_LIMITS.chunkBytes);
    assert.deepEqual(await store.download(scope, meta, { onProgress: item => received.push(item) }), bytes);
    assert.deepEqual(sent.at(-1), { loaded: bytes.length, total: bytes.length });
    assert.deepEqual(received.at(-1), { loaded: bytes.length, total: bytes.length });
    const list = await store.list(scope);
    assert.deepEqual(list.files, [meta]);
    assert.equal(list.limits.accountBytes, 250 * 1024 * 1024);
    assert.equal(list.usage.usedBytes, bytes.length);
    assert.ok(!calls.some(call => /learner-state|storage/.test(call.path)));
    await store.remove(scope, meta.id);
    assert.equal((await store.list(scope)).files.length, 0);
}
for (const [name, content] of [
    ['ảnh.png', Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])],
    ['README', new TextEncoder().encode('No extension is required')],
    ['empty.data', new Uint8Array()],
]) {
    const { store } = fixture();
    const meta = await store.upload(scope, named(name, content), { onProgress() { throw Error('UI observer error'); } });
    assert.deepEqual(await store.download(scope, meta), content);
}

// Validation happens before allocation/upload; safe names do not impose formats.
{
    const { store, calls } = fixture();
    for (const name of ['', '../secret', 'folder\\secret', '.', '..', 'bad\0.png', '__proto__', 'a'.repeat(181), ' spaced '])
        await assert.rejects(store.upload(scope, named(name, new Uint8Array())), /tên hợp lệ/);
    await assert.rejects(store.upload(scope, { name: 'large.zip', size: LAB_ATTACHMENT_LIMITS.fileBytes + 1, slice() {} }), /25 MB/);
    assert.equal(validateLabAttachment({ name: 'max.bin', size: LAB_ATTACHMENT_LIMITS.fileBytes, slice() {} }).size, 25 * 1024 * 1024);
    await assert.rejects(store.remove(scope, '../other-account'), /không hợp lệ/);
    await assert.rejects(store.download(scope, { id, name: 'big', sizeBytes: LAB_ATTACHMENT_LIMITS.fileBytes + 1 }), /Thông tin tệp/);
    await assert.rejects(store.list({ ...scope, lessonId: '../outside' }), /Mở đúng bài/);
    assert.equal(calls.length, 0);
}

// A switched owner cannot receive late list bytes or trigger any further chunks.
{
    const f = fixture(), entered = deferred(), release = deferred();
    const original = f.account.request;
    f.account.request = async (...args) => { const result = await original(...args); entered.resolve(); await release.promise; return result; };
    const pending = f.store.list(scope);
    await entered.promise; f.account.user = { id: B }; release.resolve();
    await assert.rejects(pending, error => error.code === 'SESSION_CHANGED');
    assert.equal(f.calls.length, 1);
    await assert.rejects(f.store.upload(scope, named('wrong.bin', bytes)), error => error.code === 'SESSION_CHANGED');
}
{
    const f = fixture(), entered = deferred(), release = deferred();
    let reads = 0;
    const slow = { name: 'delayed.bin', size: bytes.length,
        slice(start, end) { return { async arrayBuffer() { if (++reads === 2) entered.resolve(); await release.promise; return bytes.slice(start, end).buffer; } }; } };
    const pending = f.store.upload(scope, slow);
    await entered.promise; f.account.user = { id: B }; release.resolve();
    await assert.rejects(pending, error => error.code === 'SESSION_CHANGED');
    assert.equal(f.calls.filter(call => call.method === 'PUT' || call.method === 'DELETE').length, 0);
}

// Cancellation drains active workers and frees the reservation only for A.
{
    const f = fixture(), entered = deferred(), release = deferred(), controller = new AbortController();
    let reads = 0;
    const slow = { name: 'cancelled.bin', size: bytes.length,
        slice(start, end) { return { async arrayBuffer() { if (++reads === 2) entered.resolve(); await release.promise; return bytes.slice(start, end).buffer; } }; } };
    const pending = f.store.upload(scope, slow, { signal: controller.signal });
    await entered.promise; controller.abort(); release.resolve();
    await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED');
    assert.equal(f.calls.filter(call => call.method === 'PUT').length, 0);
    assert.equal(f.calls.filter(call => call.method === 'DELETE').length, 1);
    assert.equal(f.files.size, 0);
}

// A failed request waits for the sibling worker before deleting its reservation.
{
    const f = fixture(), entered = [deferred(), deferred()], release = [deferred(), deferred()];
    const original = f.account.request;
    f.account.request = async (path, options = {}) => {
        const index = path.match(/\/chunks\/([01])$/)?.[1];
        if (options.method === 'PUT' && index !== undefined) {
            entered[Number(index)].resolve();
            await release[Number(index)].promise;
            if (index === '0') throw Object.assign(new Error('Connection interrupted'), { code: 'NETWORK_ERROR' });
            return { index: Number(index) };
        }
        return original(path, options);
    };
    const pending = f.store.upload(scope, named('interrupted.bin', bytes));
    await Promise.all(entered.map(item => item.promise));
    release[0].resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(f.calls.filter(call => call.method === 'DELETE').length, 0, 'Do not delete while the other worker is still pending');
    release[1].resolve();
    await assert.rejects(pending, error => error.code === 'NETWORK_ERROR');
    assert.equal(f.calls.at(-1).method, 'DELETE');
    assert.ok(!f.calls.some(call => /\/complete$/.test(call.path)));
}

// Reject malformed/cross-version metadata and canonical-base64 ambiguities.
{
    for (const result of [
        { files: [{ id: '../unsafe', name: 'x', sizeBytes: 1 }] },
        { files: [], limits: { fileBytes: Number.MAX_SAFE_INTEGER } },
        { files: [], limits: { chunkBytes: 512 * 1024 } },
        { files: [], usage: { usedBytes: -1 } },
    ]) {
        const store = new LabFileStore({ account: { user: { id: A }, async request() { return result; } } });
        await assert.rejects(store.list(scope), error => error.code === 'LAB_FILE_RESPONSE_INVALID');
    }
    for (const data of [{ index: 0, dataBase64: 'Zh==' }, { index: 0, dataBase64: 'Zg==\n' }, { index: 1, dataBase64: 'Zg==' }, { index: 0, dataBase64: '' }]) {
        const store = new LabFileStore({ account: { user: { id: A }, async request() { return data; } } });
        await assert.rejects(store.download(scope, { id, name: 'x', sizeBytes: 1 }), error => error.code === 'LAB_FILE_RESPONSE_INVALID');
    }
}

console.log('PASS dedicated lab file store: arbitrary/image formats, bounded chunks, byte-exact download, generous quotas, cancellation and stale-owner isolation');
