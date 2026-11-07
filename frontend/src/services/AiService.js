export const AI_SERVICE_ORIGIN = 'https://st-robot-1.onrender.com';
const paths = new Set(['/api/home-chat', '/api/tutor']);
const codes = new Set(['AI_AUTH', 'AI_MODEL', 'AI_QUOTA', 'AI_BUSY', 'AI_UNAVAILABLE', 'AI_NETWORK',
    'AI_TIMEOUT', 'AI_RESPONSE', 'AI_REQUEST', 'AI_STARTUP_TIMEOUT', 'AI_STARTUP_RESPONSE', 'AI_REPLY_TIMEOUT']);
const stages = new Set(['startup', 'reply', 'provider', 'transport', 'server']);
export const AI_PROVIDER_CODES = Object.freeze(['invalid_api_key', 'invalid_authentication', 'authentication_error',
    'access_denied', 'permission_denied', 'model_not_found', 'model_not_supported', 'invalid_model',
    'model_not_available', 'unsupported_model', 'insufficient_quota', 'quota_exceeded', 'insufficient_balance',
    'billing_error', 'rate_limit_exceeded', 'server_error', 'service_unavailable', 'overloaded_error',
    'no_available_channel', 'channel_not_found', 'unsupported_parameter', 'invalid_request_error', 'invalid_request']);
const providerCodes = new Set(AI_PROVIDER_CODES);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export class AiRequestError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'AiRequestError';
        this.code = codes.has(details.code) ? details.code : 'AI_UNAVAILABLE';
        this.stage = stages.has(details.stage) ? details.stage : 'reply';
        this.retryable = details.retryable !== false;
        if (Number.isInteger(details.httpStatus) && details.httpStatus >= 100 && details.httpStatus <= 599) this.httpStatus = details.httpStatus;
        if (Number.isInteger(details.upstreamStatus) && details.upstreamStatus >= 400 && details.upstreamStatus <= 599) this.upstreamStatus = details.upstreamStatus;
        if (providerCodes.has(details.providerCode)) this.providerCode = details.providerCode;
        if (typeof details.requestId === 'string' && uuid.test(details.requestId)) this.requestId = details.requestId;
        if (Number.isInteger(details.catalogStatus) && details.catalogStatus >= 100 && details.catalogStatus <= 599) this.catalogStatus = details.catalogStatus;
        if (['ok', 'http_error', 'invalid_response', 'timeout', 'network_error'].includes(details.catalogResult)) this.catalogResult = details.catalogResult;
        if (Number.isInteger(details.candidateCount) && details.candidateCount >= 0 && details.candidateCount <= 3) this.candidateCount = details.candidateCount;
        if (typeof details.fallbackAttempted === 'boolean') this.fallbackAttempted = details.fallbackAttempted;
    }
}

const cancelled = () => new DOMException('Request cancelled', 'AbortError');

function wait(delay, signal) {
    return new Promise((resolve, reject) => {
        const finish = (callback, value) => { clearTimeout(timer); signal.removeEventListener('abort', abort); callback(value); };
        const abort = () => finish(reject, signal.reason || cancelled());
        const timer = setTimeout(() => finish(resolve), delay);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
    });
}

async function withinDeadline(operation, timeoutMs, parent, timeoutError) {
    if (parent?.aborted) throw cancelled();
    const controller = new AbortController();
    let timer, onCancel;
    const interruption = new Promise((_, reject) => {
        onCancel = () => { const error = cancelled(); controller.abort(error); reject(error); };
        parent?.addEventListener('abort', onCancel, { once: true });
        timer = setTimeout(() => { const error = timeoutError(); controller.abort(error); reject(error); }, timeoutMs);
    });
    try {
        return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), interruption]);
    } finally {
        clearTimeout(timer);
        parent?.removeEventListener('abort', onCancel);
        controller.abort();
    }
}

function failure(response, data, stage) {
    return new AiRequestError(typeof data?.error === 'string' && data.error.trim()
        ? data.error.slice(0, 500) : 'Dịch vụ AI chưa trả lời được. Bạn có thể thử lại.', {
        code: data?.code, stage: stages.has(data?.stage) ? data.stage : stage,
        httpStatus: response.status, upstreamStatus: data?.upstreamStatus,
        providerCode: data?.providerCode, requestId: data?.requestId, retryable: data?.retryable,
        catalogStatus:data?.catalogStatus,catalogResult:data?.catalogResult,candidateCount:data?.candidateCount,
        fallbackAttempted:data?.fallbackAttempted
    });
}

export function createAiClient({ fetchImpl = (...args) => globalThis.fetch(...args),
    startupTimeoutMs = 90000, replyTimeoutMs = 65000, retryDelayMs = 1000, readinessTtlMs = 300000 } = {}) {
    let readyUntil = 0;

    async function start(signal, onStatus) {
        if (Date.now() < readyUntil) return;
        onStatus?.('starting');
        await withinDeadline(async phaseSignal => {
            while (!phaseSignal.aborted) {
                let response;
                try {
                    response = await fetchImpl(AI_SERVICE_ORIGIN + '/health', {
                        method: 'GET', credentials: 'omit', cache: 'no-store', signal: phaseSignal
                    });
                } catch (error) {
                    if (phaseSignal.aborted) throw phaseSignal.reason || cancelled();
                    if (!(error instanceof TypeError)) throw error;
                    await wait(retryDelayMs, phaseSignal);
                    continue;
                }
                if (phaseSignal.aborted) throw phaseSignal.reason || cancelled();
                if ([408, 429, 502, 503, 504].includes(response.status)) {
                    try { await response.body?.cancel?.(); } catch {}
                    await wait(retryDelayMs, phaseSignal);
                    continue;
                }
                let data;
                try { data = await response.json(); }
                catch {
                    throw new AiRequestError('Máy chủ chưa gửi được thông tin kết nối. Bạn có thể thử lại.', {
                        code: 'AI_STARTUP_RESPONSE', stage: 'startup', httpStatus: response.status
                    });
                }
                if (phaseSignal.aborted) throw phaseSignal.reason || cancelled();
                if (!response.ok) throw failure(response, data, 'startup');
                if (data?.ok !== true) throw new AiRequestError('Máy chủ chưa sẵn sàng trả lời. Bạn có thể thử lại.', {
                    code: 'AI_STARTUP_RESPONSE', stage: 'startup', httpStatus: response.status
                });
                if (data.ai?.keyConfigured === false) throw new AiRequestError('Dịch vụ AI cần cập nhật quyền kết nối. Người quản trị hãy kiểm tra khóa API trên máy chủ.', {
                    code: 'AI_AUTH', stage: 'startup', httpStatus: response.status, retryable: false
                });
                readyUntil = Date.now() + readinessTtlMs;
                return;
            }
            throw phaseSignal.reason || cancelled();
        }, startupTimeoutMs, signal, () => new AiRequestError('Máy chủ chưa khởi động kịp. Bạn có thể thử lại câu hỏi này.', {
            code: 'AI_STARTUP_TIMEOUT', stage: 'startup'
        }));
    }

    async function requestReply(path, payload, { signal, onStatus } = {}) {
        if (!paths.has(path)) throw new TypeError('Unknown AI reply endpoint');
        if (signal?.aborted) throw cancelled();
        await start(signal, onStatus);
        onStatus?.('replying');
        try {
            return await withinDeadline(async phaseSignal => {
                let response;
                try {
                    response = await fetchImpl(AI_SERVICE_ORIGIN + path, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
                        body: JSON.stringify(payload), signal: phaseSignal
                    });
                } catch (error) {
                    if (phaseSignal.aborted) throw phaseSignal.reason || cancelled();
                    if (error instanceof TypeError) throw new AiRequestError('Kết nối với trợ lý bị gián đoạn. Bạn có thể thử lại.', {
                        code: 'AI_NETWORK', stage: 'reply'
                    });
                    throw error;
                }
                if (phaseSignal.aborted) throw phaseSignal.reason || cancelled();
                let data;
                try { data = await response.json(); }
                catch {
                    throw new AiRequestError('Máy chủ chưa trả lời đầy đủ. Bạn có thể thử lại.', {
                        code: 'AI_RESPONSE', stage: 'reply', httpStatus: response.status
                    });
                }
                if (phaseSignal.aborted) throw phaseSignal.reason || cancelled();
                if (!response.ok) throw failure(response, data, 'reply');
                if (typeof data?.reply !== 'string' || !data.reply.trim()) throw new AiRequestError('Trợ lý chưa gửi được câu trả lời. Bạn có thể thử lại.', {
                    code: 'AI_RESPONSE', stage: 'reply', httpStatus: response.status
                });
                readyUntil = Date.now() + readinessTtlMs;
                return data.reply;
            }, replyTimeoutMs, signal, () => new AiRequestError('Dịch vụ AI phản hồi quá lâu. Bạn có thể thử lại câu hỏi này.', {
                code: 'AI_REPLY_TIMEOUT', stage: 'reply'
            }));
        } catch (error) {
            if (error?.code === 'AI_NETWORK' || error?.code === 'AI_REPLY_TIMEOUT') readyUntil = 0;
            throw error;
        }
    }
    return { requestReply };
}

export const aiClient = createAiClient();
