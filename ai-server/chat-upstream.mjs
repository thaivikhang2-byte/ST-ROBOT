import { MAX_FALLBACK_CANDIDATES, isGeminiModel, isAllowedFallbackModel } from './model-selection.mjs';
import { PROVIDER_ENDPOINTS } from './provider-config.mjs';

const defaultEndpoint = PROVIDER_ENDPOINTS.woku.chatEndpoint;
const supportedEndpoints = new Set(Object.values(PROVIDER_ENDPOINTS).map(provider => provider.chatEndpoint));
// Only these non-secret protocol codes may leave the provider adapter. Never
// reflect arbitrary error strings, messages, model names or provider bodies.
const providerCodes = new Set([
  'invalid_api_key', 'invalid_authentication', 'authentication_error', 'access_denied', 'permission_denied',
  'model_not_found', 'model_not_supported', 'invalid_model', 'model_not_available', 'unsupported_model',
  'insufficient_quota', 'quota_exceeded', 'insufficient_balance', 'billing_error', 'rate_limit_exceeded',
  'server_error', 'service_unavailable', 'overloaded_error', 'no_available_channel', 'channel_not_found',
  'unsupported_parameter', 'invalid_request_error', 'invalid_request'
]);
const invalidModelCodes = new Set(['model_not_found', 'model_not_supported', 'invalid_model', 'unsupported_model']);
const authenticationCodes = new Set(['invalid_api_key', 'invalid_authentication', 'authentication_error', 'access_denied', 'permission_denied']);
const catalogResults = new Set(['ok', 'http_error', 'invalid_response', 'timeout', 'network_error']);
function catalogDetails(value = {}) {
  const safe = {};
  if (!value || typeof value !== 'object') return safe;
  if (Number.isInteger(value.catalogStatus) && value.catalogStatus >= 100 && value.catalogStatus <= 599) safe.catalogStatus = value.catalogStatus;
  if (catalogResults.has(value.catalogResult)) safe.catalogResult = value.catalogResult;
  if (Number.isInteger(value.candidateCount) && value.candidateCount >= 0 && value.candidateCount <= MAX_FALLBACK_CANDIDATES) safe.candidateCount = value.candidateCount;
  if (Number.isInteger(value.catalogModelCount) && value.catalogModelCount >= 0 && value.catalogModelCount <= 5000) safe.catalogModelCount = value.catalogModelCount;
  if (typeof value.configuredModelListed === 'boolean') safe.configuredModelListed = value.configuredModelListed;
  if (typeof value.fallbackAttempted === 'boolean') safe.fallbackAttempted = value.fallbackAttempted;
  return safe;
}
const messages = {
  AI_AUTH: 'Dịch vụ AI cần cập nhật quyền kết nối. Người quản trị hãy kiểm tra khóa API trên máy chủ.',
  AI_MODEL: 'Mô hình AI đang cấu hình chưa được dịch vụ hỗ trợ. Người quản trị hãy kiểm tra cấu hình mô hình trên máy chủ.',
  AI_QUOTA: 'Dịch vụ AI đã hết hạn mức từ nhà cung cấp. Người quản trị hãy kiểm tra hạn mức của tài khoản AI.',
  AI_BUSY: 'Dịch vụ AI đang bận. Bạn hãy thử lại sau ít phút.',
  AI_UNAVAILABLE: 'Dịch vụ AI đang tạm gián đoạn. Bạn có thể thử lại câu hỏi này.',
  AI_NETWORK: 'Máy chủ chưa kết nối được dịch vụ AI. Bạn có thể thử lại câu hỏi này.',
  AI_TIMEOUT: 'Dịch vụ AI phản hồi quá lâu. Bạn có thể thử lại câu hỏi này.',
  AI_RESPONSE: 'Dịch vụ AI trả về phản hồi chưa đầy đủ. Bạn có thể thử lại câu hỏi này.',
  AI_REQUEST: 'Dịch vụ AI chưa xử lý được yêu cầu này. Người quản trị hãy kiểm tra cấu hình kết nối.'
};

export class ChatUpstreamError extends Error {
  constructor(status, code, retryable, retryAfter, diagnostics = {}) {
    super(messages[code]);
    this.name = 'ChatUpstreamError';
    this.status = status; this.code = code; this.retryable = retryable;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
    this.stage = ['provider', 'transport', 'server'].includes(diagnostics.stage) ? diagnostics.stage : 'transport';
    if (this.stage === 'provider' && Number.isInteger(diagnostics.upstreamStatus)
      && diagnostics.upstreamStatus >= 400 && diagnostics.upstreamStatus <= 599) this.upstreamStatus = diagnostics.upstreamStatus;
    if (this.stage === 'provider' && providerCodes.has(diagnostics.providerCode)) this.providerCode = diagnostics.providerCode;
    Object.assign(this, catalogDetails(diagnostics));
  }
}

function classifyResponse(status, payload) {
  const error = payload?.error;
  const code = typeof error?.code === 'string' ? error.code.toLowerCase() : '';
  const type = typeof error?.type === 'string' ? error.type.toLowerCase() : '';
  const text = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
  const diagnostics = { stage: 'provider', upstreamStatus: status,
    providerCode: providerCodes.has(code) ? code : providerCodes.has(type) ? type : undefined };
  const failure = (publicStatus, publicCode, retryable, retryAfter) => new ChatUpstreamError(publicStatus, publicCode, retryable, retryAfter, diagnostics);
  if (status === 401 || status === 403 || authenticationCodes.has(code) || authenticationCodes.has(type)) return failure(503, 'AI_AUTH', false);
  if (status === 402 || /insufficient_quota|quota_exceeded|billing|insufficient_balance|credit/.test(`${code} ${type}`)
    || (status === 429 && /insufficient.{0,20}(quota|credit|balance)|billing|quota.{0,15}exhaust/.test(text))) return failure(503, 'AI_QUOTA', false);
  if (invalidModelCodes.has(code) || invalidModelCodes.has(type)
    || ([400, 404, 422].includes(status) && (/model/.test(code) || /model|mô hình/.test(text)))) return failure(503, 'AI_MODEL', false);
  if (status === 429) return failure(429, 'AI_BUSY', true, 60);
  if (status === 408 || status >= 500) return failure(503, 'AI_UNAVAILABLE', true);
  return failure(502, 'AI_REQUEST', false);
}

function retryAfterSeconds(response) {
  const value = response.headers?.get?.('retry-after');
  if (typeof value !== 'string' || !value.trim()) return null;
  const numeric = Number(value);
  const seconds = Number.isFinite(numeric) ? numeric : (Date.parse(value) - Date.now()) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(86400, Math.ceil(seconds)) : null;
}

function waitForRetry(delay, signal) {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, delay);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

// One deadline includes connection, response body and the single transient retry.
// Failed provider bodies and credentials never leave this adapter or enter logs.
export async function requestChatCompletion({ upstream = fetch, apiKey, model, messages: conversation,
  maxTokens = 1200, timeoutMs = 55000, retryDelayMs = 400, requestId, logger = console.error, resolveFallbackModel, endpoint = defaultEndpoint }) {
  if (!supportedEndpoints.has(endpoint)) throw new Error('Unsupported AI completion endpoint.');
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key) throw new ChatUpstreamError(503, 'AI_AUTH', false, undefined, { stage: 'server' });
  const controller = new AbortController();
  let activeModel = model;
  let recoveryDetails = {};
  let timer;
  const timeoutError = () => new ChatUpstreamError(504, 'AI_TIMEOUT', true, undefined, recoveryDetails);
  const log = (error, attempt, status) => logger(JSON.stringify({
    event: 'ai_upstream_failure', code: error.code,
    status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    stage: error.stage, upstreamStatus: error.upstreamStatus, providerCode: error.providerCode, ...catalogDetails(error), attempt, requestId
  }));
  const work = async () => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      let failure, status, providerRetryAfter;
      try {
        if (attempt === 2 && activeModel !== model) recoveryDetails.fallbackAttempted = true;
        const response = await upstream(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model:activeModel, messages: conversation, max_tokens: maxTokens }), signal: controller.signal
        });
        if (controller.signal.aborted) throw timeoutError();
        status = response.status;
        providerRetryAfter = retryAfterSeconds(response);
        let payload;
        try { payload = await response.json(); }
        catch { if (response.ok) throw new ChatUpstreamError(502, 'AI_RESPONSE', true, undefined, { stage: 'provider' }); }
        if (controller.signal.aborted) throw timeoutError();
        if (!response.ok) throw classifyResponse(status, payload);
        const content = payload?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) throw new ChatUpstreamError(502, 'AI_RESPONSE', true, undefined, { stage: 'provider' });
        return content.slice(0, 12000);
      } catch (error) {
        if (controller.signal.aborted) throw timeoutError();
        failure = error instanceof ChatUpstreamError ? error : new ChatUpstreamError(502, 'AI_NETWORK', true);
        Object.assign(failure, catalogDetails(recoveryDetails));
        if (providerRetryAfter !== null && providerRetryAfter !== undefined && failure.retryable) failure.retryAfter = providerRetryAfter;
        log(failure, attempt, status);
      }
      // A malformed/empty completion may have already consumed a full generation;
      // let the learner retry it explicitly rather than automatically paying twice.
      if (failure.code === 'AI_RESPONSE' || attempt === 2) throw failure;
      // Long provider cooldowns are returned to the caller, not ignored or held
      // open past the request budget. At most one short retry is automatic.
      if (providerRetryAfter > 1) throw failure;
      let switchedModel = false;
      if (typeof resolveFallbackModel === 'function' && isGeminiModel(activeModel) && failure.stage === 'provider'
        && (failure.code === 'AI_MODEL' || (failure.code === 'AI_UNAVAILABLE' && failure.upstreamStatus >= 500))) {
        let candidate;
        recoveryDetails.fallbackAttempted = false;
        try {
          candidate = await resolveFallbackModel({ apiKey:key, currentModel:activeModel, signal:controller.signal,
            onDiagnostic: detail => {
              const safe = catalogDetails(detail);
              delete safe.fallbackAttempted;
              recoveryDetails = {...recoveryDetails,...safe};
            }
          });
        }
        catch { /* A catalog failure cannot replace the original provider error. */ }
        if (controller.signal.aborted) throw timeoutError();
        if (isAllowedFallbackModel(candidate, activeModel)) {
          activeModel = candidate; switchedModel = true;
          logger(JSON.stringify({event:'ai_model_fallback',requestId,reason:failure.code}));
        }
        Object.assign(failure, catalogDetails(recoveryDetails));
      }
      if (!failure.retryable && !switchedModel) throw failure;
      const delay = Math.max(retryDelayMs, (providerRetryAfter || 0) * 1000);
      if (delay > 0) await waitForRetry(delay, controller.signal);
      if (controller.signal.aborted) throw timeoutError();
    }
  };
  try {
    return await Promise.race([work(), new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); const error = timeoutError(); log(error, 0); reject(error); }, timeoutMs);
    })]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
