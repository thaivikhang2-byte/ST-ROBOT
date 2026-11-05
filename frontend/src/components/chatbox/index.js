import { getChatboxTemplate } from './template.js';
import { $, $$ } from '../../utils/dom.js';

const AI_URL = 'https://st-robot-1.onrender.com/api/home-chat';

export class Chatbox {
    constructor(containerId) {
        this.container = $(containerId);
        this.history = [];
        this.busy = false;
        this.failedExchange = null;
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
            pending.textContent = 'AI đang trả lời…';
            pending.dataset.state = 'pending';
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 75000);
            const waitingTimer = setTimeout(() => {
                pending.textContent = 'Trợ lý đang kết nối, bạn chờ một chút nhé…';
            }, 15000);
            try {
                const response = await fetch(AI_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ question, history: this.history.slice(-6) }),
                    signal: controller.signal
                });
                let data;
                try { data = await response.json(); }
                catch { throw new Error('Máy chủ chưa trả lời đầy đủ. Bạn có thể thử lại.'); }
                if (!response.ok) {
                    const error = new Error(typeof data?.error === 'string' && data.error.trim()
                        ? data.error.slice(0, 500) : response.status === 429
                            ? 'Trợ lý đang bận. Bạn hãy thử lại sau một phút.'
                            : 'Trợ lý đang gặp gián đoạn. Bạn có thể thử lại.');
                    error.retryable = data?.retryable !== false;
                    throw error;
                }
                if (typeof data?.reply !== 'string' || !data.reply.trim()) throw new Error('Trợ lý chưa gửi được câu trả lời. Bạn có thể thử lại.');
                pending.textContent = data.reply;
                pending.dataset.state = 'complete';
                this.history.push({ role: 'user', content: question }, { role: 'assistant', content: data.reply.slice(0, 4000) });
                this.history = this.history.slice(-6);
            } catch (error) {
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
                if (!input.value) input.value = question;
            } finally {
                clearTimeout(timer);
                clearTimeout(waitingTimer);
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
