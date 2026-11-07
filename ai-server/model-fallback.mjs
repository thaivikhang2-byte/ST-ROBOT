import { createHash } from 'node:crypto';
import { selectGeminiCandidates, isGeminiModel } from './model-selection.mjs';
export { GEMINI_FALLBACK_MODELS, MAX_FALLBACK_CANDIDATES, isGeminiModel, isAllowedFallbackModel } from './model-selection.mjs';

const catalogUrl = 'https://llm.wokushop.com/v1/models';

const cancelled = signal => signal?.reason || new DOMException('Request cancelled', 'AbortError');

function emitDiagnostic(observer, diagnostic) {
  if (typeof observer !== 'function') return;
  // Observers receive only fixed result labels, bounded status/count metadata.
  // A diagnostic consumer must never break or delay model selection.
  try { Promise.resolve(observer({ ...diagnostic })).catch(() => {}); } catch {}
}

// Catalog membership is required before changing a model. It does not establish
// that the model is currently healthy, cheaper, or equivalent to the primary.
export function createModelFallbackResolver({ upstream = fetch, catalogTimeoutMs = 5000, cacheTtlMs = 600000 } = {}) {
  const cache = new Map();

  async function readCatalog(key, parent, currentModel) {
    const controller = new AbortController();
    let timer, onAbort, catalogStatus, catalogInfo = {};
    const outcome = (catalogResult, available = null) => ({
      available,
      diagnostic: {
        ...(catalogStatus === undefined ? {} : { catalogStatus }),
        catalogResult,
        ...catalogInfo,
        ...(available === null ? {} : { candidateCount: available.size })
      }
    });
    const interruption = new Promise((resolve, reject) => {
      onAbort = () => {
        const error = cancelled(parent);
        reject(error);
        controller.abort(error);
      };
      parent?.addEventListener('abort', onAbort, { once: true });
      if (parent?.aborted) { onAbort(); return; }
      timer = setTimeout(() => {
        resolve(outcome('timeout'));
        controller.abort(new DOMException('Catalog timed out', 'TimeoutError'));
      }, catalogTimeoutMs);
    });
    let failureResult = 'network_error';
    const operation = Promise.resolve().then(async () => {
      if (controller.signal.aborted) return outcome('timeout');
      const response = await upstream(catalogUrl, {
        method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${key}` },
        signal: controller.signal
      });
      if (controller.signal.aborted) return outcome('timeout');
      failureResult = 'invalid_response';
      const status = response.status;
      if (Number.isInteger(status) && status >= 100 && status <= 599) {
        catalogStatus = status;
      }
      if (!response.ok) {
        // Do not read or expose failed provider bodies. Cancel an unread stream
        // without letting a non-cooperative body extend the catalog deadline.
        try { response.body?.cancel?.()?.catch?.(() => {}); } catch {}
        return outcome('http_error');
      }
      const payload = await response.json();
      if (controller.signal.aborted) return outcome('timeout');
      if (!payload || !Array.isArray(payload.data) || payload.data.length > 5000
        || payload.data.some(row => !row || typeof row !== 'object' || Array.isArray(row)
          || typeof row.id !== 'string' || !row.id.length || row.id.length > 200)) return outcome('invalid_response');
      // Select exact advertised IDs, retaining only a bounded shortlist and
      // safe counts/flags rather than the full provider catalog.
      const ids = new Set(payload.data.map(row => row.id));
      catalogInfo = { catalogModelCount:payload.data.length, configuredModelListed:ids.has(currentModel) };
      return outcome('ok', new Set(selectGeminiCandidates(ids, currentModel)));
    }).catch(() => {
      if (parent?.aborted) throw cancelled(parent);
      return outcome(failureResult);
    });
    try {
      return await Promise.race([interruption, operation]);
    } finally {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
      controller.abort();
    }
  }

  return async function resolveFallbackModel({ apiKey, currentModel, signal, onDiagnostic } = {}) {
    if (signal?.aborted) throw cancelled(signal);
    const key = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!key || !isGeminiModel(currentModel)) return null;
    const current = currentModel;
    const now = Date.now();
    for (const [fingerprint, entry] of cache) if (entry.expiresAt <= now) cache.delete(fingerprint);
    const fingerprint = createHash('sha256').update(key).update('\0').update(current).digest('hex');
    const cached = cache.get(fingerprint);
    let available = cached?.available;
    if (!available) {
      const result = await readCatalog(key, signal, current);
      if (signal?.aborted) throw cancelled(signal);
      available = result.available;
      emitDiagnostic(onDiagnostic, result.diagnostic);
      if (available === null) return null;
      if (cache.size >= 8 && !cache.has(fingerprint)) cache.delete(cache.keys().next().value);
      cache.set(fingerprint, { available,
        catalogModelCount:result.diagnostic.catalogModelCount,configuredModelListed:result.diagnostic.configuredModelListed,
        expiresAt: Date.now() + cacheTtlMs });
    } else {
      emitDiagnostic(onDiagnostic, { catalogStatus:200,catalogResult:'ok',candidateCount:available.size,
        catalogModelCount:cached.catalogModelCount,configuredModelListed:cached.configuredModelListed });
    }
    return available.values().next().value || null;
  };
}
