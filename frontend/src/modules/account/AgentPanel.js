import { accountService } from '../../services/AccountService.js';

const API = '/v1/ai/agent';
let nextPanelId = 0;
const ACTIONS = {
    'course.create_draft': ['Tạo bản nháp khóa học', 'CREATE_DRAFT'],
    'announcement.prepare': ['Gửi thông báo', 'PUBLISH_ANNOUNCEMENT'],
    'admin_note.create': ['Tạo ghi chú quản lí', 'CREATE_ADMIN_NOTE'],
    'course.update_info': ['Cập nhật thông tin khóa học', 'UPDATE_COURSE_INFO'],
    'course.publish': ['Xuất bản khóa học', 'PUBLISH_COURSE'],
};
const FIELDS = { title: 'Tiêu đề', description: 'Mô tả', body: 'Nội dung', audience: 'Người nhận', subject: 'Chủ đề', note: 'Ghi chú', courseId: 'Mã khóa học', reason: 'Lý do' };

function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
}

/** Optional account-only agent. The existing tutor and its capture UI stay independent. */
export function attachAgentPanel(container, session = accountService) {
    if (!container) return () => {};
    if (!document.querySelector('link[data-account-agent-style]')) {
        const style = document.createElement('link');
        style.rel = 'stylesheet';
        style.href = new URL('./AgentPanel.css', import.meta.url).href;
        style.dataset.accountAgentStyle = '';
        document.head.append(style);
    }
    const prefix = `account-agent-${++nextPanelId}`;
    let generation = 0, controller, disposed = false;
    let preferredMode = 'EDUCATIONAL';

    function render(user = session.user) {
        const token = ++generation;
        controller?.abort();
        controller = new AbortController();
        const signal = controller.signal;
        const current = () => !disposed && generation === token && session.user?.id === user?.id;
        const request = (path, options = {}) => session.request(API + path, { ...options, signal });
        container.replaceChildren();
        container.classList.add('account-agent');
        container.append(node('h2', 'Trợ lý tài khoản'));
        if (!user) {
            container.append(node('p', 'Đăng nhập để trò chuyện với trợ lý và lưu hội thoại theo tài khoản.'));
            return;
        }
        if (!user.isEmailVerified) {
            container.append(node('p', 'Xác minh email để sử dụng trợ lý tài khoản. Bạn vẫn có thể học và dùng AI trong bài học.'));
            return;
        }

        const toolbar = node('div', undefined, 'account-agent-toolbar');
        const modeField = node('div', undefined, 'field');
        const modeLabel = node('label', 'Phạm vi trợ lý', 'label');
        const mode = node('select', undefined, 'select');
        mode.id = `${prefix}-mode`;
        modeLabel.htmlFor = mode.id;
        const choices = [['EDUCATIONAL', 'Hỗ trợ học tập'], ['PERSONAL', 'Định hướng cá nhân']];
        if (user.permissions?.includes('system:read')) choices.push(['MANAGEMENT', 'Hỗ trợ quản lí']);
        for (const [value, label] of choices) mode.add(new Option(label, value));
        if (!choices.some(([value]) => value === preferredMode)) preferredMode = 'EDUCATIONAL';
        mode.value = preferredMode;
        modeField.append(modeLabel, mode);
        const historyField = node('div', undefined, 'field');
        const historyLabel = node('label', 'Hội thoại đã lưu', 'label');
        const history = node('select', undefined, 'select');
        history.id = `${prefix}-history`;
        historyLabel.htmlFor = history.id;
        history.add(new Option('Hội thoại mới', ''));
        historyField.append(historyLabel, history);
        const newButton = node('button', 'Hội thoại mới', 'btn');
        newButton.type = 'button';
        toolbar.append(modeField, historyField, newButton);
        const status = node('p', 'Đang kiểm tra cấu hình trợ lý…', 'account-agent-status');
        status.setAttribute('role', 'status');
        const messages = node('div', undefined, 'account-agent-messages');
        messages.setAttribute('role', 'log');
        messages.setAttribute('aria-label', 'Nội dung hội thoại với trợ lý tài khoản');
        messages.setAttribute('aria-live', 'polite');
        const form = node('form');
        const questionField = node('div', undefined, 'field');
        const questionLabel = node('label', 'Câu hỏi của bạn', 'label');
        const question = node('textarea', undefined, 'textarea');
        question.id = `${prefix}-question`;
        question.maxLength = 4000;
        question.required = true;
        question.rows = 3;
        questionLabel.htmlFor = question.id;
        questionField.append(questionLabel, question);
        const send = node('button', 'Gửi câu hỏi', 'btn btn--primary');
        send.type = 'submit';
        send.disabled = true;
        form.append(questionField, send);
        const preferences = node('div', undefined, 'account-agent-preferences');
        const preferenceLabel = node('label', undefined, 'check');
        const preference = node('input');
        preference.type = 'checkbox';
        preference.disabled = true;
        preferenceLabel.append(preference, node('span', 'Cho phép trợ lý đề xuất lưu sở thích học tập. Mỗi đề xuất vẫn cần tôi xác nhận.'));
        preferences.append(preferenceLabel);
        const proposals = node('div', undefined, 'account-agent-proposals');
        container.append(toolbar, status, messages, form, preferences, proposals);
        let conversationId = '', available = false, busy = false, historyVersion = 0;

        const setBusy = (value) => {
            busy = value;
            send.disabled = value || !available;
            question.disabled = value || !available;
            mode.disabled = value;
            history.disabled = value;
            newButton.disabled = value;
            form.setAttribute('aria-busy', String(value));
        };
        const errorText = (error) => error.status === 503
            ? 'Trợ lý tài khoản hiện chưa sẵn sàng. Người quản lí cần kiểm tra cấu hình, kết nối và hạn mức AI.'
            : (error.status === 429 ? 'Trợ lý đang đạt giới hạn sử dụng. Vui lòng thử lại sau.' : (error.message || 'Không thể kết nối trợ lý. Vui lòng thử lại.'));
        const addMessage = (role, text) => {
            const item = node('article', undefined, `account-agent-message account-agent-message--${role}`);
            item.append(node('strong', role === 'user' ? 'Bạn' : 'Trợ lý'), node('p', text));
            messages.append(item);
            messages.scrollTop = messages.scrollHeight;
        };
        const refreshHistory = async () => {
            const rows = await request(`/conversations?mode=${mode.value}&limit=20`);
            if (!current()) return;
            history.replaceChildren(new Option('Hội thoại mới', ''));
            for (const row of rows) {
                const time = new Date(row.last_user_activity_at || row.created_at).toLocaleString('vi-VN');
                history.add(new Option(`${time} · ${row._count?.messages || 0} tin nhắn`, row.id));
            }
            history.value = conversationId;
        };
        const refreshProposals = async () => {
            const [memories, actions] = await Promise.all([
                request('/memory/proposals'),
                mode.value === 'MANAGEMENT' ? request('/actions/proposals') : Promise.resolve([]),
            ]);
            if (!current()) return;
            proposals.replaceChildren();
            const entries = [...memories.filter((row) => row.mode === mode.value).map((row) => ({ ...row, memory: true })), ...actions];
            if (entries.length) proposals.append(node('h3', 'Đề xuất cần bạn xem và xác nhận'));
            for (const proposal of entries) {
                const action = ACTIONS[proposal.action_type];
                if (!proposal.memory && !action) continue;
                const card = node('article', undefined, 'account-agent-proposal');
                card.append(node('h4', proposal.memory ? 'Lưu sở thích học tập' : action[0]));
                if (proposal.memory) {
                    card.append(node('p', proposal.content), node('p', proposal.reason, 'field-hint'));
                } else {
                    for (const [key, label] of Object.entries(FIELDS)) {
                        if (typeof proposal.payload?.[key] === 'string') card.append(node('p', `${label}: ${proposal.payload[key]}`));
                    }
                }
                const controls = node('div', undefined, 'account-agent-actions');
                const accept = node('button', proposal.memory ? 'Đồng ý lưu sở thích này' : `Xác nhận: ${action[0].toLowerCase()}`, 'btn btn--primary');
                const reject = node('button', 'Từ chối', 'btn');
                accept.type = reject.type = 'button';
                const decide = async (approved) => {
                    if (busy || !current()) return;
                    accept.disabled = reject.disabled = true;
                    try {
                        const target = proposal.memory ? '/memory/proposals/' : '/actions/proposals/';
                        await request(`${target}${proposal.id}/${approved ? 'confirm' : 'reject'}`, {
                            method: 'POST',
                            body: proposal.memory ? { content: proposal.content } : {
                                payloadHash: proposal.payload_hash,
                                ...(approved ? { confirmation: action[1] } : {}),
                            },
                        });
                        if (!current()) return;
                        status.textContent = approved ? 'Máy chủ đã xử lí xác nhận của bạn.' : 'Đã từ chối đề xuất.';
                        await refreshProposals();
                    } catch (error) {
                        if (current()) { status.textContent = errorText(error); accept.disabled = reject.disabled = false; }
                    }
                };
                accept.addEventListener('click', () => decide(true));
                reject.addEventListener('click', () => decide(false));
                controls.append(accept, reject);
                card.append(controls);
                proposals.append(card);
            }
        };

        mode.addEventListener('change', () => { preferredMode = mode.value; render(); });
        newButton.addEventListener('click', () => {
            historyVersion++;
            conversationId = '';
            history.value = '';
            messages.replaceChildren();
            question.focus();
        });
        history.addEventListener('change', async () => {
            const version = ++historyVersion;
            conversationId = history.value;
            messages.replaceChildren();
            if (!conversationId) return;
            try {
                const record = await request(`/conversations/${conversationId}`);
                if (!current() || version !== historyVersion) return;
                for (const item of record.messages) {
                    if (['user', 'assistant'].includes(item.role) && item.content.trim()) addMessage(item.role, item.content);
                }
            } catch (error) { if (current() && version === historyVersion) status.textContent = errorText(error); }
        });
        preference.addEventListener('change', async () => {
            const enabled = preference.checked;
            preference.disabled = true;
            try {
                const result = await request('/memory/preferences', { method: 'PATCH', body: { enabled } });
                if (current()) preference.checked = result.enabled;
            } catch (error) { if (current()) { preference.checked = !enabled; status.textContent = errorText(error); } }
            finally { if (current()) preference.disabled = false; }
        });
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const text = question.value.trim();
            if (busy || !available || !text) return;
            setBusy(true);
            status.textContent = 'Trợ lý đang xử lí…';
            try {
                const result = await request('/chat', {
                    method: 'POST', timeoutMs: 115000,
                    body: { mode: mode.value, message: text, ...(conversationId ? { conversationId } : {}) },
                });
                if (!current()) return;
                conversationId = result.conversationId;
                addMessage('user', text);
                addMessage('assistant', result.message || 'Trợ lý chưa trả về nội dung.');
                question.value = '';
                status.textContent = 'Hội thoại đã được lưu theo tài khoản.';
                const updates = await Promise.allSettled([refreshHistory(), refreshProposals()]);
                if (current() && updates.some((update) => update.status === 'rejected')) status.textContent = 'Đã nhận câu trả lời; chưa tải lại được toàn bộ lịch sử hoặc đề xuất.';
            } catch (error) { if (current()) status.textContent = errorText(error); }
            finally { if (current()) { setBusy(false); question.focus(); } }
        });

        request(`/status?mode=${mode.value}`).then((result) => {
            if (!current()) return;
            available = result.available === true;
            status.textContent = result.message;
            setBusy(false);
        }).catch((error) => { if (current()) { status.textContent = errorText(error); setBusy(false); } });
        request('/memory/preferences').then((result) => {
            if (current()) { preference.checked = result.enabled; preference.disabled = false; }
        }).catch(() => {});
        Promise.allSettled([refreshHistory(), refreshProposals()]);
        setBusy(false);
    }

    const unsubscribe = session.subscribe((user) => render(user));
    session.ready().then(() => { if (!disposed) render(); });
    render();
    return () => { disposed = true; generation++; controller?.abort(); unsubscribe(); container.replaceChildren(); };
}
