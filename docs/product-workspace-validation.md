# Kiểm chứng bản tài khoản và không gian học tập

Kiểm tra ngày 21/11/2026 trên database PostgreSQL 16 và Redis 7 dùng riêng cho thử nghiệm, với Chromium máy tính và điện thoại. Không dùng tài khoản thật, không gọi sinh nội dung AI tính phí và không thay đổi database đang chạy trên Render.

## Kết quả

- Backend build, typecheck và 40 bộ Jest / 296 kiểm thử: đạt.
- 13 bộ Node cho tài khoản, kết nối, cài đặt AI, đồng bộ, quiz, ôn tập, editor, portfolio và lab: đạt.
- Giao diện tài khoản trên máy tính/điện thoại: đạt; danh sách quản trị chuyển sang thẻ trên màn hình hẹp, cấu hình AI chỉ tải khi admin chủ động mở.
- Lab browser: nội dung công khai không chờ đăng nhập, giữ bài/tab/nền tảng khi khôi phục phiên, không nhập tệp sang tài khoản khác, kiểm tra giới hạn và đủ 30 bài: đạt.
- Hành trình thực tế `tests/product-journey-smoke.py`: 8 nhóm đạt. Đăng ký trên điện thoại nhận trạng thái chờ; admin duyệt; học sinh đăng nhập, hoàn thành thực hành và đồng bộ nhật ký/mã/ghi chú; trình duyệt thứ hai thấy tiến độ và bài đã lưu. Học sinh khác thấy dữ liệu riêng của mình. Admin thấy 1/30 bài và thời điểm hoạt động, không nhận nội dung nhật ký/mã.
- Khởi tạo đã biên dịch chạy dưới heap 128 MiB, không tải TypeScript lúc chạy; thử lại giữ nguyên tài khoản và quyền đã thu hồi. Khởi tạo mặc định lặp lại giảm từ 81 truy vấn xuống một lần đọc dấu phiên bản trong kiểm thử delegate.

Hành trình dùng metadata của kết nối AI giả lập đã mã hóa để kiểm tra agent dùng chung và quyền truy cập. Không coi kết quả đó là kiểm chứng khả năng trả lời của nhà cung cấp AI thật. Kết nối AI thật đã cấu hình được giữ nguyên khi cập nhật.

## Triển khai và sử dụng

Backend Render giữ Root Directory `backend`, build `npm ci --include=dev && npm run prisma:generate && npm run build`, start `npm run start:production`. Startup tự áp dụng migration bổ sung cờ chờ duyệt, giữ dữ liệu tài khoản cũ. Với `MANAGED_ACCOUNTS_ENABLED=true`, luồng học sinh chờ duyệt mặc định được bật; không cần nhập lại khóa AI hay tạo lại admin. GitHub Pages phục vụ frontend mới từ cùng nhánh chính. Nếu Auto-Deploy bị tắt, chọn **strobot-backend → Manual Deploy → Deploy latest commit** rồi chờ Live. Backend và frontend phải cùng cập nhật trước khi kiểm tra đăng ký mới.

Học sinh chọn **Đăng nhập → Tạo tài khoản**, chờ duyệt rồi đăng nhập để học. Admin chọn **Học viên → Chờ duyệt → Duyệt học sinh**. Bài học gần nhất và tiến độ nằm ở **Việc học của tôi**; bài lab có **Bài thực hành của tôi**. Chờ thông báo đã đồng bộ trước khi chuyển máy.

Render Free vẫn có thời gian thức dậy sau khi ngủ. Các thay đổi giảm chờ thừa trong ứng dụng, không tạo cam kết backend luôn sẵn sàng. Để trình diễn ít rủi ro hơn, mở thử đăng nhập và agent trước buổi thi; triển khai backend luôn chạy là lựa chọn hạ tầng riêng, không được tự mua hoặc nâng gói trong lần cập nhật này. Database miễn phí của bản Render đã tạo có ngày hết hạn hiển thị 15/12/2026; phải xuất dữ liệu hoặc chuyển/nâng database trước ngày đó nếu tiếp tục sử dụng.

Tài khoản nền tảng lab ngoài chưa có SSO chung. Bản mã/ghi chú/liên kết trong ST-Robot được đồng bộ theo tài khoản; dự án ngoài tuân theo cơ chế lưu và quyền riêng tư của nhà cung cấp. Xem [phạm vi tích hợp từng nền tảng](lab-account-integration.md).
