import { icon } from '../ui/icon.js';
import { ROUTES } from '../../constants/routes.js';

export const getChatboxTemplate = () => `
  <section id="supportChatWindow" class="chat-panel" role="dialog" aria-modal="false" aria-labelledby="chatTitle" hidden>
    <div class="chat-panel-head">
      <div>
        <h2 id="chatTitle">Trợ lý AI ST-Robot</h2>
        <small>Tư vấn khóa học và STEM Robotics</small>
      </div>
      <button id="chatCloseBtn" class="btn btn--ghost btn--icon" type="button" aria-label="Đóng trợ lý AI">${icon('x')}</button>
    </div>
    <div id="chatMessageContainer" class="chat-panel-body chat-log" role="log" aria-live="polite" aria-label="Cuộc trò chuyện hỗ trợ">
      <div class="msg msg--assistant">Xin chào! Bạn muốn tìm hiểu về bộ kit hay lộ trình học STEM Robotics?</div>
    </div>
    <div class="chat-chips">
      <button class="btn btn--sm chat-quick-query" type="button" data-query="Tư vấn lộ trình học STEM Robotics từ đầu">Lộ trình học</button>
      <button class="btn btn--sm chat-quick-query" type="button" data-query="So sánh chi tiết tính năng các bộ Kit">So sánh Kit</button>
    </div>
    <form id="chatForm" class="chat-form">
      <label class="visually-hidden" for="chatInputField">Câu hỏi của bạn</label>
      <input id="chatInputField" class="input" type="text" autocomplete="off" maxlength="3000" placeholder="Nhập câu hỏi…">
      <button id="chatSubmitBtn" class="btn btn--primary btn--icon" type="submit" aria-label="Gửi câu hỏi">${icon('send')}</button>
    </form>
    <p class="chat-ai-entry"><a href="${ROUTES.COURSE_LEARNING}">Mở AI Tutor trong bài học</a></p>
  </section>
  <button id="chatTriggerBtn" class="chat-fab" type="button" aria-label="Mở trợ lý AI ST-Robot" aria-expanded="false" aria-controls="supportChatWindow">${icon('message')}<span>Trợ lý AI</span></button>
`;
