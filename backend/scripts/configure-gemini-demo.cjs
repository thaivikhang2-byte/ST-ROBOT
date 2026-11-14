// Offline setup inside the operator container. No Gemini network request, no model enablement.
const fs = require('node:fs/promises');
const { VaultStore } = require('/app/dist/modules/ai-gateway/vault/vault-store');
(async () => {
  if (process.env.AI_GATEWAY_ENABLED !== 'false') throw new Error('Prepare with AI disabled');
  const store = new VaultStore('/app/private-ai/ai-providers.enc.json', process.env.AI_CREDENTIALS_MASTER_KEY || '', process.env.AI_CREDENTIALS_KEY_ID || 'demo-v1');
  const vault = await store.read();
  const provider = JSON.parse(await fs.readFile('/app/demo-config/gemini-demo.json', 'utf8'));
  if (provider.enabled !== false || provider.type !== 'gemini') throw new Error('Only disabled Gemini metadata is permitted');
  if (!vault.providers.some(p => p.id === 'gemini')) await store.replaceProvider(vault.revision, provider);
  if (!process.env.DEMO_POSTGRES_VOLUME?.startsWith('st-robot-demo-')) throw new Error('Demo volume guard required');
  const db = new (require('@prisma/client').PrismaClient)();
  try {
    await db.aiProvider.upsert({ where: { id: 'gemini' }, update: {}, create: { id: 'gemini', type: 'gemini', enabled: false } });
    await db.aiModel.upsert({ where: { provider_id_model_id: { provider_id: 'gemini', model_id: provider.models[0] } }, update: {}, create: {
      provider_id: 'gemini', model_id: provider.models[0], enabled: false, is_default: false,
      capabilities: ['chat', 'streaming'], allowed_tools: [], max_input_tokens: 8192, max_output_tokens: 1024, context_tokens: 32768,
    } });
  } finally { await db.$disconnect(); }
  console.log('Gemini metadata prepared; no credentials imported, no billable calls made.');
})().catch(() => { console.error('Gemini offline setup failed; secrets withheld.'); process.exitCode = 1; });
