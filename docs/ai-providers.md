# Cấu hình nhà cung cấp AI

Máy chủ hỗ trợ Woku và kết nối trực tiếp Google Gemini. Woku vẫn là mặc định; thêm khóa Google vào cấu hình không tự đổi dịch vụ. Chat, AI Tutor và gợi ý dạng câu đều dùng nhà cung cấp được chọn khi máy chủ khởi động. Địa chỉ API được cố định trong mã, không nhận từ câu hỏi hoặc URL do người dùng gửi.

## Tiếp tục dùng gói Woku đã mua

Trong Render → dịch vụ **ST-ROBOT-1** → **Environment**, dùng:

| Biến | Giá trị |
| --- | --- |
| `AI_PROVIDER` | `woku` (để trống hoặc chưa có biến này cũng dùng Woku) |
| `WOKU_API_KEY` | Khóa do Woku cấp, chỉ nhập trong trường bảo mật của Render |
| `AI_MODEL` | ID model chính xác được cấp cho gói đã mua |
| `ALLOWED_ORIGIN` | `https://thaivikhang2-byte.github.io` |

Ứng dụng hiện gọi `https://llm.wokushop.com/v1/chat/completions` và đọc danh sách model từ `https://llm.wokushop.com/v1/models`. Giá trị model mặc định cũ được giữ để tương thích; nó không xác nhận tài khoản có quyền dùng model đó.

Base URL và ID model thường nằm trong **trang đơn hàng, tài liệu sử dụng hoặc tin nhắn người bán gửi lúc mua API**. Render chỉ lưu cấu hình được nhập; nó không biết quyền của gói Woku. Nếu người bán chỉ gửi khóa, có thể gửi họ nội dung sau, kèm báo cáo lỗi an toàn từ website:

> Mình đã mua API. Ứng dụng gọi https://llm.wokushop.com/v1/chat/completions đang nhận HTTP 503; API /v1/models trả 200 nhưng gọi model dự phòng vẫn lỗi. Bạn xác nhận giúp Base URL, model ID chính xác được cấp cho gói và kiểm tra quyền truy cập/kênh xử lý của khóa. Mình có request ID để đối chiếu.

Không gửi khóa trong tin nhắn hỗ trợ công khai. Nếu Base URL của gói khác địa chỉ trên, cần sửa và kiểm tra phần tích hợp; đổi tên model không tự sửa địa chỉ dịch vụ.

## Tùy chọn kết nối trực tiếp Google

Chỉ làm phần này khi chọn dùng tài khoản Google riêng. Khóa Woku và số dư đã mua ở Woku không chuyển sang Google. Tạo/quản lý khóa ở [Google AI Studio](https://aistudio.google.com/apikey), rồi nhập trực tiếp vào Render → **ST-ROBOT-1 → Environment**:

| Biến | Giá trị |
| --- | --- |
| `AI_PROVIDER` | `gemini` |
| `GEMINI_API_KEY` | Khóa do Google AI Studio cấp |
| `GEMINI_MODEL` | ID model text được tài khoản Google hỗ trợ; mặc định `gemini-3.8-flash` |

Chọn **Save, rebuild, and deploy** (hoặc thao tác lưu và triển khai tương ứng của Render), chờ bản mới **Live**. Giữ `ALLOWED_ORIGIN` như trên. Máy chủ dùng API tương thích OpenAI của Google tại `https://generativelanguage.googleapis.com/v1beta/openai/`; không dùng `AI_MODEL` hoặc `WOKU_API_KEY` khi đã chọn `gemini`. Muốn quay lại Woku, đặt `AI_PROVIDER=woku` rồi triển khai lại.

Tên model mặc định và đường dẫn API dựa trên [quickstart chính thức của Google, bản ngày 05/11/2026](https://github.com/google-gemini/cookbook/blob/1eb6e85c26260e8e343834456b3789121f62bb76/quickstarts/Get_started_OpenAI_Compatibility.ipynb). Tài liệu không đảm bảo model đang khả dụng cho từng tài khoản. Quyền truy cập, hạn mức và chi phí cần kiểm tra tại Google trước khi sử dụng.

## Xác nhận bản triển khai

Mở `https://st-robot-1.onrender.com/health`. `ai.provider` cho biết `woku` hoặc `gemini`; `keyConfigured` và `modelConfigured` chỉ báo có nhập cấu hình tương ứng. Nếu không nhập model, máy chủ dùng mặc định và `modelConfigured` vẫn là `false`. Các cờ này không kiểm tra hiệu lực khóa hoặc xác nhận AI đang trả lời.

Sau khi bản mới Live, gửi một câu hỏi ngắn trên website và kiểm tra câu trả lời thật. Nếu lỗi, dùng **Chi tiết lỗi → Sao chép thông tin lỗi**; xem [cách đọc báo cáo](ai-troubleshooting.md). Không gửi khóa qua chat hoặc đưa vào GitHub. Nếu khóa đã lộ, thu hồi/thay khóa tại nơi cấp và cập nhật biến của đúng nhà cung cấp trong Render.

Nhà cung cấp, model và địa chỉ API được chốt khi máy chủ khởi động. Mỗi yêu cầu chỉ đọc khóa của nhà cung cấp đã chọn; thiếu khóa sẽ báo lỗi cấu hình, không mượn khóa của dịch vụ còn lại. Việc khôi phục model chỉ dùng catalog của cùng nhà cung cấp, không tự chuyển hội thoại sang dịch vụ khác. Giới hạn tối đa hai POST/55 giây cho chat và hạn mức riêng của bộ gợi ý dạng câu được giữ nguyên.

## Phạm vi kiểm tra

```sh
node tests/provider-config.mjs
node tests/provider-routing.mjs
node tests/chat-upstream.mjs
node tests/model-fallback.mjs
node tests/chat-model-recovery.mjs
node tests/practice-plan.mjs
node tests/origin-policy.mjs
```

Các bài kiểm tra dùng HTTP cục bộ và phản hồi AI giả lập: xác minh định tuyến, cách ly khóa, CORS, hạn mức và phục hồi model. Chúng không gọi API trả phí, không xác nhận khóa thật, khả dụng model hoặc hỗ trợ tham số sinh câu trả lời của tài khoản đang triển khai. Kết nối Google trực tiếp chưa được kiểm chứng bằng một phản hồi AI thật trong môi trường phát triển này.
