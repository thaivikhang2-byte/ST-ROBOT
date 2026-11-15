# Triển khai bản thử nghiệm trên Render Free

Giữ nguyên hai dịch vụ AI cũ. Tạo **Web Service mới** cho backend tài khoản; frontend vẫn ở GitHub Pages. Hướng dẫn này dùng PostgreSQL và Key Value cùng vùng **Oregon (US West)**, project **My project**, environment **Production**.

## 1. Cấu hình Web Service

Kết nối repository `thaivikhang2-byte/ST-ROBOT`, nhánh `main`:

| Mục | Giá trị |
| --- | --- |
| Name | `strobot-backend` hoặc tên chưa được dùng |
| Language | Node |
| Root Directory | `backend` |
| Build Command | `npm ci --include=dev && npm run prisma:generate && npm run build` |
| Start Command | `npm run start:production` |
| Instance Type | Free |
| Health Check Path, nếu có | `/api/system/health/ready` |

Không đặt `APP_PORT`: ứng dụng nhận `PORT` do Render cấp. Giữ development dependencies trong build vì migration, seed và tạo admin cần Prisma CLI/ts-node.

## 2. Environment Variables

Ở phần **Environment Variables**, thêm mỗi dòng thành một cặp **Key / Value**:

| Key | Value |
| --- | --- |
| `NODE_VERSION` | `22` |
| `NODE_ENV` | `production` |
| `CORS_ORIGIN` | `https://thaivikhang2-byte.github.io` |
| `MANAGED_ACCOUNTS_ENABLED` | `true` |
| `FEATURE_REGISTRATION_ENABLED` | `false` |
| `MAIL_PROVIDER` | `disabled` |
| `AI_VAULT_STORAGE` | `database` |
| `AI_GATEWAY_ENABLED` | `true` |
| `FEATURE_AI_ENABLED` | `true` |
| `TRUST_PROXY` | `1` |
| `VIDEO_WORKER_ENABLED` | `false` |
| `SWAGGER_ENABLED` | `false` |
| `BACKUP_ENABLED` | `false` |
| `LOG_LEVEL` | `info` |

Thêm các giá trị riêng dưới đây trực tiếp vào Render. Không gửi giá trị qua chat, ảnh chụp, GitHub hoặc frontend.

| Key | Lấy Value ở đâu |
| --- | --- |
| `DATABASE_URL` | Mở database `strobot-db` trong tab Render khác → **Connect** → sao chép **Internal Database URL**. Dán vào Environment của Web Service mới. |
| `REDIS_URL` | Mở Key Value `strobot-redis` → **Connect** → sao chép **Internal Key Value URL** (có thể ghi Internal Redis URL). Dán nguyên URL vào Web Service mới. |
| `JWT_SECRET` | Chuỗi ngẫu nhiên riêng ít nhất 32 ký tự. |
| `JWT_REFRESH_SECRET` | Chuỗi ngẫu nhiên khác với `JWT_SECRET`. |
| `AI_CREDENTIALS_MASTER_KEY` | Khóa ngẫu nhiên 32 byte, mã hóa thành **64 ký tự hex** hoặc base64 chuẩn. Giữ nguyên khóa qua các lần deploy. |

Các dịch vụ phải cùng vùng để dùng Internal URL. Không lấy PostgreSQL URL làm Redis URL. Không thêm dấu nháy bao quanh Value.

Nếu cần tạo ba khóa trên Windows: mở **Start → PowerShell**, dán cả khối dưới đây rồi Enter. Đây là lệnh chạy tại máy của người vận hành, không gửi kết quả cho người khác:

```powershell
$strobotRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
foreach ($strobotKeyName in @('JWT_SECRET', 'JWT_REFRESH_SECRET', 'AI_CREDENTIALS_MASTER_KEY')) {
  $strobotBytes = New-Object byte[] 32
  $strobotRng.GetBytes($strobotBytes)
  $strobotKeyValue = [BitConverter]::ToString($strobotBytes).Replace('-', '').ToLowerInvariant()
  Write-Output ($strobotKeyName + '=' + $strobotKeyValue)
}
$strobotRng.Dispose()
```

Chỉ sao chép phần sau dấu `=` vào đúng Value trên Render. Cất `AI_CREDENTIALS_MASTER_KEY` trong nơi lưu mật khẩu riêng: mất khóa thì không giải mã được khóa provider đã lưu trong database. Không tạo lại khóa này mỗi lần deploy.

## 3. Tạo admin lần đầu, không cần Shell

Thêm tạm ba biến vào chính Web Service backend:

| Key | Value |
| --- | --- |
| `INITIAL_ADMIN_ENABLED` | `true` |
| `INITIAL_ADMIN_EMAIL` | Email quản trị do người vận hành chọn |
| `INITIAL_ADMIN_PASSWORD` | Mật khẩu riêng ít nhất 12 ký tự, tối đa 72 byte |

Bật biến này là xác nhận của người vận hành về danh tính tài khoản nội bộ. Startup áp dụng migration/seed, tạo admin đầu tiên đã xác nhận, nhập danh mục khóa học rồi chạy API. Không có mật khẩu mặc định. Không dùng cơ chế này để nâng quyền tài khoản có sẵn, đặt lại mật khẩu hoặc khôi phục quyền đã thu hồi.

Khi đã điền đủ, bấm **Deploy Web Service**. Đợi **Live**, mở đường dẫn công khai của dịch vụ với hậu tố `/api/system/health/ready`. Đáp ứng thành công có API envelope và `data.status` là `ok`.

Sau lần tạo admin thành công, vào backend → **Environment**, xóa `INITIAL_ADMIN_ENABLED`, `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`, lưu và deploy lại. Wrapper không truyền các biến mật khẩu khởi tạo cho tiến trình API nhưng vẫn cần xóa chúng khỏi cấu hình Render.

Nếu log báo đã tạo admin nhưng nhập danh mục thất bại, xóa ba biến tạo admin, thêm tạm `INITIAL_ADMIN_CATALOG_RETRY_ID` bằng UUID quản trị được in trong thông báo lỗi an toàn rồi deploy lại. Chế độ này chỉ nhập lại nội dung, không tạo tài khoản, đổi mật khẩu hoặc cấp lại quyền. Xóa biến retry sau khi thành công; không xóa database hay tạo admin khác.

## 4. Kết nối frontend và cấu hình AI

Gửi **chỉ URL công khai** của Web Service mới để cập nhật `frontend/src/config/backend.config.js` với hậu tố `/api`. URL này không phải chuỗi kết nối database. GitHub Pages cần được deploy lại sau khi cấu hình được đẩy lên `main`.

Mở trang Tài khoản trên website, đăng nhập admin vừa tạo. Trong khu vực quản trị:

1. Tạo học sinh để thử đăng nhập và lưu tiến độ. Tắt đăng ký công khai là lựa chọn quản lí nội bộ, không cần SMTP.
2. Mở phần cấu hình AI, thêm provider và khóa trực tiếp vào form riêng, chọn model hỗ trợ tools rồi bật AI theo giao diện. Không gửi khóa provider qua chat.
3. Thử học sinh hoàn thành một bài, tải lại hoặc đăng nhập ở trình duyệt khác; kiểm tra tiến độ được khôi phục. Hỏi tutor về bài/lab đang mở để kiểm tra ngữ cảnh đã đồng bộ.

Vault database lưu cấu hình provider và khóa **đã mã hóa**, nên redeploy/đánh thức Render không làm mất vault. Cần sao lưu cả PostgreSQL và master key riêng. Lưu trữ file upload/video trên đĩa Free vẫn không bền vững; cấu hình này tắt worker video và không bật backup vào đĩa tạm.

## Giới hạn gói Free và chẩn đoán

- Web Service có thể ngủ khi không hoạt động. Lần đăng nhập đầu có thể chờ; frontend chờ máy chủ sẵn sàng trước khi gửi thao tác tài khoản. Không gửi lại POST mật khẩu hay chat tự động.
- Key Value Free không có persistence. Tiến độ và tài khoản nằm ở PostgreSQL; Redis dùng cho giới hạn tốc độ/queue. Không dùng Redis làm nơi lưu duy nhất của bài học.
- PostgreSQL Free được Render thông báo hết hạn sau 30 ngày. Database `strobot-db` trong lượt thiết lập này có hạn **15/12/2026** theo dashboard. Cần nâng cấp hoặc chuyển/sao lưu dữ liệu trước hạn nếu dùng tiếp. Đây là cấu hình thử nghiệm, không phải cam kết lưu lâu dài miễn phí.
- AI provider tính quota/phí riêng; Render Free không cấp quyền gọi model miễn phí vô hạn.
- Nếu deploy lỗi, gửi phần log quanh lỗi và tên biến còn thiếu; che URL kết nối, token, mật khẩu và khóa. Không xóa database để thử sửa lỗi.
- `503` ở readiness: kiểm tra PostgreSQL/Key Value cùng vùng, trạng thái Available và Internal URL. Lỗi CORS: kiểm tra đúng origin HTTPS, không thêm đường dẫn `/ST-ROBOT` vào `CORS_ORIGIN`.

Khả năng chạy local được kiểm thử riêng; chỉ kết luận dịch vụ công khai hoạt động sau khi deploy, đăng nhập và kiểm tra lưu/đọc dữ liệu trên chính URL Render.
