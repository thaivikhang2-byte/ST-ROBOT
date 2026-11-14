import * as Joi from 'joi';
import { EncryptedCredential } from './credential-crypto';

export const PROVIDER_TYPES = [
  'openai',
  'anthropic',
  'gemini',
  'openai-compatible',
  'openrouter',
  'workers-ai',
] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];
export const PROVIDER_CAPABILITIES: Record<ProviderType, readonly string[]> = {
  openai: [
    'chat',
    'responses',
    'streaming',
    'embeddings',
    'tools',
    'temperature',
    'structured_output',
    'reasoning_context',
    'model-list',
  ],
  anthropic: ['chat', 'streaming', 'tools', 'temperature', 'reasoning_context', 'structured_output', 'model-list'],
  gemini: [
    'chat',
    'streaming',
    'embeddings',
    'tools',
    'temperature',
    'structured_output',
    'vision',
    'reasoning_context',
    'model-list',
  ],
  'openai-compatible': [
    'chat',
    'streaming',
    'tools',
    'temperature',
    'embeddings',
    'structured_output',
    'model-list',
  ],
  openrouter: [
    'chat',
    'streaming',
    'tools',
    'temperature',
    'embeddings',
    'structured_output',
    'model-list',
  ],
  'workers-ai': [
    'chat',
    'streaming',
    'tools',
    'temperature',
    'embeddings',
    'structured_output',
    'model-list',
  ],
};
export interface VaultLimits {
  requestsPerMinute: number;
  tokensPerDay: number;
  maxConcurrent: number;
}
export interface VaultEndpoint {
  id: string;
  baseUrl: string;
  enabled: boolean;
  capabilities: string[];
}
export interface VaultCredential {
  id: string;
  enabled: boolean;
  endpointIds: string[];
  limits: VaultLimits;
  encrypted: EncryptedCredential;
}
export interface VaultProvider {
  id: string;
  type: ProviderType;
  enabled: boolean;
  accountGroup: string;
  privacyGroup: string;
  models: string[];
  endpoints: VaultEndpoint[];
  credentials: VaultCredential[];
  limits: VaultLimits;
  timeoutMs: number;
  priority: number;
  selection: 'priority' | 'round-robin';
  maxRetries: 0;
}
export interface AiVault {
  version: 1;
  revision: number;
  defaultProviderId?: string;
  providers: VaultProvider[];
}
const id = Joi.string().pattern(/^[a-zA-Z0-9_-]{1,64}$/);
const limits = Joi.object({
  requestsPerMinute: Joi.number().integer().min(1).max(10000).required(),
  tokensPerDay: Joi.number().integer().min(0).max(1000000000).required(),
  maxConcurrent: Joi.number().integer().min(1).max(100).required(),
})
  .unknown(false)
  .required();
const encrypted = Joi.object({
  version: Joi.valid(1).required(),
  algorithm: Joi.valid('aes-256-gcm').required(),
  keyId: id.required(),
  iv: Joi.string().max(32).required(),
  authTag: Joi.string().max(32).required(),
  ciphertext: Joi.string().max(5500).required(),
})
  .unknown(false)
  .required();
export const vaultSchema = Joi.object({
  version: Joi.valid(1).required(),
  revision: Joi.number().integer().min(0).max(Number.MAX_SAFE_INTEGER).required(),
  defaultProviderId: Joi.string().max(20),
  providers: Joi.array()
    .max(32)
    .unique('id')
    .items(
      Joi.object({
        id: Joi.string()
          .pattern(/^[a-zA-Z0-9_-]{1,20}$/)
          .required(),
        type: Joi.valid(...PROVIDER_TYPES).required(),
        enabled: Joi.boolean().required(),
        accountGroup: id.required(),
        privacyGroup: id.required(),
        models: Joi.array()
          .max(200)
          .unique()
          .items(Joi.string().pattern(/^[a-zA-Z0-9@_.:/-]{1,200}$/))
          .required(),
        endpoints: Joi.array()
          .min(1)
          .max(8)
          .unique('id')
          .items(
            Joi.object({
              id: id.required(),
              baseUrl: Joi.string()
                .uri({ scheme: ['https'] })
                .max(500)
                .required(),
              enabled: Joi.boolean().required(),
              capabilities: Joi.array().min(1).unique().items(Joi.string()).required(),
            }).unknown(false),
          )
          .required(),
        credentials: Joi.array()
          .max(32)
          .unique('id')
          .items(
            Joi.object({
              id: id.required(),
              enabled: Joi.boolean().required(),
              endpointIds: Joi.array().min(1).max(8).unique().items(id).required(),
              limits,
              encrypted,
            }).unknown(false),
          )
          .required(),
        limits,
        timeoutMs: Joi.number().integer().min(1000).max(120000).required(),
        priority: Joi.number().integer().min(0).max(1000).required(),
        selection: Joi.valid('priority', 'round-robin').required(),
        maxRetries: Joi.valid(0).required(),
      }).unknown(false),
    )
    .required(),
}).unknown(false);

export function validateVault(value: unknown): AiVault {
  const result = vaultSchema.validate(value, { convert: false });
  if (result.error) throw new Error('Invalid AI vault schema');
  const vault = result.value as AiVault;
  if (vault.defaultProviderId && !vault.providers.some((p) => p.id === vault.defaultProviderId))
    throw new Error('Invalid AI vault default provider');
  for (const provider of vault.providers) {
    for (const endpoint of provider.endpoints) {
      const url = new URL(endpoint.baseUrl);
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.port && url.port !== '443') ||
        endpoint.capabilities.some((c) => !PROVIDER_CAPABILITIES[provider.type].includes(c))
      )
        throw new Error('Invalid AI endpoint policy');
    }
    for (const credential of provider.credentials)
      if (credential.endpointIds.some((id) => !provider.endpoints.some((e) => e.id === id)))
        throw new Error('Invalid AI credential endpoints');
  }
  return vault;
}
export function credentialAad(
  provider: VaultProvider,
  credential: Pick<VaultCredential, 'id' | 'enabled' | 'endpointIds' | 'limits'>,
  keyId: string,
) {
  const metadata = { ...provider, credentials: undefined };
  return JSON.stringify({
    version: 1,
    keyId,
    provider: metadata,
    credential: {
      id: credential.id,
      enabled: credential.enabled,
      endpointIds: credential.endpointIds,
      limits: credential.limits,
    },
  });
}
