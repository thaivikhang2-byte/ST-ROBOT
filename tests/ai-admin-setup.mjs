import assert from 'node:assert/strict';
import { AiSetupClient, canConfigureAi, validateAiConnection, aiSetupErrorMessage,
    aiModelLimitNotice, AI_SETUP_DEFAULT_LIMITS, AI_SETUP_TOOLS } from '../frontend/src/modules/account/AiAdminSetup.js';
import { AccountService } from '../frontend/src/services/AccountService.js';

const admin = () => ({ id: 'operator', email: 'operator@school.local', isActive: true, isEmailVerified: true,
    permissions: ['ai:manage'], roles: [{ group: 'MANAGER', scopeType: 'SYSTEM' }] });
const key = 'fixture-provider-secret-never-real';
const clone = value => JSON.parse(JSON.stringify(value));
function fixture({ configured = false, model = false, onRequest } = {}) {
    const calls = [], vault = { revision: 0, providers: configured ? [{ id: 'gemini', type: 'gemini', enabled: true,
        models: [], endpoints: [{ id: 'official', baseUrl: 'https://generativelanguage.googleapis.com', enabled: true, capabilities: ['chat', 'tools'] }],
        limits: { requestsPerMinute: 10, tokensPerDay: 100000, maxConcurrent: 2 },
        credentials: [{ id: 'saved', enabled: true }] }] : [] };
    const models = model ? [{ id: 'model-record', provider_id: 'gemini', model_id: 'fixture-model',
        max_input_tokens: 6000, max_output_tokens: 2048, context_tokens: 8192 }] : [];
    const session = { user: admin(), sessionVersion: 1, sessionOffline: false,
        async request(path, options = {}) {
            calls.push({ path, method: options.method || 'GET', ...(options.body ? { body: clone(options.body) } : {}) });
            if (onRequest) await onRequest(path, options, session);
            if (path === '/v1/admin/ai/settings') return { enabled: options.body?.enabled || false, gatewayEnabled: true };
            if (path === '/v1/admin/ai/vault') return clone(vault);
            if (options.method === 'DELETE') {
                const match = path.match(/^\/v1\/admin\/ai\/providers\/([a-zA-Z0-9_-]+)\/credentials\/([a-zA-Z0-9_-]+)$/);
                assert(match, 'Credential deletion must use the dedicated admin API');
                if (options.body.expectedRevision !== vault.revision)
                    throw Object.assign(new Error('Fixture revision changed'), { status: 409, code: 'CONFLICT' });
                const provider = vault.providers.find(item => item.id === match[1]);
                provider.credentials = provider.credentials.filter(item => item.id !== match[2]);
                vault.revision++; return clone(vault);
            }
            if (path.endsWith('/config')) {
                assert.equal(options.body.expectedRevision, vault.revision);
                const previous = vault.providers.find(item => item.id === options.body.provider.id);
                vault.providers = [{ ...options.body.provider, credentials: previous?.credentials || [] }];
                vault.revision++; return clone(vault);
            }
            if (path.endsWith('/credentials')) {
                assert.equal(options.body.expectedRevision, vault.revision);
                assert.equal(options.body.apiKey, key);
                vault.providers[0].credentials.push({ id: 'new', enabled: true });
                vault.revision++; return clone(vault);
            }
            if (path === '/v1/admin/ai/models') return options.method === 'POST' ? { id: 'created' } : clone(models);
            if (path === '/v1/admin/ai/models/model-record') return { id: 'model-record' };
            if (path === '/v1/admin/ai/quotas/default') return { daily_requests: 50, daily_tokens: 100000 };
            if (path === '/v1/admin/ai/providers/gemini/models') return { modelIds: ['fixture-model'] };
            if (path.startsWith('/v1/ai/agent/capabilities')) return AI_SETUP_TOOLS.map(name => ({ name }));
            throw new Error('Unexpected path ' + path);
        } };
    return { session, calls, vault, client: new AiSetupClient(session) };
}
const config = (apiKey = key) => ({ providerId: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', modelId: 'fixture-model', apiKey });

assert.equal(canConfigureAi(admin()), true);
assert.equal(canConfigureAi({ ...admin(), roles: [{ group: 'MANAGER', scopeType: 'COURSE' }] }), false);
assert.equal(canConfigureAi({ ...admin(), isEmailVerified: false }), false);
assert.equal(canConfigureAi(admin(), true), false);
assert.equal(AI_SETUP_TOOLS.length, 16);
assert(AI_SETUP_TOOLS.includes('learning_get_own_learning_data'));
assert(AI_SETUP_TOOLS.includes('learning_get_lab_platforms'));
assert(!AI_SETUP_TOOLS.some(name => /publish|update|create_admin/.test(name)));
for (const bad of ['http://provider.test', 'https://key:secret@provider.test', 'https://provider.test?key=x', 'https://provider.test:8443'])
    assert.throws(() => validateAiConnection({ ...config(), baseUrl: bad }));
{
    const value = validateAiConnection(config());
    assert.deepEqual(Object.fromEntries(Object.keys(AI_SETUP_DEFAULT_LIMITS).map(name => [name, value[name]])),
        { maxInputTokens: 32768, maxOutputTokens: 2048, contextTokens: 65536 });
    assert(value.maxInputTokens + value.maxOutputTokens <= value.contextTokens);
    assert.equal(validateAiConnection({ ...config(), modelId: 'org/model@2026-11' }, admin().email).modelId, 'org/model@2026-11',
        'Legitimate provider IDs can contain @ without being the operator email');
}

{
    const { client, session, calls } = fixture({ configured: true });
    session.user.permissions.push('ai:chat');
    await client.saveConnection(config(''));
    assert(calls.some(item => item.path === '/v1/ai/agent/capabilities?mode=EDUCATIONAL'));
    assert(calls.at(-1).body.allowedTools.includes('learning_get_own_learning_data'));
    assert(calls.at(-1).body.allowedTools.includes('learning_get_lab_platforms'));
}
{
    const { client, calls } = fixture();
    const input = config();
    const result = await client.saveConnection(input);
    assert.equal(input.apiKey, '');
    assert.equal(result.modelSaved, true);
    assert.deepEqual(calls.map(item => item.path), ['/v1/admin/ai/vault', '/v1/admin/ai/providers/gemini/config',
        '/v1/admin/ai/providers/gemini/credentials', '/v1/admin/ai/models', '/v1/admin/ai/models']);
    const credentialCalls = calls.filter(item => JSON.stringify(item).includes(key));
    assert.equal(credentialCalls.length, 1, 'Key is sent only to the encrypted credential endpoint');
    assert(!calls.some(item => item.path.includes('/settings') || item.path.includes('/chat')));
    assert.equal(calls[4].body.capabilities.includes('reasoning_context'), true);
    assert.deepEqual(calls[4].body.allowedTools, AI_SETUP_TOOLS);
    assert.equal(calls[4].body.maxInputTokens, 32768);
    assert.equal(calls[4].body.maxOutputTokens, 2048);
    assert.equal(calls[4].body.contextTokens, 65536);
}
{
    const { client, calls } = fixture({ configured: true, model: true });
    await client.saveConnection(config(''));
    assert(!calls.some(item => item.path.endsWith('/credentials')), 'Empty key retains saved credentials');
    assert.equal(calls.at(-1).method, 'PATCH');
    assert.equal(calls.at(-1).path, '/v1/admin/ai/models/model-record');
    assert.equal(calls.at(-1).body.maxInputTokens, 32768,
        'Only an explicit Save replaces the older stored model limit');
}
{
    const { client, calls } = fixture({ configured: true, model: true });
    const metadata = await client.load();
    assert(calls.every(item => item.method === 'GET'), 'Reading a low limit must never increase it');
    const notice = aiModelLimitNotice(metadata.models[0]);
    assert.match(notice, /6000/);
    assert.match(notice, /8192/);
    assert.match(notice, /Lưu kết nối/);
    assert.match(notice, /không tự tăng/);
    assert.equal(aiModelLimitNotice({ model_id: 'fixture-large', max_input_tokens: 32768,
        max_output_tokens: 2048, context_tokens: 65536 }), '');
}
{
    const { client, calls } = fixture({ configured: true, model: true });
    await client.saveConnection({ ...config(''), maxInputTokens: '6000', maxOutputTokens: '1200', contextTokens: '8192' });
    const request = calls.at(-1);
    assert.equal(request.method, 'PATCH');
    assert.deepEqual([request.body.maxInputTokens, request.body.maxOutputTokens, request.body.contextTokens],
        [6000, 1200, 8192], 'Operator-selected smaller valid limits must not be silently increased');
}
for (const invalid of [
    { maxInputTokens: 0 }, { maxInputTokens: 2000001 }, { maxInputTokens: 1.5 },
    { maxInputTokens: '' }, { maxInputTokens: null }, { maxInputTokens: true },
    { maxOutputTokens: 0 }, { maxOutputTokens: 16385 }, { maxOutputTokens: 'not-a-number' },
    { contextTokens: 1 }, { contextTokens: 2000001 },
    { maxInputTokens: 7000, maxOutputTokens: 2048, contextTokens: 8192 },
]) {
    const { client, calls } = fixture();
    const input = { ...config(), ...invalid };
    await assert.rejects(client.saveConnection(input), error => error.code === 'AI_SETUP_LIMITS');
    assert.equal(calls.length, 0, 'Invalid limits must fail before provider or credential operations');
    assert.equal(input.apiKey, '');
}
{
    const { client, calls } = fixture();
    const input = { ...config(), maxOutputTokens: 1199 };
    await assert.rejects(client.saveConnection(input), error => error.code === 'AI_SETUP_AGENT_OUTPUT');
    assert.equal(calls.length, 0, 'A tool model below the agent output minimum cannot alter provider metadata');
    assert.equal(input.apiKey, '');
    assert.match(aiSetupErrorMessage({ code: 'AI_SETUP_AGENT_OUTPUT' }), /1.200/);
}
{
    const { client, calls } = fixture();
    await client.saveConnection({ ...config(), modelId: '', maxInputTokens: 1, maxOutputTokens: 1, contextTokens: 2 });
    assert(!calls.some(item => item.path === '/v1/admin/ai/models'),
        'Saving a connection without registering a model does not apply agent output policy');
}
{
    const { client, calls } = fixture();
    const input = { ...config(), modelId: ' OPERATOR@SCHOOL.LOCAL ' };
    await assert.rejects(client.saveConnection(input), error => error.code === 'AI_SETUP_MODEL_EMAIL');
    assert.equal(calls.length, 0, 'An autofilled operator email cannot be registered as the provider model');
    assert.equal(input.apiKey, '');
    assert.match(aiSetupErrorMessage({ code: 'AI_SETUP_MODEL_EMAIL' }), /email đăng nhập/);
    assert(!aiSetupErrorMessage({ code: 'AI_SETUP_MODEL_EMAIL', message: key }).includes(key));
}
{
    const { client, calls } = fixture();
    const input = config('');
    await assert.rejects(client.saveConnection(input), error => error.code === 'AI_SETUP_KEY_REQUIRED');
    assert.equal(calls.length, 1, 'Missing key is rejected before provider metadata changes');
}
{
    const { client, session, calls } = fixture({ onRequest(path, _, owner) {
        if (path.endsWith('/config')) owner.user = { ...admin(), id: 'other-operator' };
    } });
    const input = config();
    await assert.rejects(client.saveConnection(input), error => error.code === 'SESSION_CHANGED');
    assert.equal(input.apiKey, '');
    assert.equal(session.user.id, 'other-operator');
    assert(!calls.some(item => item.path.endsWith('/credentials')), 'Stale owner cannot submit provider secret');
}
{
    const { client, calls, session } = fixture();
    session.user.isEmailVerified = false;
    const input = config();
    await assert.rejects(client.saveConnection(input), error => error.code === 'SESSION_CHANGED');
    assert.equal(input.apiKey, ''); assert.equal(calls.length, 0);
}
{
    const { client, calls } = fixture();
    const metadata = await client.load();
    assert.equal(metadata.settings.gatewayEnabled, true);
    assert(calls.every(item => !item.path.includes('/providers/') && !item.path.includes('/agent/')));
    await client.discover('gemini');
    assert.equal(calls.at(-1).path, '/v1/admin/ai/providers/gemini/models');
    await client.setEnabled(true);
    assert.deepEqual(calls.at(-1).body, { enabled: true });
    assert(!aiSetupErrorMessage({ status: 503, message: key }).includes(key));
}
{
    const { client, calls, vault } = fixture({ configured: true });
    vault.revision = 7;
    vault.providers[0].credentials.push({ id: 'keep-this-key', enabled: true });
    await client.load();
    assert(calls.every(item => item.method === 'GET'), 'Loading credentials must never delete or replace them');
    calls.length = 0;
    await client.removeCredential('gemini', 'saved');
    assert.deepEqual(calls, [
        { path: '/v1/admin/ai/vault', method: 'GET' },
        { path: '/v1/admin/ai/providers/gemini/credentials/saved', method: 'DELETE', body: { expectedRevision: 7 } },
    ]);
    assert.deepEqual(vault.providers[0].credentials, [{ id: 'keep-this-key', enabled: true }]);
    assert.equal(vault.revision, 8);
    assert(!JSON.stringify(calls).includes(key));
}
{
    let sharedVault;
    const { client, calls, vault } = fixture({ configured: true, onRequest(path, options) {
        if (options.method === 'DELETE') sharedVault.revision++;
    } });
    sharedVault = vault;
    await assert.rejects(client.removeCredential('gemini', 'saved'), error => error.status === 409);
    assert.equal(calls.length, 2, 'A stale revision must not trigger an automatic retry or another deletion');
    assert.deepEqual(vault.providers[0].credentials, [{ id: 'saved', enabled: true }]);
}
for (const mutate of [
    owner => { owner.user = { ...admin(), id: 'other-operator' }; },
    owner => { owner.sessionVersion++; },
    owner => { owner.user.roles = []; },
]) {
    const { client, calls, vault } = fixture({ configured: true, onRequest(path, _, owner) {
        if (path.endsWith('/vault')) mutate(owner);
    } });
    await assert.rejects(client.removeCredential('gemini', 'saved'), error => error.code === 'SESSION_CHANGED');
    assert.equal(calls.length, 1, 'An account or authority change must stop before deletion');
    assert.equal(vault.providers[0].credentials.length, 1);
}
for (const [providerId, credentialId] of [['../gemini', 'saved'], ['gemini', '../saved'], ['gemini', ''], ['gemini', key + '?secret']]) {
    const { client, calls } = fixture({ configured: true });
    await assert.rejects(client.removeCredential(providerId, credentialId), error => error.code === 'AI_SETUP_CREDENTIAL');
    assert.equal(calls.length, 0);
}
{
    const { client, calls } = fixture({ configured: true });
    await assert.rejects(client.removeCredential('gemini', 'already-removed'), error => error.code === 'AI_SETUP_CREDENTIAL_NOT_FOUND');
    assert.equal(calls.length, 1, 'A missing credential must not cause a DELETE');
    const controller = new AbortController(); controller.abort();
    await assert.rejects(client.removeCredential('gemini', 'saved', { signal: controller.signal }), error => error.name === 'AbortError');
    assert.equal(calls.length, 1);
}
{
    const calls = [];
    const session = new AccountService({ baseUrl: 'https://accounts.example.test/api', warmup: false,
        fetchImpl: async (url, options) => {
            calls.push({ url, options });
            return new Response(JSON.stringify({ success: true, data: { revision: 11, providers: [
                { id: 'gemini', credentials: options.method === 'DELETE' ? [] : [{ id: 'saved', enabled: true }] },
            ] } }), { headers: { 'Content-Type': 'application/json' } });
        }, storage: { getItem: () => null } });
    session._user = admin(); session._accessToken = 'fixture-account-token';
    await new AiSetupClient(session).removeCredential('gemini', 'saved');
    assert.deepEqual(calls.map(item => item.url), [
        'https://accounts.example.test/api/v1/admin/ai/vault',
        'https://accounts.example.test/api/v1/admin/ai/providers/gemini/credentials/saved',
    ]);
    assert(calls.every(item => item.options.credentials === 'omit'
        && item.options.headers.Authorization === 'Bearer fixture-account-token'));
    assert.deepEqual(JSON.parse(calls[1].options.body), { expectedRevision: 11 });
    assert(!calls.some(item => item.url.includes('generativelanguage.googleapis.com')));
}
{
    const message = aiSetupErrorMessage({ code: 'AI_PROVIDER_AUTH_FAILED', status: 503, message: key });
    assert.match(message, /từ chối API key/);
    assert.match(message, /Woku/);
    assert(!message.includes(key));
}
console.log('PASS AI setup permissions, model limits, autofill rejection, encrypted keys, scoped credential deletion with CAS, session guards and explicit activation');
