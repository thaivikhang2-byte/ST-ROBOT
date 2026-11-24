import { accountService } from './AccountService.js';

export const AI_SERVICE_ORIGIN = 'https://st-robot-1.onrender.com';
const paths = new Set(['/api/home-chat', '/api/tutor']);
const codes = new Set(['AI_AUTH', 'AI_MODEL', 'AI_QUOTA', 'AI_BUSY', 'AI_UNAVAILABLE', 'AI_NETWORK',
    'AI_TIMEOUT', 'AI_RESPONSE', 'AI_REQUEST', 'AI_IMAGE_INVALID', 'AI_IMAGE_TOO_LARGE', 'AI_IMAGE_UNSUPPORTED', 'AI_STARTUP_TIMEOUT', 'AI_STARTUP_RESPONSE', 'AI_REPLY_TIMEOUT']);
const stages = new Set(['startup', 'reply', 'provider', 'transport', 'server']);
export const AI_PROVIDER_CODES = Object.freeze(['invalid_api_key', 'invalid_authentication', 'authentication_error',
    'access_denied', 'permission_denied', 'model_not_found', 'model_not_supported', 'invalid_model',
    'model_not_available', 'unsupported_model', 'insufficient_quota', 'quota_exceeded', 'insufficient_balance',
    'billing_error', 'rate_limit_exceeded', 'server_error', 'service_unavailable', 'overloaded_error',
    'no_available_channel', 'channel_not_found', 'unsupported_parameter', 'invalid_request_error', 'invalid_request']);
const providerCodes = new Set(AI_PROVIDER_CODES);
// Only known domain codes may enter a copied report; never include raw server messages.
export const AI_ACCOUNT_CODES = Object.freeze(['FEATURE_DISABLED', 'AI_MODEL_UNAVAILABLE',
    'AI_PROVIDER_UNAVAILABLE', 'AI_PROVIDER_AUTH_FAILED', 'AI_CAPABILITY_UNSUPPORTED', 'AI_REQUEST_LIMIT_EXCEEDED', 'VALIDATION_ERROR', 'AI_QUOTA_EXCEEDED',
    'AI_CONCURRENCY_EXCEEDED', 'AI_UPSTREAM_RATE_LIMIT', 'AI_PAYMENT_REQUIRED',
    'AI_CONTENT_FILTERED', 'AI_CIRCUIT_OPEN', 'AI_TIMEOUT', 'AI_CANCELLED',
    'AI_UPSTREAM_ERROR', 'AI_GATEWAY_ERROR', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR']);
const accountCodes = new Set(AI_ACCOUNT_CODES);
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
        if (accountCodes.has(details.backendCode)) this.backendCode = details.backendCode;
        if (typeof details.requestId === 'string' && uuid.test(details.requestId)) this.requestId = details.requestId;
        if (Number.isInteger(details.catalogStatus) && details.catalogStatus >= 100 && details.catalogStatus <= 599) this.catalogStatus = details.catalogStatus;
        if (['ok', 'http_error', 'invalid_response', 'timeout', 'network_error'].includes(details.catalogResult)) this.catalogResult = details.catalogResult;
        if (Number.isInteger(details.candidateCount) && details.candidateCount >= 0 && details.candidateCount <= 3) this.candidateCount = details.candidateCount;
        if (typeof details.fallbackAttempted === 'boolean') this.fallbackAttempted = details.fallbackAttempted;
        if (Number.isInteger(details.catalogModelCount) && details.catalogModelCount >= 0 && details.catalogModelCount <= 5000) this.catalogModelCount = details.catalogModelCount;
        if (typeof details.configuredModelListed === 'boolean') this.configuredModelListed = details.configuredModelListed;
        if (typeof details.api === 'string') {
            try {
                const api = new URL(details.api);
                if (!api.username && !api.password && !api.search && !api.hash
                    && ['https:', 'http:'].includes(api.protocol)) this.api = api.href;
            } catch { /* Invalid endpoints are not diagnostic output. */ }
        }
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
        fallbackAttempted:data?.fallbackAttempted,catalogModelCount:data?.catalogModelCount,configuredModelListed:data?.configuredModelListed
    });
}

export function createAiClient({ fetchImpl = (...args) => globalThis.fetch(...args),
    account = accountService, startupTimeoutMs = 90000, replyTimeoutMs = 65000,
    agentTimeoutMs = 115000, retryDelayMs = 1000, readinessTtlMs = 300000 } = {}) {
    let readyUntil = 0;
    const conversations = new Map();

    function resetConversation(path = '/api/tutor') {
        for (const key of conversations.keys()) if (key.startsWith(path + '|')) conversations.delete(key);
    }

    async function accountReply(path, payload, { signal, onStatus, onContext, beforeAccountRequest } = {}) {
        const ownerId = account.user?.id;
        const scope = [path, ownerId, path === '/api/tutor' ? payload.course : '', path === '/api/tutor' ? payload.lesson : ''].join('|');
        const endpoint = account.baseUrl + '/v1/ai/agent/chat';
        onStatus?.('replying');
        try {
            return await withinDeadline(async phaseSignal => {
                const sync = await beforeAccountRequest?.();
                if (phaseSignal.aborted) throw phaseSignal.reason || cancelled();
                if (account.user?.id !== ownerId) throw cancelled();
                const pendingSync = sync !== undefined && sync?.status !== 'synced';
                const data = await account.request('/v1/ai/agent/chat', {
                    method: 'POST', signal: phaseSignal, timeoutMs: agentTimeoutMs,
                    body: {
                        mode: 'EDUCATIONAL', message: payload.question,
                        ...(path === '/api/tutor' ? { courseSlug: payload.course, lessonSlug: payload.lesson } : {}),
                        ...(path === '/api/tutor' && payload.platformKey ? { selectedPlatformKey: payload.platformKey } : {}),
                        ...(path === '/api/tutor' && payload.learningLevel ? { learningLevel: payload.learningLevel } : {}),
                        ...(pendingSync ? { learningSnapshotPending: true } : {}),
                        ...(conversations.has(scope) ? { conversationId: conversations.get(scope) } : {}),
                    },
                });
                if (phaseSignal.aborted) throw phaseSignal.reason || cancelled();
                if (account.user?.id !== ownerId) throw cancelled();
                if (typeof data?.message !== 'string' || !data.message.trim()) throw new AiRequestError(
                    'Trợ lý tài khoản chưa gửi được câu trả lời. Bạn có thể thử lại.',
                    { code: 'AI_RESPONSE', stage: 'reply', api: endpoint });
                if (typeof data.conversationId === 'string' && uuid.test(data.conversationId)) conversations.set(scope, data.conversationId);
                onContext?.({ source: 'postgresql-account', pendingSync,
                    savedLearning: data.contextSources?.savedLearning === true,
                    hasSnapshot: data.contextSources?.hasSnapshot === true,
                    ...(Number.isSafeInteger(data.contextSources?.snapshotRevision)
                        ? { snapshotRevision: data.contextSources.snapshotRevision } : {}),
                    api: endpoint });
                return data.message;
            }, agentTimeoutMs, signal, () => new AiRequestError(
                'Trợ lý tài khoản phản hồi quá lâu. Bạn có thể thử lại câu hỏi này.',
                { code: 'AI_REPLY_TIMEOUT', stage: 'reply', api: endpoint }));
        } catch (error) {
            if (error?.name === 'AbortError' || error instanceof AiRequestError) throw error;
            if (error?.code === 'SESSION_CHANGED' || account.user?.id !== ownerId) throw cancelled();
            const status = error?.status;
            const backendCode = accountCodes.has(error?.code) ? error.code : undefined;
            const disabled = status === 503 && backendCode === 'FEATURE_DISABLED';
            const missingModel = status === 503 && backendCode === 'AI_MODEL_UNAVAILABLE';
            const providerAuth = status === 503 && backendCode === 'AI_PROVIDER_AUTH_FAILED';
            const providerAdmin = account.sessionOffline !== true && account.user?.isEmailVerified === true
                && account.user.permissions?.includes('ai:manage')
                && account.user.roles?.some(role => role.group === 'MANAGER' && role.scopeType === 'SYSTEM');
            const requestLimit = status === 400 && backendCode === 'AI_REQUEST_LIMIT_EXCEEDED';
            const incompatibleModel = status === 400 && backendCode === 'AI_CAPABILITY_UNSUPPORTED';
            const message = status === 401 ? 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để trợ lý đọc đúng dữ liệu của bạn.'
                : status === 403 ? 'Tài khoản cần được xác nhận và cấp quyền sử dụng trợ lý. Hãy kiểm tra trong trang Tài khoản hoặc liên hệ quản trị viên.'
                : status === 429 ? 'Trợ lý tài khoản đang đạt giới hạn sử dụng. Vui lòng thử lại sau.'
                : disabled ? 'Agent tài khoản đang tắt. Quản trị viên mở Cấu hình AI của hệ thống trong trang Tài khoản, lưu kết nối/mô hình rồi bấm Bật agent.'
                : missingModel ? 'Agent tài khoản chưa có mô hình khả dụng. Quản trị viên kiểm tra ID mô hình và mô hình mặc định trong Cấu hình AI của hệ thống trong trang Tài khoản.'
                : providerAuth ? (providerAdmin
                    ? 'Nhà cung cấp AI chưa chấp nhận khóa kết nối hoặc quyền của tài khoản/model. Trong Cấu hình AI của hệ thống trong trang Tài khoản, kiểm tra đúng nhà cung cấp và quyền truy cập model: key Woku dùng với Woku; key Gemini dùng với Google Gemini.'
                    : 'Nhà cung cấp AI chưa cho phép kết nối này. Hãy báo quản trị viên kiểm tra quyền truy cập AI; câu hỏi và tiến độ của bạn vẫn được giữ.')
                : requestLimit ? 'Ngữ cảnh bài học vượt giới hạn đã đăng ký cho mô hình. Quản trị viên mở Cấu hình AI của hệ thống trong trang Tài khoản, kiểm tra giới hạn đầu vào/context theo khả năng thật của model rồi lưu lại.'
                : incompatibleModel ? 'Nhà cung cấp chưa chấp nhận mô hình hoặc tính năng được yêu cầu. Quản trị viên kiểm tra đúng ID model, API key và khả năng gọi công cụ trong Cấu hình AI của hệ thống.'
                : status === 400 ? 'Máy chủ từ chối yêu cầu AI. Kiểm tra ID model và cấu hình agent; Chi tiết lỗi có mã phản hồi để người quản trị xác định nguyên nhân.'
                : status === 503 && backendCode === 'AI_PROVIDER_UNAVAILABLE' ? (providerAdmin
                    ? 'Kết nối với nhà cung cấp AI đang tạm ngưng hoặc chưa sẵn sàng. Trong Cấu hình AI của hệ thống, kiểm tra trạng thái kết nối và hạn mức; có thể thử lại sau.'
                    : 'Kết nối AI đang tạm thời chưa sẵn sàng. Bạn có thể thử lại sau; câu hỏi và tiến độ của bạn vẫn được giữ.')
                : status === 503 ? 'Trợ lý tài khoản chưa sẵn sàng. Người quản lí cần kiểm tra cấu hình AI trên máy chủ.'
                : 'Chưa kết nối được trợ lý tài khoản. Tiến độ trên thiết bị vẫn được giữ; bạn có thể thử lại.';
            throw new AiRequestError(message, {
                code: [401, 403].includes(status) || providerAuth ? 'AI_AUTH' : status === 429 ? 'AI_BUSY' : !status ? 'AI_NETWORK' : missingModel || incompatibleModel ? 'AI_MODEL' : status === 400 ? 'AI_REQUEST' : 'AI_UNAVAILABLE',
                backendCode, stage: providerAuth ? 'provider' : 'reply', httpStatus: status, requestId: error?.requestId,
                retryable: !disabled && !missingModel && !providerAuth && ![400, 401, 403].includes(status), api: endpoint,
            });
        }
    }

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

    async function requestReply(path, payload, options = {}) {
        const { signal, onStatus, onContext } = options;
        if (!paths.has(path)) throw new TypeError('Unknown AI reply endpoint');
        if (signal?.aborted) throw cancelled();
        if (account?.configured) {
            await account.ready();
            if (signal?.aborted) throw cancelled();
            if (account.user?.id && !(Array.isArray(payload.images) && payload.images.length))
                // An account request must not silently fall back to a public chat
                // that cannot read its database or honor the same data scope.
                return accountReply(path, payload, options);
        }
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
                if (path === '/api/tutor') onContext?.({ source: 'browser-self-report',
                    hasLearningReport: payload.educationalContext !== undefined,
                    vision: Boolean(payload.images?.length), api: AI_SERVICE_ORIGIN + path });
                return data.reply;
            }, replyTimeoutMs, signal, () => new AiRequestError('Dịch vụ AI phản hồi quá lâu. Bạn có thể thử lại câu hỏi này.', {
                code: 'AI_REPLY_TIMEOUT', stage: 'reply'
            }));
        } catch (error) {
            if (error?.code === 'AI_NETWORK' || error?.code === 'AI_REPLY_TIMEOUT') readyUntil = 0;
            throw error;
        }
    }
    return { requestReply, resetConversation };
}

export const aiClient = createAiClient();
