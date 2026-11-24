import { getChatboxTemplate } from './template.js';
import { $, $$ } from '../../utils/dom.js';
import { aiClient, AI_SERVICE_ORIGIN, AI_PROVIDER_CODES, AI_ACCOUNT_CODES } from '../../services/AiService.js?v=provider-auth-v5';
import { renderAiMessage } from '../../services/AiMessageRenderer.js?v=ai-render-v14';
import { accountService } from '../../services/AccountService.js';
import { learnerSync } from '../../services/LearnerSyncService.js';

const DIAGNOSTIC_CODES = new Set(['AI_AUTH', 'AI_MODEL', 'AI_QUOTA', 'AI_BUSY', 'AI_UNAVAILABLE', 'AI_NETWORK',
    'AI_TIMEOUT', 'AI_RESPONSE', 'AI_REQUEST', 'AI_STARTUP_TIMEOUT', 'AI_STARTUP_RESPONSE', 'AI_REPLY_TIMEOUT', 'AI_STARTUP_FAILED', 'AI_CANCELLED']);
const PROVIDER_CODES = new Set(AI_PROVIDER_CODES);

function appendDiagnostics(bubble, error) {
    const report = { service: AI_SERVICE_ORIGIN };
    if (typeof error.api === 'string') {
        try { report.service = new URL(error.api).origin; report.api = error.api; } catch { /* Ignore malformed diagnostics. */ }
    }
    if (DIAGNOSTIC_CODES.has(error.code)) report.code = error.code;
    if (AI_ACCOUNT_CODES.includes(error.backendCode)) report.backendCode = error.backendCode;
    if (['startup', 'starting', 'reply', 'replying', 'provider', 'transport', 'server', 'network'].includes(error.stage)) report.stage = error.stage;
    for (const field of ['httpStatus', 'upstreamStatus']) {
        const minimum = field === 'httpStatus' ? 100 : 400;
        if (Number.isInteger(error[field]) && error[field] >= minimum && error[field] <= 599) report[field] = error[field];
    }
    if (PROVIDER_CODES.has(error.providerCode)) report.providerCode = error.providerCode;
    if (Number.isInteger(error.catalogStatus) && error.catalogStatus >= 100 && error.catalogStatus <= 599) report.catalogStatus = error.catalogStatus;
    if (['ok', 'http_error', 'invalid_response', 'timeout', 'network_error'].includes(error.catalogResult)) report.catalogResult = error.catalogResult;
    if (Number.isInteger(error.candidateCount) && error.candidateCount >= 0 && error.candidateCount <= 3) report.candidateCount = error.candidateCount;
    if (typeof error.fallbackAttempted === 'boolean') report.fallbackAttempted = error.fallbackAttempted;
    if (typeof error.configuredModelListed === 'boolean') report.configuredModelListed = error.configuredModelListed;
    if (Number.isInteger(error.catalogModelCount) && error.catalogModelCount >= 0 && error.catalogModelCount <= 5000) report.catalogModelCount = error.catalogModelCount;
    if (typeof error.requestId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(error.requestId)) report.requestId = error.requestId;
    const details = document.createElement('details'); details.className = 'chat-error-details';
    const summary = document.createElement('summary'); summary.textContent = 'Chi tiết lỗi';
    const output = document.createElement('pre'); output.className = 'chat-error-report';
    output.textContent = JSON.stringify(report, null, 2); output.tabIndex = 0;
    output.style.whiteSpace = 'pre-wrap'; output.style.overflowWrap = 'anywhere';
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'btn btn--sm chat-copy-error';
    copy.textContent = 'Sao chép thông tin lỗi';
    copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(output.textContent); copy.textContent = 'Đã sao chép'; }
        catch { copy.textContent = 'Chọn nội dung bên trên để sao chép'; output.focus(); }
    });
    details.append(summary, output, copy); bubble.append(details);
}

export class Chatbox {
    constructor(containerId) {
        this.container = $(containerId);
        this.history = [];
        this.busy = false;
        this.failedExchange = null;
        this.generation = 0;
        this.activeRequest = null;
    }

    render() {
        if (!this.container) return;
        this.container.innerHTML = getChatboxTemplate();
        this.attachEvents();
    }

    attachEvents() {
        const panel = $('#supportChatWindow');
        const trigger = $('#chatTriggerBtn');
        const input = $('#chatInputField');
        const button = $('#chatSubmitBtn');
        const chips = $$('.chat-quick-query');
        const setOpen = (open) => {
            if (!panel) return;
            panel.hidden = !open;
            panel.classList.toggle('is-open', open);
            trigger?.setAttribute('aria-expanded', String(open));
            if (open) input?.focus();
            else trigger?.focus();
        };
        trigger?.addEventListener('click', () => setOpen(panel?.hidden));
        $('#chatCloseBtn')?.addEventListener('click', () => setOpen(false));
        panel?.addEventListener('keydown', event => {
            if (event.key === 'Escape') setOpen(false);
        });
        if (!input || !button) return;
        input.maxLength = 3000;
        this.unsubscribeAccount?.();
        let currentOwner = accountService.user?.id ?? null;
        this.unsubscribeAccount = accountService.subscribe(user => {
            const owner = user?.id ?? null;
            if (owner === currentOwner) return;
            currentOwner = owner;
            this.generation++;
            this.activeRequest?.abort(); this.activeRequest = null;
            this.history = []; this.failedExchange = null; this.busy = false;
            aiClient.resetConversation('/api/home-chat');
            $('#chatMessageContainer')?.replaceChildren();
            this.appendMessage(owner ? 'Bạn có thể hỏi về tiến độ, bài học và các nền tảng Lab của tài khoản.' : 'Bạn có thể hỏi về khóa học và STEM Robotics. Đăng nhập để trợ lý dùng dữ liệu học tập của bạn.', 'assistant');
            input.value = ''; button.disabled = false;
            chips.forEach(chip => { chip.disabled = false; });
            $('#chatForm')?.removeAttribute('aria-busy');
        });
        const submit = async (retry = null) => {
            const question = retry?.question || input.value.trim();
            if (!question || this.busy) return;
            if (!retry && this.failedExchange?.question === question) retry = this.failedExchange;
            this.failedExchange = null;
            this.busy = true;
            button.disabled = true;
            chips.forEach(b => b.disabled = true);
            $('#chatForm')?.setAttribute('aria-busy', 'true');
            $$('.chat-retry').forEach(b => b.remove());
            if (!retry) this.appendMessage(question, 'user');
            if (!retry || input.value.trim() === question) input.value = '';
            const pending = retry?.bubble || this.appendMessage('', 'assistant');
            pending.textContent = 'Đang khởi động trợ lý…';
            pending.dataset.state = 'pending';
            const controller = new AbortController();
            const generation = this.generation;
            this.activeRequest = controller;
            let context;
            try {
                const reply = await aiClient.requestReply('/api/home-chat', { question, history: this.history.slice(-6) }, {
                    signal: controller.signal,
                    beforeAccountRequest: async () => { await learnerSync.ready(); return learnerSync.flushPending?.() ?? learnerSync.sync({ refresh: false }); },
                    onContext: value => { context = value; },
                    onStatus: state => { pending.textContent = state === 'starting' ? 'Đang khởi động trợ lý…' : 'AI đang trả lời…'; }
                });
                if (generation !== this.generation) return;
                renderAiMessage(pending, reply);
                if (context?.source === 'postgresql-account') {
                    const notice = document.createElement('p'); notice.className = 'small chat-context-source';
                    notice.textContent = context.pendingSync
                        ? 'Đang dùng bản đã đồng bộ gần nhất; bản nháp trên thiết bị chưa được đồng bộ.'
                        : context.hasSnapshot ? 'Đã dùng dữ liệu học tập của tài khoản và danh mục Lab.'
                            : 'Đã đọc danh mục Lab; tài khoản chưa có tiến độ đã đồng bộ.';
                    pending.append(notice);
                }
                pending.dataset.state = 'complete';
                this.history.push({ role: 'user', content: question }, { role: 'assistant', content: reply.slice(0, 4000) });
                this.history = this.history.slice(-6);
            } catch (error) {
                if (generation !== this.generation) return;
                pending.textContent = error.name === 'AbortError'
                    ? 'Chờ phản hồi quá lâu. Bạn hãy gửi lại câu hỏi.'
                    : error instanceof TypeError ? 'Kết nối với trợ lý bị gián đoạn. Kiểm tra mạng rồi thử lại.' : error.message;
                pending.dataset.state = 'failed';
                this.failedExchange = { question, bubble: pending };
                if (error.retryable !== false) {
                    const actions = document.createElement('div');
                    const retryButton = document.createElement('button');
                    retryButton.type = 'button';
                    retryButton.className = 'btn btn--sm chat-retry';
                    retryButton.textContent = 'Thử lại';
                    retryButton.addEventListener('click', () => submit(this.failedExchange));
                    actions.append(retryButton);
                    pending.append(actions);
                }
                appendDiagnostics(pending, error);
                if (!input.value) input.value = question;
            } finally {
                if (generation !== this.generation) return;
                this.activeRequest = null;
                this.busy = false;
                button.disabled = false;
                chips.forEach(b => b.disabled = false);
                $('#chatForm')?.removeAttribute('aria-busy');
                const messages = $('#chatMessageContainer');
                if (messages) messages.scrollTop = messages.scrollHeight;
                if (!panel.hidden) input.focus();
            }
        };
        $('#chatForm')?.addEventListener('submit', event => {
            event.preventDefault();
            submit();
        });
        chips.forEach(b => b.addEventListener('click', () => {
            if (this.busy) return;
            input.value = b.getAttribute('data-query') || '';
            submit();
        }));
    }

    appendMessage(text, sender) {
        const bubble = document.createElement('div');
        bubble.className = sender === 'user' ? 'msg msg--user' : 'msg msg--assistant';
        bubble.textContent = text;
        bubble.style.whiteSpace = 'pre-wrap';
        bubble.style.overflowWrap = 'anywhere';
        bubble.style.flexShrink = '0';
        const messages = $('#chatMessageContainer');
        messages?.appendChild(bubble);
        if (messages) messages.scrollTop = messages.scrollHeight;
        return bubble;
    }
}
