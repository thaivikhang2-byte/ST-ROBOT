import { createHash } from 'node:crypto';

const catalogUrl = 'https://llm.wokushop.com/v1/models';
export const GEMINI_FALLBACK_MODELS = Object.freeze([
  'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'
]);

export function isGeminiModel(value) {
  return typeof value === 'string' && value.trim().length <= 200
    && /^gemini(?:[-\s]|$)/i.test(value.trim());
}

const cancelled = signal => signal?.reason || new DOMException('Request cancelled', 'AbortError');

// Catalog membership is required before changing a model. It does not establish
// that the model is currently healthy, cheaper, or equivalent to the primary.
export function createModelFallbackResolver({ upstream = fetch, catalogTimeoutMs = 5000, cacheTtlMs = 600000 } = {}) {
  const cache = new Map();

  async function readCatalog(key, parent) {
    const controller = new AbortController();
    let timer, onAbort;
    const interruption = new Promise((resolve, reject) => {
      onAbort = () => {
        const error = cancelled(parent);
        reject(error);
        controller.abort(error);
      };
      parent?.addEventListener('abort', onAbort, { once: true });
      if (parent?.aborted) { onAbort(); return; }
      timer = setTimeout(() => {
        resolve(null);
        controller.abort(new DOMException('Catalog timed out', 'TimeoutError'));
      }, catalogTimeoutMs);
    });
    const operation = Promise.resolve().then(async () => {
      if (controller.signal.aborted) return null;
      const response = await upstream(catalogUrl, {
        method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${key}` },
        signal: controller.signal
      });
      if (controller.signal.aborted) return null;
      if (!response.ok) {
        // Do not read or expose failed provider bodies. Cancel an unread stream
        // without letting a non-cooperative body extend the catalog deadline.
        try { response.body?.cancel?.()?.catch?.(() => {}); } catch {}
        return null;
      }
      const payload = await response.json();
      if (controller.signal.aborted) return null;
      if (!payload || !Array.isArray(payload.data) || payload.data.length > 5000
        || payload.data.some(row => !row || typeof row !== 'object' || Array.isArray(row)
          || typeof row.id !== 'string' || !row.id.length || row.id.length > 200)) return null;
      // Retain only the fixed candidate intersection, not the provider catalog.
      const ids = new Set(payload.data.map(row => row.id));
      return new Set(GEMINI_FALLBACK_MODELS.filter(id => ids.has(id)));
    }).catch(error => {
      if (parent?.aborted) throw cancelled(parent);
      return null;
    });
    try {
      return await Promise.race([interruption, operation]);
    } finally {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
      controller.abort();
    }
  }

  return async function resolveFallbackModel({ apiKey, currentModel, signal } = {}) {
    if (signal?.aborted) throw cancelled(signal);
    const key = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!key || !isGeminiModel(currentModel)) return null;
    const current = currentModel.trim();
    const now = Date.now();
    for (const [fingerprint, entry] of cache) if (entry.expiresAt <= now) cache.delete(fingerprint);
    const fingerprint = createHash('sha256').update(key).digest('hex');
    const cached = cache.get(fingerprint);
    let available = cached?.available;
    if (!available) {
      available = await readCatalog(key, signal);
      if (signal?.aborted) throw cancelled(signal);
      if (available === null) return null;
      if (cache.size >= 8 && !cache.has(fingerprint)) cache.delete(cache.keys().next().value);
      cache.set(fingerprint, { available, expiresAt: Date.now() + cacheTtlMs });
    }
    return GEMINI_FALLBACK_MODELS.find(id => id !== current && available.has(id)) || null;
  };
}
