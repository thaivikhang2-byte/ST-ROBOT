# Tài khoản do nhà trường quản lí

Mặc định, người học tự đăng ký và xác minh email qua SMTP trước khi đồng bộ dữ liệu. Nếu hệ thống dùng tài khoản nội bộ như địa chỉ `.local`, người vận hành có thể bật chế độ quản lí tài khoản riêng, không cần giả vờ gửi thư đến địa chỉ đó:

```dotenv
NODE_ENV=production
CORS_ORIGIN=https://TEN-MIEN-FRONTEND
MANAGED_ACCOUNTS_ENABLED=true
FEATURE_REGISTRATION_ENABLED=false
MAIL_PROVIDER=disabled
```

Đây là ba lựa chọn đi cùng nhau. Tắt mail mà vẫn cho đăng ký công khai sẽ bị cấu hình từ chối. Production luôn yêu cầu origin HTTPS cụ thể và không cho phép outbox dạng file. Các khóa JWT, database và Redis vẫn phải được cấu hình riêng như hướng dẫn triển khai.

## Quản trị viên đầu tiên

Người vận hành nhập thông tin riêng vào môi trường của **tiến trình bootstrap dùng một lần**, không đưa vào frontend, GitHub hay môi trường của backend chạy lâu dài:

- `ALLOW_INITIAL_ADMIN_BOOTSTRAP=true`.
- `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_FIRST_NAME`, `BOOTSTRAP_ADMIN_LAST_NAME`.
- `BOOTSTRAP_ADMIN_VERIFIED=true` nếu người vận hành chủ động xác nhận danh tính của tài khoản nội bộ. Nếu bỏ biến này, vẫn phải xác minh email như cũ.
- `BOOTSTRAP_IMPORT_CATALOG=true` để nhập danh mục 5 khóa/30 bài đã được duyệt sau khi tạo tài khoản.

Chạy `npm run admin:bootstrap` trong môi trường backend đã migrate và seed. Không có email hoặc mật khẩu mặc định trong mã nguồn. Cờ xác nhận chỉ có ở CLI; form đăng ký công khai không nhận quyền này. Bootstrap không nâng quyền tài khoản đã tồn tại. Nếu đã từng có quản trị viên, khôi phục cần cờ riêng `ALLOW_ADMIN_RECOVERY=true` và `BOOTSTRAP_RECOVERY_REASON` dài 20–1000 ký tự; không tự khôi phục quyền đã bị thu hồi.

Nếu nhập giáo trình thất bại sau khi tài khoản đã được tạo, công cụ nói rõ tài khoản đã tồn tại, hoàn tác riêng phần nhập nội dung và in lệnh thử lại `db:content` với UUID đó. Không chạy lại bootstrap để sửa lỗi nhập giáo trình.

## Tài khoản học sinh

Quản trị viên SYSTEM đã được xác nhận, có `users:create` và quyền ủy nhiệm hợp lệ, dùng giao diện quản trị để gọi:

```http
POST /api/v1/users/students
Content-Type: application/json
Authorization: Bearer <phiên-quản-trị>

{"email":"hoc-sinh@truong.local","password":"<mật-khẩu-riêng>","firstName":"Tên","lastName":"Họ"}
```

Server tự chọn vai trò `student` đang hoạt động. Không nhận vai trò, quyền hoặc cờ xác nhận từ trình duyệt. Danh tính học sinh được quản trị viên xác nhận và ghi audit; điều này cho phép lưu tiến độ ngay, không phải tuyên bố email nội bộ đã nhận được thư SMTP.

Nếu học sinh quên mật khẩu, quản trị viên có `users:update` đặt mật khẩu mới bằng `POST /api/v1/users/:id/student-password` với body `{"newPassword":"<mật-khẩu-mới>"}`. Thao tác này chỉ áp dụng cho tài khoản học sinh đang hoạt động, không áp dụng cho chính người gọi hay bất kỳ người nào có vai trò nhân viên. Tất cả phiên đăng nhập cũ và token khôi phục đang chờ của học sinh đều bị thu hồi. Password không xuất hiện trong response hoặc audit.

`GET /api/v1/auth/options` chỉ trả ba cờ tính năng để giao diện hiển thị đúng: `registrationEnabled`, `managedAccountsEnabled`, `emailDeliveryEnabled`. Không trả cấu hình SMTP, mật khẩu, khóa provider hay danh sách người dùng.
