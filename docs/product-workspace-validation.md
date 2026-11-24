# Kiểm chứng bản tài khoản và không gian học tập

Kiểm tra ngày 21/11/2026 trên database PostgreSQL 16 và Redis 7 dùng riêng cho thử nghiệm, với Chromium máy tính và điện thoại. Không dùng tài khoản thật, không gọi sinh nội dung AI tính phí và không thay đổi database đang chạy trên Render.

## Kết quả

- Backend build, typecheck và 41 bộ Jest / 302 kiểm thử: đạt.
- 16 bộ Node cho tài khoản, đo thời gian đăng nhập, kết nối, tải trang, cài đặt AI, đồng bộ, quiz, ôn tập, editor, portfolio và lab: đạt.
- Giao diện tài khoản trên máy tính/điện thoại: đạt; danh sách quản trị chuyển sang thẻ trên màn hình hẹp, cấu hình AI chỉ tải khi admin chủ động mở.
- Lab browser: nội dung công khai không chờ đăng nhập, giữ bài/tab/nền tảng khi khôi phục phiên, không nhập tệp sang tài khoản khác, kiểm tra giới hạn và đủ 30 bài: đạt.
- Hành trình thực tế `tests/product-journey-smoke.py`: 9 nhóm đạt. Đăng ký trên điện thoại nhận trạng thái chờ; admin duyệt; học sinh đăng nhập, hoàn thành thực hành và đồng bộ nhật ký/mã/ghi chú; trình duyệt thứ hai thấy tiến độ và bài đã lưu. Học sinh khác thấy dữ liệu riêng của mình. Admin thấy 1/30 bài và thời điểm hoạt động, không nhận nội dung nhật ký/mã. Đăng xuất tại tab tài khoản làm tab lab cùng trình duyệt xóa các ô riêng, khóa/ẩn lưu và hiện nút đăng nhập; không có yêu cầu ghi muộn vào dữ liệu học. Bài trên server và phiên thiết bị độc lập được giữ lại, đăng nhập lại khôi phục được bài đã lưu.
- Khởi tạo đã biên dịch chạy dưới heap 128 MiB, không tải TypeScript lúc chạy; thử lại giữ nguyên tài khoản và quyền đã thu hồi. Khởi tạo mặc định lặp lại giảm từ 81 truy vấn xuống một lần đọc dấu phiên bản trong kiểm thử delegate.

Hành trình dùng metadata của kết nối AI giả lập đã mã hóa để kiểm tra agent dùng chung và quyền truy cập. Không coi kết quả đó là kiểm chứng khả năng trả lời của nhà cung cấp AI thật. Kết nối AI thật đã cấu hình được giữ nguyên khi cập nhật.

Bản tối ưu tốc độ giữ nguyên các luồng trên. Fixture trình duyệt có độ trễ xác nhận danh sách học sinh không còn tải lặp, thao tác ghi nhận kết quả mới sau khi lưu và các trang chỉ tải controller tương ứng. Chi tiết số đo và giới hạn của Render Free ở [hướng dẫn hiệu năng](performance.md).

Ngày 24/11/2026 bỏ hoàn toàn mục chi tiết thời gian đăng nhập, nút sao chép và bộ đếm giây theo yêu cầu. Kiểm thử clocked xác nhận giao diện vẫn gọn khi chờ lâu, gặp lỗi, hủy đăng nhập hoặc mở đường dẫn chẩn đoán cũ; đăng nhập vẫn hoạt động với service đã cache từ trước. Các phép đo nội bộ được giữ riêng cho kiểm thử và bảo trì.

Kiểm chứng bản xác thực ngày 24/11/2026: build/typecheck đạt; 43 bộ Jest / 329 kiểm thử đạt (sáu kiểm thử HTTP chạy lại với quyền mở cổng loopback sau khi sandbox chặn `listen`). Hành trình PostgreSQL/Chromium chín nhóm chạy lại đạt với bản Argon và truy vấn gộp. Bộ hash native bảy kiểm thử cũng đạt trên Node 22.23.5. Toàn ứng dụng chạy trong Docker 0,1 CPU/512 MiB cho đăng nhập Argon khoảng 0,8–1,1 giây sau khi máy chủ đã chạy, so với bcrypt 2,8–3 giây; RSS cao nhất 290,9 MiB khi có hai tác vụ Argon. Đây là kiểm thử cục bộ, không gồm mạng production hoặc thời gian thức máy Render. Chi tiết phương pháp và lần chuyển hash đầu ở [hướng dẫn hiệu năng](performance.md).

Fixture native/PostgreSQL `tests/auth-upgrade-pg.cjs` đạt tám nhóm; hai lần đăng nhập bcrypt đồng thời cùng thành công với đúng một lần thử lại, reset đồng thời không cấp phiên từ mật khẩu cũ, phiên đã có vẫn hợp lệ sau chuyển thuật toán và ứng viên hơn 72 byte UTF-8 giữ hash cũ. So sánh driver xác nhận đăng nhập 15→8 câu lệnh, JWT 9→1 và quyền/giới hạn scope vẫn tương đương. Database thử riêng được xóa sau kiểm tra; workflow GitHub chạy lại fixture này trên Node 22.

## Triển khai và sử dụng

Backend Render giữ Root Directory `backend`, build `npm ci --include=dev && npm run prisma:generate && npm run build`, start `npm run start:production`. Startup tự áp dụng migration bổ sung cờ chờ duyệt, giữ dữ liệu tài khoản cũ. Với `MANAGED_ACCOUNTS_ENABLED=true`, luồng học sinh chờ duyệt mặc định được bật; không cần nhập lại khóa AI hay tạo lại admin. GitHub Pages phục vụ frontend mới từ cùng nhánh chính. Nếu Auto-Deploy bị tắt, chọn **strobot-backend → Manual Deploy → Deploy latest commit** rồi chờ Live. Backend và frontend phải cùng cập nhật trước khi kiểm tra đăng ký mới.

Học sinh chọn **Đăng nhập → Tạo tài khoản**, chờ duyệt rồi đăng nhập để học. Admin chọn **Học viên → Chờ duyệt → Duyệt học sinh**. Bài học gần nhất và tiến độ nằm ở **Việc học của tôi**; bài lab có **Bài thực hành của tôi**. Chờ thông báo đã đồng bộ trước khi chuyển máy.

Render Free vẫn có thời gian thức dậy sau khi ngủ. Các thay đổi giảm chờ thừa trong ứng dụng, không tạo cam kết backend luôn sẵn sàng. Để trình diễn ít rủi ro hơn, mở thử đăng nhập và agent trước buổi thi; triển khai backend luôn chạy là lựa chọn hạ tầng riêng, không được tự mua hoặc nâng gói trong lần cập nhật này. Database miễn phí của bản Render đã tạo có ngày hết hạn hiển thị 15/12/2026; phải xuất dữ liệu hoặc chuyển/nâng database trước ngày đó nếu tiếp tục sử dụng.

Tài khoản nền tảng lab ngoài chưa có SSO chung. Bản mã/ghi chú/liên kết trong ST-Robot được đồng bộ theo tài khoản; dự án ngoài tuân theo cơ chế lưu và quyền riêng tư của nhà cung cấp. Xem [phạm vi tích hợp từng nền tảng](lab-account-integration.md).
