# Trợ lý tài khoản và AI hiện có

Phần AI trong bài học (`ai-server/`, gồm chụp/cắt ảnh trên điện thoại và máy tính)
vẫn dùng API và giao diện hiện tại. Trợ lý tài khoản là phần bổ sung trên trang
tài khoản, gọi backend NestJS. Nó không thay thế trợ lý trong khóa học.

Agent chạy theo từng yêu cầu đã xác thực: đọc dữ liệu được phân quyền, gọi tối đa
4 công cụ trong tối đa 3 vòng, lưu hội thoại vào PostgreSQL. Đây không phải worker
tự động thay đổi hệ thống trong nền. Redis phục vụ hạn mức, cache và các hàng đợi
của backend. Không có câu trả lời AI giả khi thiếu nhà cung cấp.

## Trạng thái mặc định

- `AI_GATEWAY_ENABLED=false`; seed tạo nhà cung cấp ở trạng thái tắt, không tạo
  mô hình và không đưa khóa API vào source.
- `GET /api/v1/ai/agent/status?mode=EDUCATIONAL` kiểm tra cấu hình cục bộ, không
  gửi yêu cầu đến nhà cung cấp và không tiêu tốn token. Trường `available` chỉ xác
  nhận đã cấu hình, không hứa nhà cung cấp đang hoạt động hoặc còn hạn mức.
- Trang tài khoản hiển thị lý do chưa sẵn sàng và khóa nút gửi cho đến khi cấu
  hình đủ. Các khóa học, lab, quiz và trợ lý cũ vẫn hoạt động độc lập.
- `supportsImages=false` cho agent mới. Ảnh chụp bài học tiếp tục đi qua API tutor
  cũ; không gửi ảnh vào `AgentChatDto` hoặc âm thầm giảm chất lượng ảnh.

## Cấu hình trên máy chủ

Cần backend Node.js 22+, PostgreSQL đã migrate/seed, Redis, HTTPS và tài khoản
quản lí có quyền AI. GitHub Pages chỉ chạy frontend; việc push code không khởi
động các dịch vụ này.

1. Lưu bí mật `AI_CREDENTIALS_MASTER_KEY` trong cấu hình bí mật của máy chủ. Giá
   trị là 32 byte ngẫu nhiên mã hóa base64; `AI_CREDENTIALS_KEY_ID` mặc định
   `master-v1`. Không commit giá trị này.
2. Đặt `AI_PROVIDERS_CONFIG_PATH` vào tệp `.json` trên ổ đĩa bền vững riêng, ngoài
   thư mục public và Git, ví dụ `/app/private-ai/providers.enc.json`. Backend yêu
   cầu tệp thuộc người dùng chạy ứng dụng và quyền `0600`, thư mục riêng `0700`.
   Sao lưu cả kho khóa mã hóa và master key theo quy trình vận hành riêng.
3. Đăng nhập quản lí qua HTTPS. Dùng các API quản trị bên dưới để tạo metadata
   nhà cung cấp, thêm credential đã mã hóa và đăng kí mô hình. Bearer token chỉ
   gửi đến backend đã cấu hình. Trình duyệt không giữ API key của nhà cung cấp.
4. Chỉ sau khi chủ hệ thống đã cấu hình nhà cung cấp/hạn mức: bật
   `AI_GATEWAY_ENABLED=true` và cờ database `FeatureFlag.key='ai_chat'` trong
   quy trình triển khai được quản trị. Không dùng các controller CRUD mẫu chưa
   được đưa vào API hoạt động để thay đổi cờ.
5. Đọc `/api/v1/ai/agent/status` bằng tài khoản học viên đã xác minh email. Khi
   `available=true`, thực hiện một câu hỏi thử do người quản lí chủ động gửi.

Các khóa `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` trong `.env` riêng lẻ không tự động
thiết lập vault của backend này. AI cũ có cấu hình nhà cung cấp riêng.

## API thiết lập nhà cung cấp

Các đường dẫn dưới đây tính từ `/api/v1/admin/ai`, yêu cầu quyền `ai:manage` và
vai trò quản trị hợp lệ. Các thao tác credential yêu cầu HTTPS.

| API | Mục đích |
| --- | --- |
| `GET /vault` | Đọc metadata và revision hiện tại; không trả secret/ciphertext. |
| `PUT /providers/:id/config` | Thêm/cập nhật metadata được phép theo `expectedRevision`. |
| `POST /providers/:id/credentials` | Nhận key qua HTTPS rồi mã hóa ngay; không có API đọc key. |
| `GET /providers/:id/models` | Người quản lí chủ động tra model metadata từ nhà cung cấp. |
| `POST /models` | Đăng kí model/capability/tool allowlist trong database. |
| `PATCH /quotas/default` | Đặt ngân sách lượt/token/ngày và giới hạn đồng thời. |

Ví dụ metadata **không chứa key**, cho Gemini:

```json
{
  "expectedRevision": 0,
  "provider": {
    "id": "gemini",
    "type": "gemini",
    "enabled": true,
    "accountGroup": "strobot-primary",
    "privacyGroup": "strobot",
    "models": ["TEN_MODEL_DA_XAC_MINH"],
    "endpoints": [{
      "id": "official",
      "baseUrl": "https://generativelanguage.googleapis.com",
      "enabled": true,
      "capabilities": ["chat", "tools"]
    }],
    "limits": {"requestsPerMinute": 10, "tokensPerDay": 100000, "maxConcurrent": 2},
    "timeoutMs": 60000,
    "priority": 0,
    "selection": "priority",
    "maxRetries": 0
  }
}
```

Thay model placeholder bằng ID thực tế được nhà cung cấp cho phép. Mỗi lần sửa
vault phải dùng revision vừa đọc từ máy chủ; không gửi lại một revision cũ sau
khi thay đổi. Body thêm credential gồm `expectedRevision`, `apiKey`, `enabled`,
`endpointIds:["official"]`, `limits` như trên. Cung cấp key qua công cụ quản trị
HTTPS riêng, không qua issue, commit hoặc log.

Body đăng kí model gồm `providerId`, `modelId`, `enabled`, `isDefault`, `premium`,
`capabilities`, `allowedTools`, `maxInputTokens`, `maxOutputTokens`,
`contextTokens`. Để agent dùng công cụ, model và endpoint phải hỗ trợ `tools`,
và `allowedTools` phải liệt kê đúng tên từ `GET /api/v1/ai/agent/capabilities`.
Model giới hạn đầu ra ít nhất 1200 token để phù hợp một lượt agent. Ví dụ công
cụ đọc cho học viên: `learning_search_courses`, `learning_get_own_progress`,
`learning_get_lesson`, `rag_search_authorized_documents`,
`learning_recommend_next_lesson`, `quiz_explain_attempt`. Các công cụ
`teacher_get_assigned_courses` và `teacher_get_class_progress` chỉ dành cho
quyền giảng dạy/phạm vi lớp được cấp.
`memory_propose` chỉ tạo bản chờ người dùng xác nhận.

## Hợp đồng tích hợp

`POST /api/v1/ai/agent/chat` nhận:

```json
{"mode":"EDUCATIONAL","message":"Giải thích vòng lặp và gợi ý cách luyện tập"}
```

Có thể gửi `conversationId` để tiếp tục; `courseId` và `lessonId` phải cùng có
mặt, là UUID thực của catalog trên server, và học viên phải có quyền truy cập.
Không dùng slug frontend như `arduino`/`led` thay cho UUID. `mode` là
`EDUCATIONAL`, `PERSONAL` hoặc `MANAGEMENT`; phân vùng quản lí chỉ dành cho người
có quyền quản lí hệ thống. Câu trả lời bọc trong API envelope thông thường;
`data.message` là văn bản, `data.conversationId` là hội thoại đã lưu.

Lịch sử: `GET /conversations`, `GET /conversations/:id`,
`DELETE /conversations/:id`. Bộ nhớ: `/memory/preferences`, `/memory/proposals`,
`/memory`. Hội thoại, đề xuất và bộ nhớ được kiểm tra chủ sở hữu tại backend.

AI không tự xác nhận thao tác ghi. Các đề xuất quản lí chỉ thực thi khi người
dùng xem nội dung, bấm xác nhận, payload hash khớp, quyền hiện tại còn hợp lệ và
AI write control được bật. Công tắc ghi mặc định tắt; không cần bật để chat hoặc
đọc dữ liệu. Trang tài khoản hiển thị rõ đề xuất và nút đồng ý/từ chối.

## Sửa lỗi trong bản đồng bộ

- Cache câu trả lời được tách theo chủ tài khoản, bộ nhớ đã xác nhận, nội dung
  bài, quyền, phạm vi và model. Thu hồi bộ nhớ hoặc đổi nội dung bài không tiếp
  tục dùng câu trả lời được cá nhân hóa từ ngữ cảnh cũ.
- Lịch sử giới hạn hoặc lượt công cụ bị ngắt kết nối được khôi phục thành chuỗi
  message hợp lệ; không gửi orphan tool result hoặc tool call thiếu kết quả đến
  nhà cung cấp.
- Tool call Gemini thiếu ID được cấp ID riêng cho từng vòng; chữ kí
  `thoughtSignature` của nhà cung cấp được giữ nguyên cùng call tương ứng qua
  nhiều vòng và qua lần tải lại hội thoại. Model dùng chữ kí phải được đăng kí
  capability `reasoning_context`; kiểm tra capability và ghép ID vẫn áp dụng.
- Frontend chỉ dựng văn bản bằng `textContent`; đăng xuất/đổi tài khoản hủy yêu
  cầu đang chạy và xóa hội thoại khỏi giao diện.
- Công cụ tiến độ đọc thêm `LearnerState.summary` của bản GitHub đã đồng bộ,
  gắn nguồn `learner-self-report`, không lấy nhật ký riêng và không biến kết quả
  tự báo cáo thành điểm đã chấm/chứng nhận. Thống kê lớp/quản lí kiểm tra quyền
  analytics theo phạm vi và chỉ đưa số tổng hợp giới hạn vào mô hình.
- Gemini dùng REST qua transport kiểm soát host, DNS và redirect. Không truyền
  tùy chọn `httpOptions.fetch` mà SDK không hỗ trợ; không có SDK retry ngầm.
- Regression tests: `backend/src/modules/ai-gateway/agent/agent-context.spec.ts`.
