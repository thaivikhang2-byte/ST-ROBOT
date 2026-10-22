export const getChatboxTemplate = () => `
  <div id="supportChatWindow" class="bot-chat-window">
    <div class="bot-header">
      <div>
        <h5>Hỗ trợ học viên</h5>
        <small>Giải đáp thông tin khóa học nhanh</small>
      </div>
      <button id="chatCloseBtn" class="bot-close-btn">×</button>
    </div>
    <div id="chatMessageContainer" class="bot-chat-body">
      <div class="bot-msg bot-msg-ai">Xin chào! Bạn đang quan tâm đến bộ kit học tập hay lộ trình đào tạo nào, hãy để lại câu hỏi nhé.</div>
    </div>
    <div class="bot-action-chips">
      <button class="btn btn-outline-primary btn-sm bot-chip chat-quick-query" data-query="Tư vấn lộ trình học STEM Robotics từ đầu">Lộ trình học</button>
      <button class="btn btn-outline-primary btn-sm bot-chip chat-quick-query" data-query="So sánh chi tiết tính năng các bộ Kit">So sánh Kit</button>
    </div>
    <div class="bot-input-area">
      <div class="input-group">
        <input id="chatInputField" type="text" class="form-control" placeholder="Nhập câu hỏi tại đây...">
        <button id="chatSubmitBtn" class="btn btn-primary">Gửi</button>
      </div>
    </div>
  </div>
  <button id="chatTriggerBtn" class="bot-trigger-btn">✦</button>
`;
