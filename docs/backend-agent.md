# Trợ lý tài khoản và AI hiện có

Khi đăng nhập và đã kết nối backend, chat chữ ở trang chủ và trong bài học dùng
agent tài khoản của NestJS. Agent đọc dữ liệu đã lưu của đúng chủ phiên đăng nhập.
Ảnh chụp/cắt tiếp tục dùng dịch vụ vision trong `ai-server/`; nó nhận báo cáo học
tập có giới hạn từ trình duyệt và được gắn rõ nguồn, không giả vờ đã truy vấn database.
Người học khách vẫn dùng API AI hiện tại. Giao diện chụp/cắt ảnh được giữ nguyên.

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
  vision; không gửi ảnh vào `AgentChatDto` hoặc âm thầm giảm chất lượng ảnh.

## Cấu hình trên máy chủ

Cần backend Node.js 22+, PostgreSQL đã migrate/seed, Redis, HTTPS và tài khoản
quản lí có quyền AI. GitHub Pages chỉ chạy frontend; việc push code không khởi
động các dịch vụ này.

1. Lưu bí mật `AI_CREDENTIALS_MASTER_KEY` trong cấu hình bí mật của máy chủ. Giá
   trị là 32 byte ngẫu nhiên mã hóa base64 hoặc 64 ký tự hex; `AI_CREDENTIALS_KEY_ID` mặc định
   `master-v1`. Không commit giá trị này.
2. Trên Render Free, đặt `AI_VAULT_STORAGE=database` để lưu vault mã hóa vào PostgreSQL;
   không cần đĩa trả phí. Với máy chủ dùng `AI_VAULT_STORAGE=file` (mặc định),
   đặt `AI_PROVIDERS_CONFIG_PATH` vào tệp `.json` trên ổ đĩa bền vững riêng, ngoài
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
5. Đọc `/api/v1/ai/agent/status` bằng tài khoản học viên đã được xác nhận. Khi
   `available=true`, thực hiện một câu hỏi thử do người quản lí chủ động gửi.

Người quản lí có thể dùng mục **Quản trị → Cấu hình AI** trên trang Tài khoản
để cấu hình provider, khóa, model và bật/tắt chat. Key chỉ gửi tới API credential
qua HTTPS, được mã hóa trên server, xóa khỏi ô nhập và không lưu trong browser
storage. Thao tác khám phá model chỉ chạy khi người vận hành bấm nút; lưu cấu hình
không tự gửi một câu hỏi AI tính phí. Kho khóa cần PostgreSQL bền vững ở chế độ
database hoặc ổ đĩa bền vững ở chế độ file, cùng master key riêng trong cấu hình
máy chủ. Không tự nhập file vault cũ vào database. Công cụ bảo trì file từ chối
chế độ database; khôi phục database bằng bản sao lưu PostgreSQL và đúng master key.

Các khóa `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` trong `.env` riêng lẻ không tự động
thiết lập vault của backend này. AI cũ có cấu hình nhà cung cấp riêng.

## Chọn đúng dịch vụ cho API key

Key Woku phải dùng với preset **Woku — OpenAI compatible** và địa chỉ
`https://llm.wokushop.com/v1`; key Google Gemini dùng preset **Google Gemini**.
Không nhập key của dịch vụ này vào kết nối dịch vụ kia. Model đã lưu không ảnh
hưởng thao tác Tra ID: discovery gọi API metadata của nhà cung cấp đang chọn.

Để tạo kết nối Woku mới: chọn Woku, nhập key Woku, để ID model trống, xác nhận
lưu kết nối rồi bấm Lưu. Sau đó bấm Tra ID mô hình, chọn ID thực sự hỗ trợ tools,
điền các giới hạn theo model thật, tích dùng làm mặc định và lưu model. Việc đặt
mặc định sẽ thay model mặc định cũ trong giao dịch; không dùng email làm ID.

Kho khóa dùng thứ tự ưu tiên; chỉ thêm key mới không bảo đảm key cũ sai sẽ ngừng
được chọn. Mục Các khóa API đã lưu chỉ hiện ID/trạng thái và cho xóa từng key với
xác nhận rõ provider/ID. Không có tự xóa/thay khóa. Chỉ xóa khóa người vận hành
đã xác định nhập nhầm; không thể đọc lại/khôi phục plaintext từ website. Khi đổi
provider, số khóa hiển thị đổi theo provider đó, không dùng chung ngầm với provider cũ.

`AI_PROVIDER_AUTH_FAILED` phân biệt provider từ chối khóa với lỗi model. Với
Google HTTP 400, chỉ các Google ErrorInfo reason xác thực nằm trong allowlist,
đọc từ body tối đa 16 KiB, mới nhận mã này; không giữ message, body hoặc key.
Lỗi 400 khác giữ phân loại cũ. Khóa bị từ chối nhận cooldown tạm 300 giây ở đúng
credential, không tự xóa và không bỏ qua giới hạn chung của tài khoản.

## ID mô hình và giới hạn của tutor

Ô API key nhận khóa do nhà cung cấp AI cấp; ô ID mô hình nhận đúng tên model từ
nhà cung cấp hoặc từ nút Tra ID mô hình. Không dùng email/mật khẩu quản trị hoặc
các khóa JWT/master key của server vào hai ô này. Form chặn ID model trùng email
quản trị hiện tại và hạn chế tự điền mật khẩu đăng nhập vào ô key.

Giới hạn cũ 6.000 đầu vào / 2.048 đầu ra / 8.192 ngữ cảnh quá thấp cho yêu cầu
tutor: gateway dự trù bảo thủ bằng byte UTF-8 cộng framing, nên có thể từ chối
trước khi gọi nhà cung cấp. Đã tái hiện bằng ngữ cảnh thật và câu hỏi ngắn.

Form hiện cho sửa ba giới hạn. Bộ gợi ý **32.768 / 2.048 / 65.536** dành cho model
thực sự hỗ trợ cửa sổ ít nhất 65.536 token; người quản trị phải kiểm tra khả năng
model và chỉnh giá trị phù hợp trước khi lưu. Đây là trần cấu hình, không thay đổi
khả năng thật của model hoặc hạn mức nhà cung cấp. Input + output phải nằm trong
context; model dùng tools cần đầu ra ít nhất 1.200. Không tự tăng dữ liệu model đã
lưu trong database. Sau khi cập nhật website, nhập đúng provider/model và bấm
**Lưu kết nối / mô hình** để cập nhật bản ghi hiện có, giữ API key trống nếu khóa
đã lưu là đúng. Chỉ bật agent sau khi cấu hình hợp lệ.

`AI_REQUEST_LIMIT_EXCEEDED` phân biệt lỗi trần request với lỗi provider; giới hạn
gateway và quota vẫn được áp dụng. Kiểm thử dùng lớp backend thật xác nhận cả
30 bài với snapshot rỗng và có ghi chép đều qua admission ở bộ gợi ý, trong khi
cấu hình 6.000 và các giới hạn nhỏ vẫn bị từ chối trước khi lấy credential/quota.
Không gọi AI trả phí trong kiểm thử này.

## Phân biệt lỗi tutor trong trang tự học

Chat chữ khi đã đăng nhập dùng `/api/v1/ai/agent/chat`; chat khách và câu hỏi có
ảnh vẫn dùng dịch vụ AI Tutor cũ. Một đường hoạt động chưa xác nhận đường còn lại
đã có provider/model hợp lệ. Giao diện giữ `backendCode` đã được allowlist trong
phần Chi tiết lỗi, cùng hướng dẫn riêng cho `FEATURE_DISABLED` (agent đang tắt),
`AI_MODEL_UNAVAILABLE` (chưa có model khả dụng) và `AI_PROVIDER_UNAVAILABLE`
(kết nối/credential chưa sẵn sàng). Không đưa thông điệp thô, khóa hoặc token vào
bản sao chẩn đoán. Không tự chuyển câu hỏi tài khoản sang chat khách khi agent lỗi.

Ngày 17/11, đã kiểm tra nạp ngữ cảnh đủ 5 khóa/30 bài từ bản backend biên dịch
với working directory production và kiểm thử Chromium tutor/trang chủ: giữ mã
lỗi gốc, chỉ rõ bước cấu hình, giữ câu hỏi khi lỗi và giữ đường gửi ảnh. Nguyên
nhân 503 của dịch vụ công khai vẫn cần mã lỗi mới hoặc trạng thái quản trị thực tế;
đây không phải xác nhận provider trên Render đã trả lời thành công.

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

Chat tự học có thể gửi `courseSlug:"arduino"`, `lessonSlug:"led"` và
`selectedPlatformKey:"wokwi"`; server đối chiếu với danh mục 5 khóa/30 bài và
các lab thực sự có trong giao diện. Đường này giữ cách học tự do, không bắt nhập
catalog UUID hoặc đăng ký lớp trước khi hỏi về bài học công khai. `learningLevel`
được giới hạn theo các mức đang có trên website.

Đường truy cập catalog riêng vẫn hỗ trợ cặp `courseId`/`lessonId` UUID và kiểm tra
quyền/enrollment như cũ. Có thể gửi `conversationId` để tiếp tục; chủ sở hữu và
phạm vi được kiểm tra lại ở server. `mode` là
`EDUCATIONAL`, `PERSONAL` hoặc `MANAGEMENT`; phân vùng quản lí chỉ dành cho người
có quyền quản lí hệ thống. Câu trả lời bọc trong API envelope thông thường;
`data.message` là văn bản, `data.conversationId` là hội thoại đã lưu.

## Dữ liệu agent đọc được

Mỗi lượt học tập chuẩn bị tiến độ các khóa và ngữ cảnh bài hiện tại từ snapshot
database của chính người học, cùng danh mục lab được duyệt. Các công cụ
`learning_get_own_learning_data` và `learning_get_lab_platforms` cho phép đọc sâu
đúng khóa/bài khi cần: nhật ký và các bước dự đoán/quan sát/giải thích, trạng thái
hoàn thành, lịch sử quiz/ôn tập, metadata và đoạn mã dự án Micro:bit đã lưu. Câu
trả lời có nhãn nguồn `learner-self-report`; không biến nhật ký thành điểm chấm
đã kiểm chứng. Dữ liệu hỏng hoặc trường lạ không được đưa vào ngữ cảnh.

Người học không được truyền userId để đọc người khác. Agent không đọc mật khẩu,
refresh token, khóa provider, toàn bộ localStorage hoặc hồ sơ đánh giá dùng chung
trên máy. Với lab bên ngoài, agent biết tên/ngôn ngữ/công dụng và lab đang chọn;
nội dung iframe, code chưa được lưu hoặc trạng thái mô phỏng của website ngoài
không tự đọc được. Micro:bit có cầu nối lưu dự án được phép riêng.

Trước khi hỏi bằng phiên tài khoản, frontend thử đồng bộ tiến độ rồi mới gọi
agent. Lỗi auth/backend/provider hiển thị đúng lỗi và giữ câu hỏi; không âm thầm
đổi sang chat khách rồi tuyên bố đã đọc database. Đổi tài khoản hủy request cũ,
xóa lịch sử hiển thị của chủ cũ và tách hội thoại trang chủ/bài học.

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
