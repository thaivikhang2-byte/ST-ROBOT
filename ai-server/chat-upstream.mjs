const endpoint = 'https://llm.wokushop.com/v1/chat/completions';
const messages = {
  AI_AUTH: 'Dịch vụ AI cần cập nhật quyền kết nối. Người quản trị hãy kiểm tra khóa API trên máy chủ.',
  AI_MODEL: 'Mô hình AI đang cấu hình chưa được dịch vụ hỗ trợ. Người quản trị hãy kiểm tra AI_MODEL trên máy chủ.',
  AI_QUOTA: 'Dịch vụ AI đã hết hạn mức từ nhà cung cấp. Người quản trị hãy kiểm tra hạn mức của tài khoản AI.',
  AI_BUSY: 'Dịch vụ AI đang bận. Bạn hãy thử lại sau ít phút.',
  AI_UNAVAILABLE: 'Dịch vụ AI đang tạm gián đoạn. Bạn có thể thử lại câu hỏi này.',
  AI_NETWORK: 'Máy chủ chưa kết nối được dịch vụ AI. Bạn có thể thử lại câu hỏi này.',
  AI_TIMEOUT: 'Dịch vụ AI phản hồi quá lâu. Bạn có thể thử lại câu hỏi này.',
  AI_RESPONSE: 'Dịch vụ AI trả về phản hồi chưa đầy đủ. Bạn có thể thử lại câu hỏi này.',
  AI_REQUEST: 'Dịch vụ AI chưa xử lý được yêu cầu này. Người quản trị hãy kiểm tra cấu hình kết nối.'
};

export class ChatUpstreamError extends Error {
  constructor(status, code, retryable, retryAfter) {
    super(messages[code]);
    this.name = 'ChatUpstreamError';
    this.status = status; this.code = code; this.retryable = retryable;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

function classifyResponse(status, payload) {
  const error = payload?.error;
  const code = typeof error?.code === 'string' ? error.code.toLowerCase() : '';
  const type = typeof error?.type === 'string' ? error.type.toLowerCase() : '';
  const text = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
  if (status === 401 || status === 403) return new ChatUpstreamError(503, 'AI_AUTH', false);
  if (status === 402 || /insufficient_quota|quota_exceeded|billing|insufficient_balance|credit/.test(`${code} ${type}`)
    || (status === 429 && /insufficient.{0,20}(quota|credit|balance)|billing|quota.{0,15}exhaust/.test(text))) return new ChatUpstreamError(503, 'AI_QUOTA', false);
  if ([400, 404, 422].includes(status) && (/model/.test(code) || /model|mô hình/.test(text))) return new ChatUpstreamError(503, 'AI_MODEL', false);
  if (status === 429) return new ChatUpstreamError(429, 'AI_BUSY', true, 60);
  if (status === 408 || status >= 500) return new ChatUpstreamError(503, 'AI_UNAVAILABLE', true);
  return new ChatUpstreamError(502, 'AI_REQUEST', false);
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
  maxTokens = 1200, timeoutMs = 55000, retryDelayMs = 400, requestId, logger = console.error }) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key) throw new ChatUpstreamError(503, 'AI_AUTH', false);
  const controller = new AbortController();
  let timer;
  const timeoutError = () => new ChatUpstreamError(504, 'AI_TIMEOUT', true);
  const log = (error, attempt, status) => logger(JSON.stringify({
    event: 'ai_upstream_failure', code: error.code, status: status || null, attempt, requestId
  }));
  const work = async () => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      let failure, status, providerRetryAfter;
      try {
        const response = await upstream(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, messages: conversation, max_tokens: maxTokens }), signal: controller.signal
        });
        if (controller.signal.aborted) throw timeoutError();
        status = response.status;
        providerRetryAfter = retryAfterSeconds(response);
        let payload;
        try { payload = await response.json(); }
        catch { if (response.ok) throw new ChatUpstreamError(502, 'AI_RESPONSE', true); }
        if (controller.signal.aborted) throw timeoutError();
        if (!response.ok) throw classifyResponse(status, payload);
        const content = payload?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) throw new ChatUpstreamError(502, 'AI_RESPONSE', true);
        return content.slice(0, 12000);
      } catch (error) {
        if (controller.signal.aborted) throw timeoutError();
        failure = error instanceof ChatUpstreamError ? error : new ChatUpstreamError(502, 'AI_NETWORK', true);
        if (providerRetryAfter !== null && providerRetryAfter !== undefined && failure.retryable) failure.retryAfter = providerRetryAfter;
        log(failure, attempt, status);
      }
      // A malformed/empty completion may have already consumed a full generation;
      // let the learner retry it explicitly rather than automatically paying twice.
      if (!failure.retryable || failure.code === 'AI_RESPONSE' || attempt === 2) throw failure;
      // Long provider cooldowns are returned to the caller, not ignored or held
      // open past the request budget. At most one short retry is automatic.
      if (providerRetryAfter > 1) throw failure;
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
