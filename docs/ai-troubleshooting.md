# Kiểm tra kết nối AI

Thông báo cũ “Kết nối trả lời bị gián đoạn. Vui lòng gửi lại câu hỏi sau.” xuất hiện khi máy chủ nhận HTTP không thành công từ nhà cung cấp. Chỉ thông báo này chưa phân biệt được khóa không hợp lệ, model không được hỗ trợ, hết hạn mức hay quá tải. Nó cũng không chứng minh câu hỏi của học sinh sai.

## Kiểm tra bản đang chạy

Frontend gọi `https://st-robot.onrender.com/api/home-chat`; AI Tutor gọi `/api/tutor` trên cùng dịch vụ. GitHub Pages chỉ phục vụ frontend. Sau khi cập nhật GitHub, dịch vụ AI trên Render cần triển khai commit mới để áp dụng bản sửa máy chủ. `GET /health` chỉ xác nhận tiến trình hoạt động, không kiểm tra khóa hoặc model với nhà cung cấp.

Trong Render, mở dịch vụ AI → Logs. Bản mới ghi JSON `ai_upstream_failure` với `status`, `code`, số lần thử và `requestId`. Đối chiếu `requestId` với phản hồi API nếu cần. Không đưa khóa API, câu hỏi, hội thoại hay toàn bộ phản hồi lỗi của nhà cung cấp vào log.

| Mã lỗi | Việc cần kiểm tra |
| --- | --- |
| `AI_AUTH` | Cập nhật `WOKU_API_KEY` trong cấu hình bảo mật của Render; kiểm tra khóa còn hiệu lực và được phép gọi API. Không gửi khóa qua chat hoặc đưa vào GitHub. |
| `AI_MODEL` | Đặt `AI_MODEL` đúng ID trong danh sách model mà tài khoản tại nhà cung cấp được dùng. Không tự đoán tên hoặc đổi sang model ngẫu nhiên. |
| `AI_QUOTA` | Kiểm tra số dư/hạn mức tại nhà cung cấp. Khác với hạn mức ngày của website. |
| `AI_BUSY` | Chờ thời gian `Retry-After` rồi thử lại. |
| `AI_UNAVAILABLE`, `AI_NETWORK`, `AI_TIMEOUT` | Kiểm tra trạng thái nhà cung cấp và kết nối từ Render; có thể thử lại. |
| `AI_RESPONSE` | Nhà cung cấp trả nội dung thiếu hoặc không đúng JSON; có thể thử lại. |
| `AI_REQUEST` | Kiểm tra cấu hình API và các tham số được nhà cung cấp hỗ trợ. |

Máy chủ chỉ tự thử lại một lần cho lỗi mạng tạm thời, HTTP 408, 429 và 5xx. Không thử lại tự động nếu khóa/model/hạn mức không hợp lệ hoặc phản hồi sinh đã bị lỗi định dạng. Nếu nhà cung cấp yêu cầu chờ hơn một giây qua `Retry-After`, máy chủ trả thời gian chờ cho trình duyệt. Toàn bộ kết nối, đọc phản hồi và thử lại dùng chung giới hạn 55 giây; mỗi thao tác của người học chỉ tính một lượt trong hạn mức website, nhưng nhà cung cấp có thể tính từng lần gọi.

Không đổi dịch vụ AI sang câu trả lời dựng sẵn khi kết nối thất bại. Lượt lỗi không được thêm vào lịch sử hội thoại gửi cho AI. Nút **Thử lại** và việc gửi lại cùng câu hỏi giữ nguyên lượt trong khung chat; một bản nháp mới vẫn được giữ lại.

## Kiểm tra trước khi triển khai

```sh
node tests/chat-upstream.mjs
node tests/practice-plan.mjs
node start-web.cjs
# Trong terminal khác:
python3 tests/chat-recovery-smoke.py --base http://127.0.0.1:5500 --chromium /usr/bin/chromium
```

Các bài kiểm tra dùng HTTP và trình duyệt thật với phản hồi AI giả lập; không gọi dịch vụ trả phí. Phản hồi thật cần kiểm tra riêng trên dịch vụ đang triển khai và tài khoản đang cấu hình.
