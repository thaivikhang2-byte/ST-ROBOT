export const PROVIDER_ENDPOINTS = Object.freeze({
  woku: Object.freeze({
    chatEndpoint: 'https://llm.wokushop.com/v1/chat/completions',
    catalogEndpoint: 'https://llm.wokushop.com/v1/models'
  }),
  gemini: Object.freeze({
    chatEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    catalogEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/models'
  })
});

const providers = Object.freeze({
  woku: Object.freeze({
    keyVariable: 'WOKU_API_KEY',
    modelVariable: 'AI_MODEL',
    defaultModel: 'gemini-4-argon'
  }),
  gemini: Object.freeze({
    keyVariable: 'GEMINI_API_KEY',
    modelVariable: 'GEMINI_MODEL',
    defaultModel: 'gemini-3.8-flash'
  })
});

const trimmed = value => typeof value === 'string' ? value.trim() : '';

// Keys and model settings belong to one provider. Gemini requires an explicit
// selection; adding its key alone must not change the default Woku provider.
export function getProviderConfig(env = process.env) {
  const explicit = trimmed(env.AI_PROVIDER).toLowerCase();
  const id = explicit || 'woku';
  if (!Object.hasOwn(providers, id)) {
    throw new Error('AI_PROVIDER must be "woku" or "gemini".');
  }
  const provider = providers[id];
  const configuredModel = trimmed(env[provider.modelVariable]);
  return {
    id,
    keyVariable: provider.keyVariable,
    modelVariable: provider.modelVariable,
    apiKey: trimmed(env[provider.keyVariable]),
    model: configuredModel || provider.defaultModel,
    ...PROVIDER_ENDPOINTS[id],
    modelConfigured: Boolean(configuredModel)
  };
}
