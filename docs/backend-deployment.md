# Tài khoản, database và agent

Bản này giữ giao diện, 30 bài học, lab, quiz và AI Tutor của GitHub. Backend NestJS được nhập từ mã nguồn gửi kèm, có PostgreSQL, Redis, tài khoản, xác minh email, phân quyền, agent và nhật ký hoạt động. Các cấu hình thiếu ở thư mục gốc backend đã được dựng lại và khóa phiên bản bằng `backend/package-lock.json`.

## GitHub Pages và máy chủ

Nếu dùng Render Free, làm theo [hướng dẫn từng bước](render-free-deployment.md). Bản này hỗ trợ vault AI mã hóa trong PostgreSQL và tạo admin đầu tiên khi startup, không cần Shell hay đĩa trả phí.

GitHub Pages chỉ phục vụ frontend. Đẩy repository không khởi động PostgreSQL, Redis hoặc NestJS. Dịch vụ AI Tutor hiện có ở Render vẫn hoạt động độc lập; không thay nó bằng backend mới khi chưa cấu hình đủ dịch vụ.

Frontend production mặc định để trống API tài khoản. Trang **Tài khoản** hiển thị tình trạng chưa kết nối, còn các chức năng học khách vẫn dùng được. Sau khi backend HTTPS hoạt động, sửa duy nhất địa chỉ công khai trong `frontend/src/config/backend.config.js`:

```js
apiBaseUrl: 'https://TEN-MAY-CHU-CUA-BAN/api',
```

Không đặt mật khẩu, JWT secret hoặc khóa AI trong frontend. Backend production phải đặt:

- `DATABASE_URL`: PostgreSQL bền vững; `REDIS_URL` hoặc `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`: Redis.
- `JWT_SECRET` và `JWT_REFRESH_SECRET`: hai chuỗi ngẫu nhiên khác nhau, mỗi chuỗi ít nhất 32 ký tự.
- `NODE_ENV=production` và `CORS_ORIGIN=https://thaivikhang2-byte.github.io`.
- Với đăng ký email công khai: `MAIL_PROVIDER=smtp`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_FROM`; tài khoản SMTP nếu máy chủ yêu cầu. Với tài khoản nội bộ do quản trị tạo: dùng đồng thời `MANAGED_ACCOUNTS_ENABLED=true`, `FEATURE_REGISTRATION_ENABLED=false`, `MAIL_PROVIDER=disabled`; xem [managed-accounts.md](managed-accounts.md).
- `APP_PORT`: cổng riêng nếu cần. Nếu bỏ trống, backend nhận `PORT` do nền tảng cấp rồi mới dùng mặc định 3000.

Các biến khác có giá trị mặc định an toàn trong backend. Agent mới mặc định tắt, cần cấu hình riêng theo [backend-agent.md](backend-agent.md). AI Tutor và tính năng gửi/cắt ảnh đang có được giữ nguyên.

## Chạy toàn bộ tại máy local

Cần Docker có Compose. Từ thư mục gốc repository:

```sh
node scripts/init-backend.cjs
docker compose up --build -d
```

Trình khởi tạo tạo `.env` với các mật khẩu ngẫu nhiên và từ chối ghi đè `.env` đã có. Không dùng cấu hình local này để công khai production. Compose áp dụng migration, tạo các vai trò mặc định trên database mới rồi khởi động API và frontend. Các volume database được giữ qua lần cập nhật thông thường; không dùng `down -v` với dữ liệu cần giữ.

Mở `http://localhost:5500/frontend/public/account.html`. API local ở `http://localhost:3000/api`. Đăng ký không tự cấp quyền quản trị. Khi dùng `MAIL_PROVIDER=file` ở local, đọc mã xác minh riêng trong outbox:

```sh
docker compose exec backend sh -c 'cat /app/.mail-outbox/*.json'
```

Lệnh này dành cho người vận hành local; nội dung chứa mã một lần của tài khoản thử, không đăng lên GitHub hoặc chia sẻ. Production không hỗ trợ outbox dạng file.

## Tạo quản trị viên và danh mục server

Không có tài khoản/mật khẩu quản trị mặc định. Để tạo quản trị viên đầu tiên, mở shell của backend:

```sh
docker compose exec backend sh
```

Trong shell đó, đặt `ALLOW_INITIAL_ADMIN_BOOTSTRAP=true`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_FIRST_NAME`, `BOOTSTRAP_ADMIN_LAST_NAME` bằng giá trị riêng, rồi chạy:

```sh
npm run admin:bootstrap
```

Mặc định, xác minh email bằng giao diện tài khoản. Với tài khoản nội bộ như địa chỉ `.local`, người vận hành có thể chủ động đặt `BOOTSTRAP_ADMIN_VERIFIED=true` trong tiến trình bootstrap dùng một lần để xác nhận danh tính; có audit và không bỏ qua xác minh của đăng ký công khai. Đặt `BOOTSTRAP_IMPORT_CATALOG=true` để nhập luôn danh mục sau khi tạo admin. Bootstrap không tự nâng quyền một người dùng đã tồn tại. Nếu nhập riêng danh mục, đọc UUID quản trị viên tại hồ sơ và chạy:

```sh
npm run db:content -- UUID-CUA-QUAN-TRI-VIEN
```

Trong Compose, chạy lệnh trên bằng `docker compose exec backend ...`. Import giữ các ID xác định, chỉ thêm nội dung còn thiếu, không ghi đè sửa đổi trong database; quiz tự học không bị biến thành điều kiện bắt buộc mới. Học khách và lab hiện có vẫn dùng danh mục frontend ngay cả khi chưa import server.

Trên một server có Shell, `npm run setup:admin` là trình nhập tương tác: nhập email,
mật khẩu được ẩn; credential chỉ truyền cho tiến trình bootstrap rồi bỏ khỏi bộ nhớ
wrapper. Không cần chép mật khẩu vào Environment chạy lâu dài. Lệnh tạo admin đã
được người vận hành xác nhận và nhập danh mục; không dùng để nâng quyền tài khoản
cũ. Backend cần được migrate/seed trước đó.

Khi triển khai Node trực tiếp, build bằng `npm ci --include=dev && npm run prisma:generate && npm run build`,
start bằng `npm run start:production`. Startup áp dụng migration và seed an toàn rồi
mới chạy API; lỗi khởi tạo làm dừng startup. Chỉ đặt `RUN_MIGRATIONS_ON_START=false`
khi đã có job migration riêng. GitHub Actions vẫn kiểm tra migration chuẩn trên database test.
Build cũng biên dịch seed và helper admin vào `dist/setup`; startup gọi Node trực tiếp
để tránh TypeScript compiler chiếm bộ nhớ của dịch vụ Render Free.

Với VPS có Docker và domain riêng, có thêm `scripts/setup-production.cjs` và
`scripts/deploy-production.cjs` cùng `docker-compose.production.yml`/Caddy. Chúng
tạo file bí mật riêng, giữ credential admin trong hồ sơ dùng một lần ngoài môi
trường backend, và không xóa volume khi cập nhật. Chọn `--existing-proxy` nếu VPS
đã có reverse proxy/SSL quản lí riêng. Cấu hình này không tự tạo hoặc mua máy chủ.

## Cách lưu và quản lí dữ liệu

- Khi chưa đăng nhập, dữ liệu khách vẫn nằm ở các khóa trình duyệt cũ.
- Khi đăng nhập, tiến độ, nhật ký, lịch sử quiz/ôn tập và dự án Micro:bit nằm trong vùng riêng của tài khoản và đồng bộ PostgreSQL. Không tự nhập dữ liệu khách vào tài khoản; người học chọn nhập trên trang Tài khoản.
- Bản nháp đã lưu local được xếp hàng khi mất mạng. Nếu hai thiết bị sửa cùng bản dữ liệu, trả về xung đột revision và yêu cầu chọn bản server hoặc bản thiết bị; có tải bản sao trước khi xử lí.
- Bộ đánh giá pre/post dùng chung cho nhiều người trên một máy vẫn lưu local; không tự đưa danh sách người tham gia vào tài khoản cá nhân.
- Người học chủ động **Tham gia khóa** nếu muốn có trong danh sách lớp. Giáo viên được phân công chỉ xem thống kê của người đã tham gia đúng khóa; nhật ký riêng và mã dự án không nằm trong báo cáo quản lí.
- Tiến độ/quiz từ giao diện tự học được ghi rõ là báo cáo của người học (`learner-self-report`). Nó không được nâng thành điểm chấm bởi server, chứng nhận hay minh chứng thực hành đã kiểm chứng. Agent đọc đúng nguồn này khi trả lời về tiến độ.
- Sự kiện mở bài/lab và hoàn thành quiz được ghi khi online; snapshot tiến độ có hàng đợi bền vững, các sự kiện hoạt động rời rạc hiện là best-effort.

## Kiểm tra kỹ thuật

```sh
cd backend
npm ci
npm run prisma:generate
npm run build
npm run typecheck
npm test
```

Trên máy chủ triển khai, chạy `npm run db:migrate` và `npm run db:seed` trước khi khởi động. Migration chuẩn dùng Prisma migration engine. Runtime/generate dùng PostgreSQL JavaScript adapter. Bộ kiểm tra local trong môi trường bị hạn chế tải binary đã chạy nguyên SQL migration trên database PostgreSQL dùng một lần; `scripts/apply-disposable-test-migrations.cjs` có chặn bắt buộc `NODE_ENV=test`, host loopback và tên database kết thúc `_test`. Không dùng helper fixture đó để triển khai production.

Kiểm thử trình duyệt không gọi AI trả phí; provider/model AI thật và khả năng nhúng của các dịch vụ bên ngoài cần được xác nhận trên máy chủ đã cấu hình. Xem thêm `tests/account-fullstack-smoke.py` và các kiểm thử giữ nguyên giao diện học/cắt ảnh.
