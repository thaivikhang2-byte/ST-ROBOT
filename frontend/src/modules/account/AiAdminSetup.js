import { accountService } from '../../services/AccountService.js';

const API = '/v1/admin/ai';
export const AI_SETUP_PROVIDERS = Object.freeze({
    gemini: { label: 'Google Gemini', type: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com' },
    woku: { label: 'Woku — OpenAI compatible', type: 'openai-compatible', baseUrl: 'https://llm.wokushop.com/v1' },
    openai: { label: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1' },
    openrouter: { label: 'OpenRouter', type: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' },
    anthropic: { label: 'Anthropic', type: 'anthropic', baseUrl: 'https://api.anthropic.com' },
});
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

export function validateAiConnection(value) {
    const preset = AI_SETUP_PROVIDERS[value.providerId];
    if (!preset) throw setupError('AI_SETUP_PROVIDER');
    let url;
    try { url = new URL(value.baseUrl); } catch { throw setupError('AI_SETUP_URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
        || (url.port && url.port !== '443')) throw setupError('AI_SETUP_URL');
    const modelId = String(value.modelId || '').trim();
    if (modelId && !/^[a-zA-Z0-9@_.:/-]{1,200}$/.test(modelId)) throw setupError('AI_SETUP_MODEL');
    if (value.apiKey && (!/^\S{8,4096}$/.test(value.apiKey))) throw setupError('AI_SETUP_KEY');
    return { providerId: value.providerId, type: preset.type, baseUrl: url.href.replace(/\/$/, ''), modelId };
}

export function aiSetupErrorMessage(error) {
    if (error?.code === 'SESSION_CHANGED') return 'Phiên hoặc quyền quản trị đã thay đổi. Hãy đăng nhập lại trước khi tiếp tục.';
    if (error?.code === 'AI_SETUP_KEY_REQUIRED') return 'Kết nối mới cần API key. Khóa hiện có không thể đọc lại; để trống chỉ khi đã lưu khóa trước đó.';
    if (error?.code === 'AI_SETUP_URL') return 'Địa chỉ nhà cung cấp cần HTTPS, không chứa mật khẩu, tham số hoặc cổng riêng.';
    if (error?.code === 'AI_SETUP_PROVIDER') return 'Chọn một nhà cung cấp được hỗ trợ.';
    if (error?.code === 'AI_SETUP_MODEL') return 'Mã mô hình không hợp lệ. Dùng đúng ID từ nhà cung cấp.';
    if (error?.code === 'AI_SETUP_KEY') return 'API key cần 8–4096 ký tự và không có khoảng trắng.';
    if (error?.code === 'AI_SETUP_CATALOG') return 'Backend chưa có đủ công cụ đọc dữ liệu học tập và lab. Cập nhật backend trước khi đăng ký mô hình cho agent.';
    if (error?.status === 409) return 'Cấu hình đã được sửa ở nơi khác. Tải lại trạng thái rồi thực hiện lại thao tác; các bước đã lưu vẫn được giữ.';
    if (error?.status === 401 || error?.status === 403) return 'Máy chủ từ chối thao tác. Kiểm tra phiên quản trị, HTTPS và địa chỉ nhà cung cấp được phép trên server.';
    if (error?.status === 429) return 'Đã đạt giới hạn thao tác hoặc nhà cung cấp. Chờ một lúc rồi thử lại.';
    if (error?.status === 503) return 'Kho khóa AI hoặc dịch vụ chưa sẵn sàng. Người vận hành cần kiểm tra master key, đường dẫn kho khóa và cấu hình máy chủ.';
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
            const value = validateAiConnection({ ...input, apiKey });
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
                    maxInputTokens: 6000, maxOutputTokens: 2048, contextTokens: 8192 };
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
    let generation = 0, controller, destroyed = false;
    if (!document.querySelector('link[data-ai-admin-style]')) {
        const link = node('link'); link.rel = 'stylesheet'; link.href = new URL('./AiAdminSetup.css', import.meta.url).href;
        link.dataset.aiAdminStyle = ''; document.head.append(link);
    }
    function render(user = session.user) {
        const version = ++generation;
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
        const summary = node('div'), form = node('form'), fields = node('div', undefined, 'ai-admin-fields');
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
        const key = node('input', undefined, 'input'); key.name = 'apiKey'; key.type = 'password'; key.autocomplete = 'off'; key.maxLength = 4096;
        key.setAttribute('data-lpignore', 'true'); field('Thêm API key — để trống để giữ khóa đã lưu', key);
        const model = node('input', undefined, 'input'); model.name = 'modelId'; model.maxLength = 200;
        model.setAttribute('list', `${prefix}-models`); field('ID mô hình — có thể bổ sung sau khi lưu kết nối', model);
        const suggestions = node('datalist'); suggestions.id = `${prefix}-models`;
        const defaultLabel = node('label', undefined, 'check'), defaultModel = node('input'); defaultModel.type = 'checkbox'; defaultModel.checked = true;
        defaultLabel.append(defaultModel, node('span', 'Dùng mô hình này làm mặc định cho agent.'));
        const consentLabel = node('label', undefined, 'check'), consent = node('input'); consent.type = 'checkbox'; consent.required = true;
        consentLabel.append(consent, node('span', 'Tôi đã kiểm tra mô hình hỗ trợ gọi công cụ và đồng ý lưu cấu hình này.'));
        const save = node('button', 'Lưu kết nối / mô hình', 'btn btn--primary'); save.type = 'submit';
        const discover = node('button', 'Tra ID mô hình từ nhà cung cấp', 'btn'); discover.type = 'button';
        const refresh = node('button', 'Tải lại trạng thái', 'btn'); refresh.type = 'button';
        const toggle = node('button', 'Bật agent', 'btn'); toggle.type = 'button';
        const actions = node('div', undefined, 'ai-admin-actions'); actions.append(save, discover, refresh, toggle);
        form.append(fields, suggestions, defaultLabel, consentLabel, actions);
        container.append(summary, form, status, node('p',
            'Tra model chỉ gọi API metadata khi bạn bấm. Công cụ này không tự gửi câu hỏi thử hoặc kiểm tra khoản phí; nhà cung cấp có hạn mức riêng.', 'field-hint'));
        let snapshot = null, busy = false, endpointPristine = true;
        const selected = () => snapshot?.vault?.providers?.find(item => item.id === provider.value);
        const controls = () => {
            for (const input of form.querySelectorAll('input,select,button')) input.disabled = busy || !current();
            save.disabled ||= !snapshot?.vault;
            discover.disabled ||= !selected()?.credentials?.some(item => item.enabled);
            toggle.textContent = snapshot?.settings?.enabled ? 'Tắt agent' : 'Bật agent';
            toggle.disabled ||= !snapshot?.settings || (!snapshot.settings.enabled &&
                (!snapshot.settings.gatewayEnabled || !snapshot.models.some(item => item.enabled && item.is_default)));
            refresh.disabled = busy || !current();
        };
        const changeProvider = () => {
            key.value = ''; model.value = ''; consent.checked = false; suggestions.replaceChildren();
            endpointPristine = true;
            baseUrl.value = selected()?.endpoints?.[0]?.baseUrl || AI_SETUP_PROVIDERS[provider.value].baseUrl;
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
            if (stored) summary.append(node('p', `Kết nối đang chọn: ${stored.id}; ${stored.credentials.filter(item => item.enabled).length} khóa đang bật (chỉ metadata).`));
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
                apiKey: key.value, isDefault: defaultModel.checked };
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
    return () => { destroyed = true; generation++; controller?.abort(); unsubscribe?.(); container.replaceChildren(); };
}
