import { accountService } from '../../services/AccountService.js';
import { attachAiSpendingSetup } from './AiSpendingSetup.js?v=ai-spending-v1';

const API = '/v1/admin/ai';
export const AI_SETUP_PROVIDERS = Object.freeze({
    gemini: { label: 'Google Gemini', type: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com' },
    woku: { label: 'Woku — OpenAI compatible', type: 'openai-compatible', baseUrl: 'https://llm.wokushop.com/v1' },
    openai: { label: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1' },
    openrouter: { label: 'OpenRouter', type: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' },
    anthropic: { label: 'Anthropic', type: 'anthropic', baseUrl: 'https://api.anthropic.com' },
});
export const AI_SETUP_DEFAULT_LIMITS = Object.freeze({ maxInputTokens: 32768, maxOutputTokens: 2048, contextTokens: 65536 });
const MODEL_LIMIT_FIELDS = Object.freeze([
    ['maxInputTokens', 'Giới hạn đầu vào', 1, 2000000],
    ['maxOutputTokens', 'Giới hạn đầu ra', 1, 16384],
    ['contextTokens', 'Cửa sổ ngữ cảnh', 2, 2000000],
]);
// The initial registry grants read-only learning/management tools and opt-in
// memory proposals. Sensitive management actions stay outside this setup.
export const AI_SETUP_TOOLS = Object.freeze([
    'learning_search_courses', 'learning_get_own_progress', 'learning_get_own_learning_data',
    'learning_get_lab_platforms', 'learning_get_course_outline', 'learning_get_lesson',
    'learning_list_lesson_resources', 'learning_get_quiz_practice',
    'learning_get_own_quiz_Result', 'learning_get_own_submission_status',
    'learning_recommend_next_lesson', 'quiz_explain_attempt', 'memory_propose',
    'admin_get_system_overview', 'teacher_get_assigned_courses', 'teacher_get_class_progress',
]);

export function canConfigureAi(user, offline = false) {
    return Boolean(user?.id && user.isActive !== false && user.isEmailVerified && !offline
        && user.permissions?.includes('ai:manage')
        && user.roles?.some(role => role.group === 'MANAGER' && role.scopeType === 'SYSTEM'));
}

function setupError(code, status = 400) {
    return Object.assign(new Error(code), { code, status });
}

export function validateAiConnection(value, actorEmail = '') {
    const preset = AI_SETUP_PROVIDERS[value.providerId];
    if (!preset) throw setupError('AI_SETUP_PROVIDER');
    let url;
    try { url = new URL(value.baseUrl); } catch { throw setupError('AI_SETUP_URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
        || (url.port && url.port !== '443')) throw setupError('AI_SETUP_URL');
    const modelId = String(value.modelId || '').trim();
    if (modelId && !/^[a-zA-Z0-9@_.:/-]{1,200}$/.test(modelId)) throw setupError('AI_SETUP_MODEL');
    if (modelId && actorEmail && modelId.toLowerCase() === String(actorEmail).trim().toLowerCase())
        throw setupError('AI_SETUP_MODEL_EMAIL');
    if (value.apiKey && (!/^\S{8,4096}$/.test(value.apiKey))) throw setupError('AI_SETUP_KEY');
    const limits = {};
    for (const [name, , minimum, maximum] of MODEL_LIMIT_FIELDS) {
        const raw = value[name] === undefined ? AI_SETUP_DEFAULT_LIMITS[name] : value[name];
        const limit = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
        if (!Number.isSafeInteger(limit) || limit < minimum || limit > maximum)
            throw setupError('AI_SETUP_LIMITS');
        limits[name] = limit;
    }
    if (limits.maxInputTokens + limits.maxOutputTokens > limits.contextTokens)
        throw setupError('AI_SETUP_LIMITS');
    if (modelId && limits.maxOutputTokens < 1200) throw setupError('AI_SETUP_AGENT_OUTPUT');
    return { providerId: value.providerId, type: preset.type, baseUrl: url.href.replace(/\/$/, ''), modelId, ...limits };
}

export function aiModelLimitNotice(model) {
    const input = Number(model?.max_input_tokens), output = Number(model?.max_output_tokens), context = Number(model?.context_tokens);
    if (![input, output, context].every(Number.isFinite)) return '';
    if (input >= AI_SETUP_DEFAULT_LIMITS.maxInputTokens && output >= 1200 && context >= AI_SETUP_DEFAULT_LIMITS.contextTokens) return '';
    return `Mô hình ${String(model.model_id || '')} đang lưu giới hạn đầu vào ${input}, đầu ra ${output}, ngữ cảnh ${context}. Giới hạn này có thể thiếu chỗ cho bài học và công cụ của tutor. Kiểm tra giới hạn thật của model, nhập các mức phù hợp vào form rồi bấm Lưu kết nối / mô hình; hệ thống không tự tăng giới hạn đã lưu.`;
}

export function aiSetupErrorMessage(error) {
    if (error?.code === 'SESSION_CHANGED') return 'Phiên hoặc quyền quản trị đã thay đổi. Hãy đăng nhập lại trước khi tiếp tục.';
    if (error?.code === 'AI_PROVIDER_AUTH_FAILED') return 'Nhà cung cấp chưa chấp nhận API key hoặc quyền của tài khoản/model. Kiểm tra đúng nhà cung cấp (key Woku dùng với Woku; key Gemini dùng với Google Gemini) và quyền truy cập model. Chỉ thay hoặc xóa khóa khi đã xác định khóa cần sửa.';
    if (error?.code === 'AI_PROVIDER_UNAVAILABLE') return 'Nhà cung cấp đang tạm chưa sẵn sàng, có thể đang chờ lượt hoặc thời gian tạm ngưng kết nối. Chờ rồi tải lại trạng thái; cấu hình và khóa đang lưu vẫn được giữ.';
    if (error?.code === 'AI_SETUP_CREDENTIAL') return 'Mã nhà cung cấp hoặc mã khóa không hợp lệ. Tải lại trạng thái trước khi chọn khóa cần xóa.';
    if (error?.code === 'AI_SETUP_CREDENTIAL_NOT_FOUND') return 'Khóa đã được thay đổi hoặc không còn trong kết nối này. Tải lại trạng thái; chưa có khóa nào được xóa bởi thao tác này.';
    if (error?.code === 'AI_SETUP_KEY_REQUIRED') return 'Kết nối mới cần API key. Khóa hiện có không thể đọc lại; để trống chỉ khi đã lưu khóa trước đó.';
    if (error?.code === 'AI_SETUP_URL') return 'Địa chỉ nhà cung cấp cần HTTPS, không chứa mật khẩu, tham số hoặc cổng riêng.';
    if (error?.code === 'AI_SETUP_PROVIDER') return 'Chọn một nhà cung cấp được hỗ trợ.';
    if (error?.code === 'AI_SETUP_MODEL') return 'Mã mô hình không hợp lệ. Dùng đúng ID từ nhà cung cấp.';
    if (error?.code === 'AI_SETUP_MODEL_EMAIL') return 'Ô ID mô hình đang là email đăng nhập của bạn. Hãy dùng đúng ID model do nhà cung cấp cấp hoặc chọn từ Tra ID mô hình; không dùng tài khoản email.';
    if (error?.code === 'AI_SETUP_LIMITS') return 'Giới hạn cần là số nguyên: đầu vào 1–2.000.000, đầu ra 1–16.384, ngữ cảnh 2–2.000.000. Tổng đầu vào và đầu ra không được vượt cửa sổ ngữ cảnh; dùng mức phù hợp model thật.';
    if (error?.code === 'AI_SETUP_AGENT_OUTPUT') return 'Model dùng công cụ của agent cần giới hạn đầu ra ít nhất 1.200 token. Kiểm tra model có hỗ trợ mức này rồi sửa giới hạn trước khi lưu.';
    if (error?.code === 'AI_SETUP_KEY') return 'API key cần 8–4096 ký tự và không có khoảng trắng.';
    if (error?.code === 'AI_SETUP_CATALOG') return 'Backend chưa có đủ công cụ đọc dữ liệu học tập và lab. Cập nhật backend trước khi đăng ký mô hình cho agent.';
    if (error?.status === 409) return 'Cấu hình đã được sửa ở nơi khác. Tải lại trạng thái rồi thực hiện lại thao tác; các bước đã lưu vẫn được giữ.';
    if (error?.status === 401 || error?.status === 403) return 'Máy chủ từ chối thao tác. Kiểm tra phiên quản trị, HTTPS và địa chỉ nhà cung cấp được phép trên server.';
    if (error?.status === 429) return 'Đã đạt giới hạn thao tác hoặc nhà cung cấp. Chờ một lúc rồi thử lại.';
    if (error?.status === 503) return 'Dịch vụ AI hoặc kho cấu hình hiện chưa sẵn sàng. Tải lại trạng thái và kiểm tra nhật ký máy chủ; các cấu hình đã lưu vẫn được giữ.';
    if (error?.status === 400) return 'Máy chủ chưa chấp nhận cấu hình. Kiểm tra ID model, khả năng gọi công cụ và các giới hạn đã nhập.';
    return 'Chưa hoàn thành thao tác. Các bước đã lưu trên server không tự bị xóa; tải lại trạng thái để kiểm tra.';
}

/** API workflow only: keys are passed once, never retained on this object. */
export class AiSetupClient {
    constructor(session = accountService) { this.session = session; }
    scope() {
        const owner = this.session.user?.id, version = this.session.sessionVersion;
        const current = () => this.session.user?.id === owner
            && this.session.sessionVersion === version
            && canConfigureAi(this.session.user, this.session.sessionOffline);
        if (!current()) throw setupError('SESSION_CHANGED', 403);
        const requestAt = async (path, options = {}) => {
            if (!current()) throw setupError('SESSION_CHANGED', 403);
            const result = await this.session.request(path, options);
            if (!current()) throw setupError('SESSION_CHANGED', 403);
            return result;
        };
        return { request: (path, options) => requestAt(API + path, options), requestAt, current };
    }
    async load() {
        const { request } = this.scope();
        const [settings, vault, models, quota] = await Promise.allSettled([
            request('/settings'), request('/vault'), request('/models'), request('/quotas/default'),
        ]);
        return { settings: settings.status === 'fulfilled' ? settings.value : null,
            vault: vault.status === 'fulfilled' ? vault.value : null,
            models: models.status === 'fulfilled' && Array.isArray(models.value) ? models.value : [],
            quota: quota.status === 'fulfilled' ? quota.value : null,
            errors: [settings, vault, models, quota].filter(result => result.status === 'rejected').map(result => result.reason) };
    }
    async saveConnection(input, { onStep = () => {}, signal } = {}) {
        let apiKey = input.apiKey || '';
        input.apiKey = '';
        try {
            const value = validateAiConnection({ ...input, apiKey }, this.session.user?.email);
            const { request, requestAt } = this.scope();
            let vault = await request('/vault', { signal });
            const previous = vault.providers.find(provider => provider.id === value.providerId);
            if (!apiKey && !previous?.credentials?.some(credential => credential.enabled))
                throw setupError('AI_SETUP_KEY_REQUIRED');
            let allowedTools = [...AI_SETUP_TOOLS];
            if (value.modelId && this.session.user.permissions.includes('ai:chat')) {
                const definitions = await requestAt('/v1/ai/agent/capabilities?mode=EDUCATIONAL', { signal });
                if (!Array.isArray(definitions)) throw setupError('AI_SETUP_CATALOG');
                const names = new Set(definitions.map(item => item.name));
                if (!['learning_get_own_learning_data', 'learning_get_lab_platforms'].every(name => names.has(name)))
                    throw setupError('AI_SETUP_CATALOG');
                if (this.session.user.permissions.includes('system:read')) {
                    const management = await requestAt('/v1/ai/agent/capabilities?mode=MANAGEMENT', { signal });
                    if (Array.isArray(management)) for (const item of management) names.add(item.name);
                }
                allowedTools = AI_SETUP_TOOLS.filter(name => names.has(name));
            }
            const endpointId = previous?.endpoints?.[0]?.id || 'main';
            const caps = ['chat', 'tools', 'model-list',
                ...(['gemini', 'openai', 'anthropic'].includes(value.type) ? ['reasoning_context'] : [])];
            const limits = previous?.limits || { requestsPerMinute: 10, tokensPerDay: 100000, maxConcurrent: 2 };
            const endpoints = previous?.endpoints?.length
                ? previous.endpoints.map((endpoint, index) => index === 0
                    ? { ...endpoint, baseUrl: value.baseUrl, enabled: true, capabilities: caps } : endpoint)
                : [{ id: endpointId, baseUrl: value.baseUrl, enabled: true, capabilities: caps }];
            const metadata = { id: value.providerId, type: value.type, enabled: true,
                accountGroup: previous?.accountGroup || 'strobot-primary', privacyGroup: previous?.privacyGroup || 'strobot',
                models: [...new Set([...(previous?.models || []), ...(value.modelId ? [value.modelId] : [])])],
                endpoints, limits, timeoutMs: previous?.timeoutMs || 60000, priority: previous?.priority ?? 0,
                selection: previous?.selection || 'priority', maxRetries: 0 };
            vault = await request(`/providers/${value.providerId}/config`, { method: 'PUT', signal,
                body: { expectedRevision: vault.revision, provider: metadata } });
            onStep('Đã lưu cấu hình kết nối.');
            if (apiKey) {
                const body = { expectedRevision: vault.revision, apiKey, enabled: true, endpointIds: [endpointId], limits };
                try { vault = await request(`/providers/${value.providerId}/credentials`, { method: 'POST', body, signal }); }
                finally { body.apiKey = ''; apiKey = ''; }
                onStep('Đã gửi khóa tới kho mã hóa; không có thao tác đọc lại khóa.');
            }
            if (value.modelId) {
                const models = await request('/models', { signal });
                const existing = models.find(model => model.provider_id === value.providerId && model.model_id === value.modelId);
                const body = { providerId: value.providerId, modelId: value.modelId,
                    enabled: true, isDefault: input.isDefault !== false, premium: false,
                    capabilities: caps.filter(capability => capability !== 'model-list'), allowedTools,
                    maxInputTokens: value.maxInputTokens, maxOutputTokens: value.maxOutputTokens, contextTokens: value.contextTokens };
                await request(existing ? `/models/${encodeURIComponent(existing.id)}` : '/models', {
                    method: existing ? 'PATCH' : 'POST', signal, body,
                });
                onStep('Đã đăng ký mô hình cho agent. Chưa tự bật gửi câu hỏi.');
            }
            return { providerId: value.providerId, modelSaved: Boolean(value.modelId), revision: vault.revision };
        } finally { apiKey = ''; input.apiKey = ''; }
    }
    discover(providerId, signal) {
        if (!AI_SETUP_PROVIDERS[providerId]) throw setupError('AI_SETUP_PROVIDER');
        return this.scope().request(`/providers/${providerId}/models`, { signal });
    }
    async removeCredential(providerId, credentialId, { signal } = {}) {
        const { request } = this.scope();
        if (typeof providerId !== 'string' || !/^[a-zA-Z0-9_-]{1,20}$/.test(providerId)
            || typeof credentialId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(credentialId))
            throw setupError('AI_SETUP_CREDENTIAL');
        if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
        const vault = await request('/vault', { signal });
        const provider = vault?.providers?.find(item => item.id === providerId);
        if (!Number.isSafeInteger(vault?.revision) || vault.revision < 0
            || !provider?.credentials?.some(item => item.id === credentialId))
            throw setupError('AI_SETUP_CREDENTIAL_NOT_FOUND', 404);
        if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
        return request(`/providers/${encodeURIComponent(providerId)}/credentials/${encodeURIComponent(credentialId)}`, {
            method: 'DELETE', signal, body: { expectedRevision: vault.revision },
        });
    }
    setEnabled(enabled, signal) { return this.scope().request('/settings', { method: 'PATCH', signal, body: { enabled } }); }
}

function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = String(text);
    if (className) element.className = className;
    return element;
}

let nextPanel = 0;
export function attachAiAdminSetup(container, session = accountService) {
    if (!container) return () => {};
    const client = new AiSetupClient(session), prefix = `ai-setup-${++nextPanel}`;
    let generation = 0, controller, destroyed = false, spendingCleanup;
    if (!document.querySelector('link[data-ai-admin-style]')) {
        const link = node('link'); link.rel = 'stylesheet'; link.href = new URL('./AiAdminSetup.css', import.meta.url).href;
        link.dataset.aiAdminStyle = ''; document.head.append(link);
    }
    function render(user = session.user) {
        const version = ++generation;
        spendingCleanup?.(); spendingCleanup = null;
        controller?.abort(); controller = new AbortController();
        const signal = controller.signal;
        const current = () => !destroyed && version === generation && user?.id === session.user?.id
            && canConfigureAi(session.user, session.sessionOffline);
        container.replaceChildren(); container.classList.add('ai-admin-setup');
        if (!canConfigureAi(user, session.sessionOffline)) return;
        container.append(node('h3', 'Cấu hình agent AI'), node('p',
            'Lưu kết nối nhà cung cấp, chọn mô hình hỗ trợ gọi công cụ, rồi chủ động bật agent. Khóa chỉ gửi tới backend HTTPS để mã hóa; không lưu trong trình duyệt.'));
        const status = node('p', 'Đang đọc cấu hình trên server…', 'ai-admin-status');
        status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
        const summary = node('div'), selectedSummary = node('p'), credentialList = node('section'), limitWarnings = node('div'), form = node('form'), fields = node('div', undefined, 'ai-admin-fields');
        credentialList.setAttribute('aria-label', 'Các khóa API đã lưu');
        form.dataset.aiSetupForm = ''; form.method = 'post'; form.autocomplete = 'off';
        const field = (labelText, input) => {
            const wrap = node('div', undefined, 'field'), label = node('label', labelText, 'label');
            input.id = `${prefix}-${input.name}`; label.htmlFor = input.id; wrap.append(label, input); fields.append(wrap); return input;
        };
        const provider = node('select', undefined, 'select'); provider.name = 'providerId';
        for (const [value, preset] of Object.entries(AI_SETUP_PROVIDERS)) provider.add(new Option(preset.label, value));
        field('Nhà cung cấp', provider);
        const baseUrl = node('input', undefined, 'input'); baseUrl.name = 'baseUrl'; baseUrl.type = 'url'; baseUrl.required = true;
        field('Địa chỉ API được server cho phép', baseUrl);
        const key = node('input', undefined, 'input'); key.name = 'apiKey'; key.type = 'password'; key.autocomplete = 'new-password'; key.maxLength = 4096;
        key.placeholder = 'API key từ nhà cung cấp AI; để trống để giữ khóa đã lưu';
        key.setAttribute('data-lpignore', 'true'); field('Thêm API key — để trống để giữ khóa đã lưu', key);
        const model = node('input', undefined, 'input'); model.name = 'modelId'; model.maxLength = 200;
        model.autocomplete = 'off'; model.spellcheck = false;
        model.placeholder = 'ID model từ nhà cung cấp, không phải email đăng nhập';
        model.setAttribute('list', `${prefix}-models`); field('ID mô hình — có thể bổ sung sau khi lưu kết nối', model);
        const limitInputs = {};
        for (const [name, label, minimum, maximum] of MODEL_LIMIT_FIELDS) {
            const input = node('input', undefined, 'input'); input.name = name; input.type = 'number';
            input.min = String(minimum); input.max = String(maximum); input.step = '1'; input.required = true;
            input.value = String(AI_SETUP_DEFAULT_LIMITS[name]); limitInputs[name] = input;
            field(label + ' (token)', input);
        }
        const limitsHint = node('p',
            'Bộ gợi ý 32.768 / 2.048 / 65.536 chỉ dùng cho model có cửa sổ ngữ cảnh ít nhất 65.536 token; agent cần đầu ra ít nhất 1.200 token. Kiểm tra tài liệu model và sửa các ô theo giới hạn thật trước khi lưu. Các ô này chưa thay giới hạn trên server cho đến khi bạn bấm Lưu.', 'field-hint');
        const suggestions = node('datalist'); suggestions.id = `${prefix}-models`;
        const defaultLabel = node('label', undefined, 'check'), defaultModel = node('input'); defaultModel.type = 'checkbox'; defaultModel.checked = true;
        defaultLabel.append(defaultModel, node('span', 'Dùng mô hình này làm mặc định cho agent.'));
        const consentLabel = node('label', undefined, 'check'), consent = node('input'); consent.type = 'checkbox'; consent.required = true;
        consentLabel.append(consent, node('span', 'Tôi đồng ý lưu kết nối. Nếu đăng ký mô hình, tôi đã kiểm tra khả năng gọi công cụ và các giới hạn token phù hợp model thật.'));
        const save = node('button', 'Lưu kết nối / mô hình', 'btn btn--primary'); save.type = 'submit';
        const discover = node('button', 'Tra ID mô hình từ nhà cung cấp', 'btn'); discover.type = 'button';
        const refresh = node('button', 'Tải lại trạng thái', 'btn'); refresh.type = 'button';
        const toggle = node('button', 'Bật agent', 'btn'); toggle.type = 'button';
        const actions = node('div', undefined, 'ai-admin-actions'); actions.append(save, discover, refresh, toggle);
        form.append(fields, limitsHint, suggestions, defaultLabel, consentLabel, actions);
        container.append(summary, credentialList, limitWarnings, form, status, node('p',
            'Tra model chỉ gọi API metadata khi bạn bấm. Công cụ này không tự gửi câu hỏi thử hoặc kiểm tra khoản phí; nhà cung cấp có hạn mức riêng.', 'field-hint'));
        const spendingHost = node('section'); container.append(spendingHost);
        spendingCleanup = attachAiSpendingSetup(spendingHost, session, { canConfigure: canConfigureAi });
        let snapshot = null, busy = false, endpointPristine = true;
        const selected = () => snapshot?.vault?.providers?.find(item => item.id === provider.value);
        const renderSelectedProvider = () => {
            const stored = selected();
            const count = stored?.credentials?.filter(item => item.enabled).length || 0;
            selectedSummary.textContent = `Kết nối đang chọn: ${provider.value}; ${count} khóa đang bật (chỉ metadata).${stored ? '' : ' Chưa lưu kết nối cho nhà cung cấp này.'}`;
        };
        const renderCredentials = () => {
            credentialList.replaceChildren();
            const stored = selected();
            if (!stored?.credentials?.length) return;
            credentialList.append(node('h4', `Các khóa của ${stored.id}`), node('p',
                'Chỉ hiện mã khóa và trạng thái; không thể xem lại giá trị API key. Xóa từng khóa khi bạn đã xác định khóa đó không đúng.', 'field-hint'));
            for (const credential of stored.credentials) {
                const row = node('div', undefined, 'ai-admin-actions');
                const metadata = node('span', `Mã khóa: ${credential.id} · ${credential.enabled ? 'đang bật' : 'đang tắt'}`);
                metadata.style.overflowWrap = 'anywhere'; metadata.style.minWidth = '0'; row.append(metadata);
                const remove = node('button', 'Xóa khóa', 'btn'); remove.type = 'button';
                remove.setAttribute('aria-label', `Xóa khóa ${credential.id} của ${stored.id}`);
                remove.disabled = busy || !current();
                remove.addEventListener('click', () => {
                    if (busy || !current()) return;
                    if (!globalThis.confirm(`Xóa khóa ${credential.id} của nhà cung cấp ${stored.id}? Chỉ khóa này sẽ bị xóa; không thể xem lại hoặc khôi phục giá trị khóa từ website.`)) return;
                    void act(async () => {
                        await client.removeCredential(stored.id, credential.id, { signal });
                        if (!current()) return;
                        status.textContent = `Đã xóa khóa ${credential.id} của ${stored.id}. Các khóa khác được giữ nguyên.`;
                        await load(true);
                        document.dispatchEvent(new CustomEvent('strobot:agent-settings-changed'));
                    });
                });
                row.append(remove); credentialList.append(row);
            }
        };
        const renderLimitWarnings = () => {
            limitWarnings.replaceChildren();
            for (const item of (snapshot?.models || []).filter(item => item.provider_id === provider.value)) {
                const notice = aiModelLimitNotice(item);
                if (notice) limitWarnings.append(node('p', notice, 'field-hint'));
            }
        };
        const controls = () => {
            for (const input of form.querySelectorAll('input,select,button')) input.disabled = busy || !current();
            for (const button of credentialList.querySelectorAll('button')) button.disabled = busy || !current();
            save.disabled ||= !snapshot?.vault;
            discover.disabled ||= !selected()?.credentials?.some(item => item.enabled);
            toggle.textContent = snapshot?.settings?.enabled ? 'Tắt agent' : 'Bật agent';
            toggle.disabled ||= !snapshot?.settings || (!snapshot.settings.enabled &&
                (!snapshot.settings.gatewayEnabled || !snapshot.models.some(item => item.enabled && item.is_default)));
            refresh.disabled = busy || !current();
        };
        const changeProvider = () => {
            key.value = ''; model.value = ''; consent.checked = false; suggestions.replaceChildren();
            for (const [name, input] of Object.entries(limitInputs)) input.value = String(AI_SETUP_DEFAULT_LIMITS[name]);
            endpointPristine = true;
            baseUrl.value = selected()?.endpoints?.[0]?.baseUrl || AI_SETUP_PROVIDERS[provider.value].baseUrl;
            renderSelectedProvider();
            renderCredentials();
            renderLimitWarnings();
            controls();
        };
        const load = async (keepStatus = false) => {
            const result = await client.load();
            if (!current()) return;
            snapshot = result; summary.replaceChildren();
            summary.append(node('p', result.settings?.gatewayEnabled ? 'Cổng AI trên server: đã cho phép.' : 'Cổng AI trên server: chưa mở; người vận hành cần bật AI_GATEWAY_ENABLED.'));
            summary.append(node('p', `Agent: ${result.settings?.enabled ? 'đã bật cờ chat' : 'đang tắt'}. Mô hình đã đăng ký: ${result.models.length}.`));
            const stored = selected();
            if (endpointPristine) baseUrl.value = stored?.endpoints?.[0]?.baseUrl || AI_SETUP_PROVIDERS[provider.value].baseUrl;
            summary.append(selectedSummary); renderSelectedProvider();
            renderCredentials();
            renderLimitWarnings();
            if (result.quota) summary.append(node('p', `Hạn mức mặc định: ${result.quota.daily_requests ?? result.quota.dailyRequests ?? '—'} lượt/ngày; ${result.quota.daily_tokens ?? result.quota.dailyTokens ?? '—'} token/ngày.`));
            if (!keepStatus) status.textContent = result.errors.length ? aiSetupErrorMessage(result.errors[0]) : 'Đã đọc cấu hình. Chưa gọi mô hình AI.';
            controls();
        };
        const act = async (operation) => {
            if (busy || !current()) return;
            busy = true; controls();
            try { await operation(); }
            catch (error) { if (current()) status.textContent = aiSetupErrorMessage(error); }
            finally { if (current()) { busy = false; controls(); } }
        };
        provider.addEventListener('change', changeProvider);
        baseUrl.addEventListener('input', () => { endpointPristine = false; });
        refresh.addEventListener('click', () => act(() => load()));
        discover.addEventListener('click', () => act(async () => {
            status.textContent = 'Đang tra metadata mô hình…';
            const result = await client.discover(provider.value, signal);
            if (!current()) return;
            suggestions.replaceChildren();
            for (const id of (result.modelIds || []).filter(item => typeof item === 'string').slice(0, 100)) {
                const option = node('option'); option.value = id; suggestions.append(option);
            }
            status.textContent = `Đã nhận ${suggestions.children.length} ID. Chọn/nhập ID phù hợp rồi lưu; khả năng gọi công cụ cần được kiểm tra theo nhà cung cấp.`;
        }));
        form.addEventListener('submit', event => {
            event.preventDefault();
            if (!consent.checked) return;
            const input = { providerId: provider.value, baseUrl: baseUrl.value, modelId: model.value,
                apiKey: key.value, isDefault: defaultModel.checked,
                ...Object.fromEntries(Object.entries(limitInputs).map(([name, input]) => [name, input.value])) };
            key.value = '';
            void act(async () => {
                const result = await client.saveConnection(input, { signal, onStep: text => { if (current()) status.textContent = text; } });
                if (!current()) return;
                consent.checked = false;
                status.textContent = result.modelSaved ? 'Đã lưu kết nối và mô hình. Bạn có thể chủ động bật agent bên dưới.' : 'Đã lưu kết nối. Tra/nhập ID mô hình rồi lưu lại để đăng ký mô hình cho agent.';
                await load(true);
            });
        });
        toggle.addEventListener('click', () => act(async () => {
            const enabled = !snapshot.settings.enabled;
            const result = await client.setEnabled(enabled, signal);
            if (!current()) return;
            snapshot.settings = result;
            status.textContent = result.enabled ? 'Đã bật cờ chat. Trạng thái sẵn sàng và câu trả lời thực tế vẫn phụ thuộc nhà cung cấp và hạn mức.' : 'Đã tắt cờ chat của agent.';
            await load(true);
            document.dispatchEvent(new CustomEvent('strobot:agent-settings-changed'));
        }));
        baseUrl.value = AI_SETUP_PROVIDERS[provider.value].baseUrl;
        controls(); void load().catch(error => { if (current()) { status.textContent = aiSetupErrorMessage(error); controls(); } });
    }
    const unsubscribe = session.subscribe(user => render(user));
    render();
    return () => { destroyed = true; generation++; controller?.abort(); spendingCleanup?.(); unsubscribe?.(); container.replaceChildren(); };
}
