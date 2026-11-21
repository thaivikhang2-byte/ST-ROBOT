# Tài khoản do nhà trường quản lí

Trong chế độ nhà trường, học sinh tự đăng ký rồi chờ quản trị viên duyệt. Quản trị viên vẫn có thể cấp tài khoản trực tiếp. Chế độ đăng ký qua SMTP trước đây tiếp tục hoạt động khi không bật quản lí tài khoản nhà trường.

```dotenv
NODE_ENV=production
CORS_ORIGIN=https://TEN-MIEN-FRONTEND
MANAGED_ACCOUNTS_ENABLED=true
STUDENT_APPROVAL_REGISTRATION_ENABLED=true
FEATURE_REGISTRATION_ENABLED=false
MAIL_PROVIDER=disabled
```

`STUDENT_APPROVAL_REGISTRATION_ENABLED` mặc định là `true`, nên bản Render đang dùng chế độ quản lí được mở luồng chờ duyệt sau khi cập nhật, không cần nhập lại cấu hình. Đặt biến này thành `false` để chỉ cho admin cấp tài khoản. `FEATURE_REGISTRATION_ENABLED=false` tắt luồng đăng ký SMTP, không tắt yêu cầu học sinh chờ duyệt. Production luôn yêu cầu origin HTTPS cụ thể; các khóa JWT, database và Redis vẫn cấu hình riêng như hướng dẫn triển khai.

## Quản trị viên đầu tiên

Người vận hành nhập thông tin riêng vào môi trường của **tiến trình bootstrap dùng một lần**, không đưa vào frontend, GitHub hay môi trường của backend chạy lâu dài:

- `ALLOW_INITIAL_ADMIN_BOOTSTRAP=true`.
- `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_FIRST_NAME`, `BOOTSTRAP_ADMIN_LAST_NAME`.
- `BOOTSTRAP_ADMIN_VERIFIED=true` nếu người vận hành chủ động xác nhận danh tính của tài khoản nội bộ. Nếu bỏ biến này, vẫn phải xác minh email như cũ.
- `BOOTSTRAP_IMPORT_CATALOG=true` để nhập danh mục 5 khóa/30 bài đã được duyệt sau khi tạo tài khoản.

Chạy `npm run admin:bootstrap` trong môi trường backend đã migrate và seed. Không có email hoặc mật khẩu mặc định trong mã nguồn. Cờ xác nhận chỉ có ở CLI; form đăng ký công khai không nhận quyền này. Bootstrap không nâng quyền tài khoản đã tồn tại. Nếu đã từng có quản trị viên, khôi phục cần cờ riêng `ALLOW_ADMIN_RECOVERY=true` và `BOOTSTRAP_RECOVERY_REASON` dài 20–1000 ký tự; không tự khôi phục quyền đã bị thu hồi.

Nếu nhập giáo trình thất bại sau khi tài khoản đã được tạo, công cụ nói rõ tài khoản đã tồn tại, hoàn tác riêng phần nhập nội dung và in lệnh thử lại `db:content` với UUID đó. Không chạy lại bootstrap để sửa lỗi nhập giáo trình.

## Tài khoản học sinh

Học sinh mở **Đăng nhập → Tạo tài khoản**, nhập tên, email và mật khẩu. `POST /api/v1/auth/student-requests` trả `202` với trạng thái `pending`, không cấp token, không gửi thư. Email trùng cũng nhận thông báo chung và không thay đổi tài khoản cũ. Tài khoản chưa duyệt không thể đăng nhập, đồng bộ hay dùng agent.

Admin mở **Học viên → Chờ duyệt → Duyệt học sinh**. `POST /api/v1/users/:id/approve-student` yêu cầu quản trị SYSTEM đã xác nhận và có `users:create`. Server chỉ duyệt học sinh đang chờ; không mở khóa tài khoản đã bị khóa hoặc đổi mật khẩu. Đây là xác nhận của nhà trường, không phải bằng chứng người học đã xác minh hộp thư. Học sinh đăng nhập bằng mật khẩu đã đăng ký sau khi được duyệt.

Danh sách **Học viên** có bộ lọc, tìm kiếm và phân trang. `GET /api/v1/users/student-overview` yêu cầu `users:read` và `analytics:read` ở phạm vi SYSTEM. Danh sách chỉ trả trạng thái, thời điểm đăng nhập/học gần nhất và số bài hoàn thành của năm khóa. Nhật ký riêng, mã nguồn lab và token không nằm trong báo cáo này. Tiến độ tự học chưa phải điểm do giảng viên chấm.

Quản trị viên SYSTEM đã được xác nhận, có `users:create` và quyền ủy nhiệm hợp lệ, dùng giao diện quản trị để gọi:

```http
POST /api/v1/users/students
Content-Type: application/json
Authorization: Bearer <phiên-quản-trị>

{"email":"hoc-sinh@truong.local","password":"<mật-khẩu-riêng>","firstName":"Tên","lastName":"Họ"}
```

Server tự chọn vai trò `student` đang hoạt động. Không nhận vai trò, quyền hoặc cờ xác nhận từ trình duyệt. Danh tính học sinh được quản trị viên xác nhận và ghi audit; điều này cho phép lưu tiến độ ngay, không phải tuyên bố email nội bộ đã nhận được thư SMTP.

Nếu học sinh quên mật khẩu, quản trị viên có `users:update` đặt mật khẩu mới bằng `POST /api/v1/users/:id/student-password` với body `{"newPassword":"<mật-khẩu-mới>"}`. Thao tác này chỉ áp dụng cho tài khoản học sinh đang hoạt động, không áp dụng cho chính người gọi hay bất kỳ người nào có vai trò nhân viên. Tất cả phiên đăng nhập cũ và token khôi phục đang chờ của học sinh đều bị thu hồi. Password không xuất hiện trong response hoặc audit.

`GET /api/v1/auth/options` trả các cờ `registrationEnabled`, `managedAccountsEnabled`, `emailDeliveryEnabled`, `approvalRegistrationEnabled` và `registrationMode` (`approval`, `email` hoặc `closed`). Không trả cấu hình SMTP, mật khẩu, khóa provider hay danh sách người dùng.

Agent dùng kết nối AI chung đã lưu trên server. Học sinh không nhập API key. Admin chỉ mở **Cài đặt → Cấu hình AI của hệ thống** khi bảo trì; trang quản lí học sinh không tự tải cấu hình AI mỗi lần đăng nhập.
