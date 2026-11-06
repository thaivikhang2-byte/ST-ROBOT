# Kiểm tra kết nối AI

Thông báo cũ “Kết nối trả lời bị gián đoạn. Vui lòng gửi lại câu hỏi sau.” xuất hiện khi máy chủ nhận HTTP không thành công từ nhà cung cấp. Chỉ thông báo này chưa phân biệt được khóa không hợp lệ, model không được hỗ trợ, hết hạn mức hay quá tải. Nó cũng không chứng minh câu hỏi của học sinh sai.

## Kiểm tra bản đang chạy

Frontend gọi `https://st-robot-1.onrender.com/api/home-chat`; AI Tutor gọi `/api/tutor` và bộ gợi ý dạng câu gọi `/api/practice-plan` trên cùng dịch vụ. GitHub Pages chỉ phục vụ frontend. Khi sửa mã API, dịch vụ AI trên Render cần triển khai commit mới để áp dụng bản sửa máy chủ.

Có thể mở `https://st-robot-1.onrender.com/health` ngay trên điện thoại. `ok` xác nhận tiến trình hoạt động; `revision` cho biết commit Render đang chạy nếu có biến `RENDER_GIT_COMMIT`. `ai.keyConfigured` và `ai.modelConfigured` chỉ xác nhận có nhập giá trị cấu hình; chúng không xác thực khóa/model với nhà cung cấp. `ai.allowedOrigin` là địa chỉ website được phép kết nối. Phản hồi không chứa khóa API hoặc giá trị model. Nếu chỉ có `{"ok":true}`, máy chủ đang chạy bản chưa có phần kiểm tra cấu hình này.

`ALLOWED_ORIGIN` được chuẩn hóa về origin (giao thức, tên miền, cổng) trước khi kiểm tra. Ví dụ `https://thaivikhang2-byte.github.io/ST-ROBOT/` và cùng URL có dấu `/` cuối hoặc khoảng trắng ngoài đều trở thành `https://thaivikhang2-byte.github.io`. Cấu hình sai định dạng trước đây gây 403 ở yêu cầu OPTIONS, khiến trình duyệt chỉ báo lỗi kết nối. Website khác, cổng khác và giao thức khác vẫn bị từ chối; không dùng wildcard để bỏ qua kiểm tra.

Một hồi quy khác đã tái hiện: khi quiz chuyển sang gọi lập kế hoạch tự động, các lượt đó dùng chung toàn bộ hạn mức và hai chỗ xử lý với chat. Trình duyệt bỏ yêu cầu sau 4 giây nhưng máy chủ trước đây vẫn đợi tới 20 giây, dẫn đến chat nhận 429 bận hoặc hết lượt. Bản sửa giới hạn riêng phần lập kế hoạch, dành chỗ cho chat và hủy upstream khi client ngắt kết nối. Dễ/Khó chọn mẫu tại chỗ; Vừa vẫn có gợi ý AI. Điều này sửa hồi quy dùng chung tài nguyên; lỗi HTTP 502 từ nhà cung cấp vẫn cần đối chiếu mã lỗi riêng, không quy mọi lỗi mất kết nối cho cùng một nguyên nhân.

Render Free có thể cần hơn 50 giây để khởi động sau khi ngừng hoạt động. Trước đây chat dùng một giới hạn tổng 75 giây, tutor 65 giây, trong khi riêng máy chủ có thể đợi AI tới 55 giây. Frontend hiện gọi `GET /health` trước, cho máy chủ tối đa 90 giây khởi động, rồi mới bắt đầu giới hạn 65 giây cho câu trả lời. Kết quả readiness được giữ 5 phút; không ping định kỳ và không gọi AI trong bước đánh thức. Chỉ GET readiness được thử lại khi gặp lỗi tạm thời; không tự gửi lại POST của người học. Hủy/reset vẫn hủy yêu cầu và bỏ kết quả cũ.

Khi chat hoặc tutor báo lỗi, mở **Chi tiết lỗi → Sao chép thông tin lỗi** ngay trong website. Báo cáo chỉ chứa mã lỗi an toàn, giai đoạn, HTTP của website, HTTP của nhà cung cấp nếu có, mã giao thức đã được cho phép và request ID. `stage: provider` phân biệt lỗi HTTP từ dịch vụ AI; `transport` là lỗi kết nối/timeout của API máy chủ; `server` là lỗi xử lý nội bộ; `startup` là bước khởi động/readiness trong trình duyệt. Phản hồi không chứa khóa API, câu hỏi, hội thoại, tên model hay nguyên văn lỗi nhà cung cấp. Mã model không hợp lệ được nhận diện cả khi nhà cung cấp trả 5xx kèm mã `model_not_found`; lỗi 503 chung vẫn là gián đoạn dịch vụ, không tự đổi model theo phỏng đoán.

Các thay đổi về thời gian chờ không khắc phục được một dịch vụ AI đang trả lỗi 5xx hoặc khóa/model không hợp lệ. Cần phản hồi thật hoặc báo cáo lỗi mới để xác nhận trường hợp đang triển khai.

## Dự phòng khi model Gemini bị lỗi

`stage: provider` cùng `upstreamStatus: 503` xác nhận lời gọi tới nhà cung cấp đã nhận HTTP 503; không chỉ ra riêng thiếu model, kênh quá tải hay toàn dịch vụ ngừng hoạt động. Model chính giữ nguyên giá trị `AI_MODEL` đã cấu hình. ID cần đúng như danh sách của nhà cung cấp; tên gõ lại có khoảng trắng hoặc sai ký tự chưa chứng minh là ID hợp lệ.

Sau lỗi 5xx từ provider hoặc mã model không hợp lệ, chat/tutor dùng lần thử thứ hai sẵn có để chuyển sang một model Gemini Flash được catalog xác nhận. Máy chủ đọc `GET https://llm.wokushop.com/v1/models` bằng cùng khóa đã cấu hình, rồi chọn theo thứ tự `gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-flash-latest`. Chỉ ID khớp hoàn toàn trong catalog mới được chọn; ID hiện tại được bỏ qua. Chỉ áp dụng khi model chính thuộc nhóm Gemini. Không tự sửa tên model theo phỏng đoán hoặc chuyển sang nhà cung cấp khác.

Đọc catalog và JSON có deadline phụ 5 giây, nằm trong giới hạn tổng 55 giây. Chỉ phần giao với danh sách dự phòng cố định được giữ tối đa 10 phút theo fingerprint khóa; giới hạn 8 mục cache. Catalog lỗi, không đúng cấu trúc hoặc không có ứng viên thì giữ hành vi thử lại/lỗi cũ. Không đổi model khi lỗi xác thực, quota, HTTP 429, phản hồi đã sinh nhưng thiếu nội dung hoặc provider yêu cầu chờ hơn một giây. Mã xác thực đã biết vẫn được nhận diện ngay cả khi provider trả HTTP 503.

Mỗi câu hỏi vẫn tối đa hai POST sinh câu trả lời; việc tra catalog không sinh câu trả lời. Tổng giới hạn ngày/phút/concurrency của website giữ nguyên. Log `ai_model_fallback` chỉ ghi request ID và nhóm lỗi, không ghi khóa, tên model, câu hỏi hay catalog. Catalog xác nhận có ID, không chứng minh model đang có năng lực xử lý, rẻ hơn hoặc có chất lượng tương đương model chính. Nếu cả model dự phòng cũng thất bại, máy chủ trả lỗi thật của lần cuối, không gọi lần ba hoặc dựng đáp án giả. Cơ chế này không khôi phục được một nhà cung cấp đang lỗi trên mọi model.

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
node tests/model-fallback.mjs
node tests/chat-model-recovery.mjs
node tests/ai-readiness.mjs
node tests/origin-policy.mjs
node tests/practice-plan.mjs
node start-web.cjs
# Trong terminal khác:
python3 tests/chat-recovery-smoke.py --base http://127.0.0.1:5500 --chromium /usr/bin/chromium
```

Các bài kiểm tra dùng HTTP và trình duyệt thật với phản hồi AI giả lập; không gọi dịch vụ trả phí. Phản hồi thật cần kiểm tra riêng trên dịch vụ đang triển khai và tài khoản đang cấu hình.
