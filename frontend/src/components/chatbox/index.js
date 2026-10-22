import { getChatboxTemplate } from './template.js';
import { $, $$ } from '../../utils/dom.js';
import { chatbotResponses } from '../../data/chatbot.js';

export class Chatbox {
    constructor(containerId) {
        this.container = $(containerId);
    }

    render() {
        if (!this.container) return;
        this.container.innerHTML = getChatboxTemplate();
        this.attachEvents();
    }

    attachEvents() {
        const triggerBtn = $('#chatTriggerBtn');
        const closeBtn = $('#chatCloseBtn');
        const chatWindow = $('#supportChatWindow');
        const submitBtn = $('#chatSubmitBtn');
        const inputField = $('#chatInputField');
        const quickQueries = $$('.chat-quick-query');

        const toggleChat = () => {
            if (chatWindow) chatWindow.classList.toggle('active');
        };

        if (triggerBtn) triggerBtn.addEventListener('click', toggleChat);
        if (closeBtn) closeBtn.addEventListener('click', toggleChat);

        const submitQuery = () => {
            const query = inputField.value.trim();
            if (!query) return;
            this.appendMessage(query, 'user');
            inputField.value = '';
            
            setTimeout(() => {
                this.appendMessage(this.generateResponse(query), 'assistant');
            }, 300);
        };

        if (submitBtn) submitBtn.addEventListener('click', submitQuery);
        
        if (inputField) {
            inputField.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') submitQuery();
            });
        }

        quickQueries.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const query = e.target.getAttribute('data-query');
                inputField.value = query;
                submitQuery();
            });
        });
    }

    appendMessage(text, sender) {
        const container = $('#chatMessageContainer');
        if (!container) return;
        
        const msgBubble = document.createElement('div');
        msgBubble.className = sender === 'user' ? 'bot-msg bot-msg-user' : 'bot-msg bot-msg-ai';
        msgBubble.innerText = text;
        container.appendChild(msgBubble);
        container.scrollTop = container.scrollHeight;
    }

    generateResponse(inputStr) {
        let text = inputStr.toLowerCase();
        for (let item of chatbotResponses) {
            if (item.keywords[0] === 'default') continue;
            if (item.keywords.some(kw => text.includes(kw))) {
                return item.response;
            }
        }
        const defaultItem = chatbotResponses.find(item => item.keywords.includes('default'));
        return defaultItem ? defaultItem.response : "Xin lỗi, tôi chưa hiểu ý bạn.";
    }
}
