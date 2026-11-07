import assert from 'node:assert/strict';
import { getProviderConfig, PROVIDER_ENDPOINTS } from '../ai-server/provider-config.mjs';

// These values are local markers. No credentials or external requests are used.
const WOKU_KEY = 'local-woku-config-marker';
const GEMINI_KEY = 'local-gemini-config-marker';
const wokuDefaults = {
  id: 'woku', apiKey: '', model: 'gemini-4-argon',
  keyVariable: 'WOKU_API_KEY', modelVariable: 'AI_MODEL',
  chatEndpoint: 'https://llm.wokushop.com/v1/chat/completions',
  catalogEndpoint: 'https://llm.wokushop.com/v1/models',
  modelConfigured: false
};
const geminiDefaults = {
  id: 'gemini', apiKey: '', model: 'gemini-3.8-flash',
  keyVariable: 'GEMINI_API_KEY', modelVariable: 'GEMINI_MODEL',
  chatEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  catalogEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/models',
  modelConfigured: false
};
let groups = 0;

assert.deepEqual(getProviderConfig({}), wokuDefaults);
assert.deepEqual(getProviderConfig({ AI_PROVIDER: 'woku' }), wokuDefaults);
assert.deepEqual(getProviderConfig({ AI_PROVIDER: 'gemini' }), geminiDefaults);
groups++;

assert.deepEqual(getProviderConfig(Object.freeze({
  AI_PROVIDER: 'woku', WOKU_API_KEY: WOKU_KEY, AI_MODEL: 'configured-woku-model'
})), { ...wokuDefaults, apiKey: WOKU_KEY, model: 'configured-woku-model', modelConfigured: true });
assert.deepEqual(getProviderConfig(Object.freeze({
  AI_PROVIDER: 'gemini', GEMINI_API_KEY: GEMINI_KEY, GEMINI_MODEL: 'configured-gemini-model'
})), { ...geminiDefaults, apiKey: GEMINI_KEY, model: 'configured-gemini-model', modelConfigured: true });
groups++;

// Missing selected credentials must remain missing, even if the other key exists.
assert.deepEqual(getProviderConfig({
  AI_PROVIDER: 'gemini', WOKU_API_KEY: WOKU_KEY, AI_MODEL: 'legacy-woku-model'
}), geminiDefaults);
assert.deepEqual(getProviderConfig({
  AI_PROVIDER: 'woku', GEMINI_API_KEY: GEMINI_KEY, GEMINI_MODEL: 'other-gemini-model'
}), wokuDefaults);
for (const id of ['woku', 'gemini']) {
  const otherKey = id === 'woku' ? 'GEMINI_API_KEY' : 'WOKU_API_KEY';
  const otherModel = id === 'woku' ? 'GEMINI_MODEL' : 'AI_MODEL';
  const env = { AI_PROVIDER: id };
  Object.defineProperty(env, otherKey, { get() { throw new Error('Read an unselected provider key'); } });
  Object.defineProperty(env, otherModel, { get() { throw new Error('Read an unselected provider model'); } });
  assert.deepEqual(getProviderConfig(env), id === 'woku' ? wokuDefaults : geminiDefaults);
}
groups++;

assert.deepEqual(getProviderConfig({ WOKU_API_KEY: WOKU_KEY }), { ...wokuDefaults, apiKey: WOKU_KEY });
assert.deepEqual(getProviderConfig({ GEMINI_API_KEY: GEMINI_KEY }), wokuDefaults);
assert.deepEqual(getProviderConfig({ WOKU_API_KEY: WOKU_KEY, GEMINI_API_KEY: GEMINI_KEY }),
  { ...wokuDefaults, apiKey: WOKU_KEY });
for (const empty of ['', ' \t\n ']) {
  assert.deepEqual(getProviderConfig({ AI_PROVIDER: empty, GEMINI_API_KEY: GEMINI_KEY }),
    wokuDefaults);
  assert.deepEqual(getProviderConfig({ GEMINI_API_KEY: empty, WOKU_API_KEY: WOKU_KEY }),
    { ...wokuDefaults, apiKey: WOKU_KEY });
}
for (const selection of [undefined, '', ' \t\n ']) {
  const env = selection === undefined ? {} : { AI_PROVIDER: selection };
  Object.defineProperty(env, 'GEMINI_API_KEY', { get() { throw new Error('Read a key that must not select Gemini'); } });
  Object.defineProperty(env, 'GEMINI_MODEL', { get() { throw new Error('Read a model from unselected Gemini'); } });
  assert.deepEqual(getProviderConfig(env), wokuDefaults,
    'Default Woku selection must not inspect Gemini credentials or model settings');
}
groups++;

const bothProviders = { WOKU_API_KEY: WOKU_KEY, GEMINI_API_KEY: GEMINI_KEY,
  AI_MODEL: 'woku-primary', GEMINI_MODEL: 'gemini-primary' };
assert.deepEqual(getProviderConfig({ ...bothProviders, AI_PROVIDER: 'woku' }),
  { ...wokuDefaults, apiKey: WOKU_KEY, model: 'woku-primary', modelConfigured: true });
assert.deepEqual(getProviderConfig({ ...bothProviders, AI_PROVIDER: 'gemini' }),
  { ...geminiDefaults, apiKey: GEMINI_KEY, model: 'gemini-primary', modelConfigured: true });
groups++;

assert.deepEqual(getProviderConfig({ AI_PROVIDER: ' \tWoKu\n', WOKU_API_KEY: ` \n${WOKU_KEY}\t `,
  AI_MODEL: '  Custom-Woku-Model  ' }),
{ ...wokuDefaults, apiKey: WOKU_KEY, model: 'Custom-Woku-Model', modelConfigured: true });
assert.deepEqual(getProviderConfig({ AI_PROVIDER: ' \tGeMiNi\n', GEMINI_API_KEY: ` \n${GEMINI_KEY}\t `,
  GEMINI_MODEL: '  Custom-Gemini-Model  ' }),
{ ...geminiDefaults, apiKey: GEMINI_KEY, model: 'Custom-Gemini-Model', modelConfigured: true });
for (const empty of ['', ' \t\n ']) {
  assert.deepEqual(getProviderConfig({ AI_PROVIDER: 'woku', WOKU_API_KEY: empty, AI_MODEL: empty }), wokuDefaults);
  assert.deepEqual(getProviderConfig({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: empty, GEMINI_MODEL: empty }), geminiDefaults);
}
groups++;

for (const unsupported of ['google', 'openai', 'constructor', '__proto__', 'https://example.test', GEMINI_KEY]) {
  const env = { AI_PROVIDER: unsupported };
  for (const name of ['WOKU_API_KEY', 'GEMINI_API_KEY', 'AI_MODEL', 'GEMINI_MODEL']) {
    Object.defineProperty(env, name, { get() { throw new Error('Read configuration before rejecting invalid provider'); } });
  }
  assert.throws(() => getProviderConfig(env), error => error.message === 'AI_PROVIDER must be "woku" or "gemini".',
    'Reject unsupported providers before reading keys, without echoing the supplied value');
}
groups++;

assert.equal(Object.isFrozen(PROVIDER_ENDPOINTS), true);
assert.deepEqual(Object.keys(PROVIDER_ENDPOINTS), ['woku', 'gemini']);
for (const id of ['woku', 'gemini']) {
  const defaults = id === 'woku' ? wokuDefaults : geminiDefaults;
  assert.equal(Object.isFrozen(PROVIDER_ENDPOINTS[id]), true);
  assert.deepEqual(PROVIDER_ENDPOINTS[id], { chatEndpoint: defaults.chatEndpoint, catalogEndpoint: defaults.catalogEndpoint });
  assert.deepEqual(getProviderConfig({ AI_PROVIDER: id,
    AI_BASE_URL: 'https://example.test', GEMINI_BASE_URL: 'https://example.test',
    OPENAI_BASE_URL: 'https://example.test', CHAT_ENDPOINT: 'https://example.test',
    CATALOG_ENDPOINT: 'https://example.test'
  }), id === 'woku' ? wokuDefaults : geminiDefaults);
}
groups++;

console.log(`PASS ${groups} provider configuration groups: isolated keys/models, explicit selection with Woku default, fixed endpoints and no external requests`);
