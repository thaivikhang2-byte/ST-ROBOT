// Maintenance only. Supply keys through protected environment injection, never command arguments.
require('ts-node/register');
const { VaultStore } = require('../src/modules/ai-gateway/vault/vault-store');
const env = process.env;
const operation = process.argv[2];
(async()=>{
  const store=new VaultStore(env.AI_PROVIDERS_CONFIG_PATH||'config/ai-providers.enc.json',env.AI_CREDENTIALS_MASTER_KEY||'',env.AI_CREDENTIALS_KEY_ID||'master-v1');
  const expected=Number(env.AI_VAULT_EXPECTED_REVISION);
  if(!Number.isSafeInteger(expected)||expected<0)throw new Error('Explicit revision required');
  let revision;
  if(operation==='rotate')revision=await store.rotate(expected,env.AI_NEW_CREDENTIALS_MASTER_KEY||'',env.AI_NEW_CREDENTIALS_KEY_ID||'');
  else if(operation==='restore')revision=await store.restoreBackup(expected);
  else throw new Error('Supported maintenance operations: rotate or restore');
  console.log(JSON.stringify({operation,revision,note:'Deploy matching environment key before restarting application; protected encrypted backup retained.'}));
})().catch(()=>{console.error('AI vault maintenance failed. Preserve the vault/backup and review configuration; no key material was printed.');process.exitCode=1;});
