import assert from 'node:assert/strict';
import { AiSetupClient, canConfigureAi, validateAiConnection, aiSetupErrorMessage,
    AI_SETUP_TOOLS } from '../frontend/src/modules/account/AiAdminSetup.js';

const admin = () => ({ id: 'operator', isActive: true, isEmailVerified: true,
    permissions: ['ai:manage'], roles: [{ group: 'MANAGER', scopeType: 'SYSTEM' }] });
const key = 'fixture-provider-secret-never-real';
const clone = value => JSON.parse(JSON.stringify(value));
function fixture({ configured = false, model = false, onRequest } = {}) {
    const calls = [], vault = { revision: 0, providers: configured ? [{ id: 'gemini', type: 'gemini', enabled: true,
        models: [], endpoints: [{ id: 'official', baseUrl: 'https://generativelanguage.googleapis.com', enabled: true, capabilities: ['chat', 'tools'] }],
        limits: { requestsPerMinute: 10, tokensPerDay: 100000, maxConcurrent: 2 },
        credentials: [{ id: 'saved', enabled: true }] }] : [] };
    const models = model ? [{ id: 'model-record', provider_id: 'gemini', model_id: 'fixture-model' }] : [];
    const session = { user: admin(), sessionVersion: 1, sessionOffline: false,
        async request(path, options = {}) {
            calls.push({ path, method: options.method || 'GET', ...(options.body ? { body: clone(options.body) } : {}) });
            if (onRequest) await onRequest(path, options, session);
            if (path === '/v1/admin/ai/settings') return { enabled: options.body?.enabled || false, gatewayEnabled: true };
            if (path === '/v1/admin/ai/vault') return clone(vault);
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
}
{
    const { client, calls } = fixture({ configured: true, model: true });
    await client.saveConnection(config(''));
    assert(!calls.some(item => item.path.endsWith('/credentials')), 'Empty key retains saved credentials');
    assert.equal(calls.at(-1).method, 'PATCH');
    assert.equal(calls.at(-1).path, '/v1/admin/ai/models/model-record');
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
console.log('PASS AI setup permissions, encrypted-key routing, CAS, model upsert, stale session guards and explicit activation');
