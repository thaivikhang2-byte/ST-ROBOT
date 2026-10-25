import { getChatboxTemplate } from './template.js';
import { $, $$ } from '../../utils/dom.js';

const AI_URL = 'https://st-robot.onrender.com/api/home-chat';

export class Chatbox {
    constructor(containerId) {
        this.container = $(containerId);
        this.history = [];
        this.busy = false;
    }

    render() {
        if (!this.container) return;
        this.container.innerHTML = getChatboxTemplate();
        this.attachEvents();
    }

    attachEvents() {
        const window = $('#supportChatWindow');
        const input = $('#chatInputField');
        const button = $('#chatSubmitBtn');
        const chips = $$('.chat-quick-query');
        $('#chatTriggerBtn')?.addEventListener('click', () => window?.classList.toggle('active'));
        $('#chatCloseBtn')?.addEventListener('click', () => window?.classList.toggle('active'));
        if (!input || !button) return;
        input.maxLength = 3000;
        const submit = async () => {
            const question = input.value.trim();
            if (!question || this.busy) return;
            this.busy = true;
            button.disabled = true;
            chips.forEach(b => b.disabled = true);
            this.appendMessage(question, 'user');
            input.value = '';
            const pending = this.appendMessage('AI đang trả lời…', 'assistant');
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 75000);
            try {
                const response = await fetch(AI_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ question, history: this.history.slice(-6) }),
                    signal: controller.signal
                });
                let data;
                try { data = await response.json(); }
                catch { throw new Error('Máy chủ chưa sẵn sàng. Hãy thử gửi lại sau 60 giây.'); }
                if (!response.ok) throw new Error(data.error || 'Không gửi được câu hỏi. Hãy thử lại.');
                if (typeof data.reply !== 'string' || !data.reply.trim()) throw new Error('AI chưa trả về nội dung. Hãy thử lại.');
                pending.textContent = data.reply;
                this.history.push({ role: 'user', content: question }, { role: 'assistant', content: data.reply.slice(0, 4000) });
                this.history = this.history.slice(-6);
            } catch (error) {
                pending.textContent = error.name === 'AbortError'
                    ? 'Chờ phản hồi quá lâu. Bạn hãy gửi lại câu hỏi.'
                    : error instanceof TypeError ? 'Không kết nối được máy chủ AI. Kiểm tra mạng rồi thử lại.' : error.message;
                if (!input.value) input.value = question;
            } finally {
                clearTimeout(timer);
                this.busy = false;
                button.disabled = false;
                chips.forEach(b => b.disabled = false);
                const messages = $('#chatMessageContainer');
                if (messages) messages.scrollTop = messages.scrollHeight;
                input.focus();
            }
        };
        button.addEventListener('click', submit);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); }
        });
        chips.forEach(b => b.addEventListener('click', () => {
            if (this.busy) return;
            input.value = b.getAttribute('data-query') || '';
            submit();
        }));
    }

    appendMessage(text, sender) {
        const bubble = document.createElement('div');
        bubble.className = sender === 'user' ? 'bot-msg bot-msg-user' : 'bot-msg bot-msg-ai';
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
