// Optional one-request smoke through ST-Robot, never a direct unrestricted provider proxy.
// No token, prompt, response content or provider credentials are printed.
async function main() {
  if (process.env.AI_LIVE_SMOKE !== '1') {
    console.log('SKIPPED: AI_LIVE_SMOKE is not 1; no network requests made');
    return;
  }
  const base = new URL(process.env.AI_SMOKE_BASE_URL || 'http://127.0.0.1/api/v1/ai/');
  if (!['127.0.0.1', 'localhost'].includes(base.hostname) || base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/'))
    throw new Error('Use an explicit local ST-Robot AI base URL ending in /');
  const token = process.env.AI_SMOKE_ACCESS_TOKEN;
  const modelId = process.env.AI_SMOKE_MODEL_ID;
  const ceiling = Number(process.env.AI_SMOKE_MAX_COST_USD);
  const version = process.env.AI_SMOKE_CONFIRMED_PRICE_VERSION;
  if (!token || !/^[a-f0-9-]{36}$/i.test(modelId || '') || !(ceiling > 0 && ceiling <= 0.05) || !version)
    throw new Error('Supply an access token, registry model UUID, confirmed current pricing version and explicit cost ceiling in (0, 0.05] USD');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const modelsResponse = await fetch(new URL('models', base), { headers, signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!modelsResponse.ok) throw new Error(`Registry lookup failed: HTTP ${modelsResponse.status}`);
  const models = (await modelsResponse.json()).data;
  const model = models.find((item) => item.id === modelId);
  if (!model || model.pricing_version !== version || model.input_price === null || model.output_price === null || !model.capabilities.includes('chat'))
    throw new Error('Model must have enabled chat and a pricing version confirmed against current provider prices');
  const worstCase = (Number(model.input_price) * model.max_input_tokens + Number(model.output_price) * 16) / 1000000;
  if (!Number.isFinite(worstCase) || worstCase < 0 || worstCase > ceiling)
    throw new Error('Configured worst-case token cost exceeds the explicit smoke budget');
  console.log(`One request authorized by operator flags; configured worst-case estimate <= ${ceiling} USD; retries/fallback disabled`);
  const result = await fetch(new URL('chat', base), { method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(125000), body: JSON.stringify({ modelId, allowFallback: false, maxOutputTokens: 16, messages: [{ role: 'user', content: 'Reply OK.' }] }) });
  const body = await result.json();
  if (!result.ok) throw new Error(`Gateway failed: HTTP ${result.status}, code=${body.error?.code || 'unknown'}`);
  console.log(JSON.stringify({ status: 'PASS', requestId: body.data.requestId, provider: body.data.provider, usage: body.data.usage }));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'Live smoke failed'); process.exitCode = 1; });
