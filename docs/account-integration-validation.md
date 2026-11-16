# Kiểm tra bản tích hợp tài khoản — 14/11/2026

Giữ nguyên giao diện và nội dung GitHub, bổ sung backend từ `src.rar`, `prisma.rar`, `scripts.rar`. Không nhập `.env`, tài khoản thật hoặc database cá nhân vào repository.

## Sửa bộ nhớ startup Render Free — 16/11/2026

- Tái hiện nạp helper admin qua `ts-node` với heap 256 MiB bị V8 hết bộ nhớ trước khi kết nối database. Nạp seed theo cách cũ dùng khoảng 394 MiB RSS.
- `npm run build` biên dịch thêm seed/helper vào `dist/setup`; startup dùng JavaScript và giữ API ở `dist/main.js`, cùng thứ tự migration → seed → admin/catalog → API. Không thay đổi Environment hoặc nội dung database để sửa lỗi bộ nhớ.
- Build, typecheck, 33 bộ/236 kiểm thử backend và `tests/production-start.mjs` qua. Kiểm tra Node **22.23.5** trong container giới hạn **512 MiB**, heap **128 MiB**: nạp cả hai entrypoint setup thành công, không nạp TypeScript compiler, RSS tối đa khoảng **85 MiB**. Đây là kiểm tra phần khởi tạo, không phải số đo RAM của toàn bộ dịch vụ khi có tải.
- `tests/compiled-setup-smoke.py` qua trên PostgreSQL thật với database mới dùng một lần: áp dụng đủ 20 migration, tạo admin và 5 khóa/30 bài, lặp seed/admin giữ nguyên mật khẩu và quyền đã thu hồi, thử lại riêng danh mục. Năm lượt CLI đều giới hạn heap 128 MiB, dùng 69–111 MiB RSS trên Node 24.19.0 và không nạp compiler. Test chỉ xóa database ngẫu nhiên do nó tạo, không gọi AI; đã thêm vào workflow để chạy bằng Node 22.

## Cập nhật Render Free — 15/11/2026

- Build và typecheck qua; **33 bộ / 236 kiểm thử Jest** qua. Có kiểm tra vault file/database, mã hóa, CAS đồng thời, rollback audit, URL Redis/TLS, proxy HTTPS và admin khởi tạo dùng một lần.
- `account-service`, `account-connection`, `production-start`, `production-setup`, dashboard, thiết lập AI, tutor, learner sync, quiz, adaptive review và Micro:bit bridge qua. Chờ cold start chỉ thử lại health GET, có giới hạn/hủy; không tự gửi lại POST đăng nhập và giữ vùng dữ liệu theo chủ tài khoản.
- PostgreSQL 16/Redis 7 thật trên database test riêng: áp dụng đủ **20 SQL migrations**, seed, tạo admin bằng helper mới và nhập 5 khóa/30 bài. Không dùng tài khoản người vận hành thật.
- `tests/render-free-fullstack.py`: **8 nhóm qua** qua HTTP thật: nhận `PORT`, đăng nhập admin/học sinh do quản trị tạo, học sinh bị chặn vault, credential được mã hóa và metadata không lộ khóa, model đăng kí chủ động, CAS cũ/đồng thời rollback đúng, khởi động lại không cần đĩa bền vững, sai master key trả 503 và không sửa dữ liệu. Script không gọi endpoint khám phá model hay sinh câu trả lời của provider.
- Chromium: tài khoản học sinh/quản trị và mobile, thao tác học sinh, tutor theo dữ liệu chủ phiên/ảnh, giao diện cấu hình AI và thu hồi quyền đều qua với API fixture.

Các kiểm tra này chạy local trong môi trường cloud, **chưa xác nhận dịch vụ Render công khai**. Cần điền Environment, deploy backend, kết nối URL frontend rồi kiểm tra đăng nhập/lưu tiến độ trên website thật. Provider/model AI thật chưa được gọi trong lượt kiểm tra này. Hướng dẫn thao tác: [Render Free](render-free-deployment.md).

## Kết quả đã chạy

- Backend: tạo Prisma client, build và typecheck thành công; **24 bộ / 164 kiểm thử Jest** qua.
- Frontend: `account-service`, `learner-sync`, `quiz-service`, `adaptive-review`, `microbit-editor-bridge` qua. Có kiểm tra đổi tài khoản khi request cũ còn chạy, refresh token đồng thời, khôi phục offline, autosave và thử lại khi có mạng.
- API/database thật: PostgreSQL 16 và Redis 7 riêng cho test; áp dụng đủ 19 file SQL migration trên database dùng một lần. Seed và import giáo trình có kiểm thử giữ nguyên chỉnh sửa/quyền đã thu hồi.
- Trình duyệt với API thật: đăng ký, xác minh email, chặn ghi khi chưa xác minh; nhật ký được lưu PostgreSQL; tải lại/đăng xuất/đổi hai tài khoản; nhận cùng nhật ký từ trình duyệt điện thoại mới; khóa thuộc tính không cho phép và khóa chủ sở hữu; revision xung đột giữ bản nháp và yêu cầu chọn bản dữ liệu.
- Quản lí: quyền SYSTEM chỉ được gán trong fixture database riêng để kiểm tra. Dashboard, người dùng, audit và thống kê tự học đọc dữ liệu thật; nhật ký riêng không xuất hiện. Thu hồi quyền khiến giao diện ẩn quản lí và API trả 403 ngay. Quyền fixture đã được thu hồi sau test.
- Docker: build thành công image Node 22; API chạy bằng image với PostgreSQL/Redis và tài khoản không phải root. Bộ 7 luồng account/database cũng qua trên API trong container. Compose được kiểm tra cấu hình.
- Nhiều tab: các sửa đổi khác trường/bài được gộp; sửa đè cùng trường dừng lại, giữ và xuất được bản nháp. Kiểm thử Chromium có cả vùng khách và tài khoản.
- Bảo toàn chức năng: `guided-learning-smoke` qua với đủ 30 bài, nhật ký, điều kiện hoàn thành, sao lưu, desktop/điện thoại; `tutor-images-smoke` qua với tải/dán/chụp/cắt ảnh và thao tác cảm ứng. Nội dung 5 khóa, 30 bài và 5 PDF khớp nguồn.

Không có lỗi JavaScript không được xử lí trong các luồng trình duyệt trên. Các API ngoài được chặn/giả lập trong test; không gọi AI trả phí.

## Phạm vi triển khai và kiểm tra còn lại

GitHub Pages chỉ phục vụ frontend. Ngày 16/11, dashboard Render do người vận hành gửi đã hiển thị `e06a726` Live tại `https://strobot-backend.onrender.com`. Frontend đã cấu hình `/api` của dịch vụ này; các kiểm tra AccountService, chờ cold start, learner sync, tutor, dashboard và thiết lập AI qua sau thay đổi. Localhost vẫn chọn API local, không tự gửi dữ liệu phát triển vào database công khai.

Môi trường kiểm tra bị proxy chặn kết nối tới URL Render (CONNECT 403); chưa kiểm tra trực tiếp được readiness, CORS, đăng nhập hay đồng bộ trên dịch vụ thật. Người vận hành cần đăng nhập trên GitHub Pages, xác nhận lưu/đọc tiến độ, xóa ba biến khởi tạo admin sau lần tạo thành công, rồi cấu hình provider/model AI riêng. Chế độ tài khoản nội bộ đang dùng không cần SMTP; AI Tutor cũ giữ endpoint hiện tại.

Migration engine native của Prisma bị chặn tải trong môi trường cloud này. Kiểm tra local áp dụng nguyên SQL lên PostgreSQL qua helper chỉ chấp nhận database test ở loopback; workflow GitHub bổ sung chạy `npm run db:migrate` chuẩn để kiểm tra migration khi có quyền tải engine. Không gọi helper fixture để nâng cấp database production.

Sau cập nhật dependencies, `npm audit --omit=dev` báo **0 critical, 0 high, 7 moderate** còn thuộc các gói NestJS. Chúng cần đánh giá/nâng phiên bản framework riêng; kết quả này không đồng nghĩa toàn bộ phần mềm đã được kiểm toán bảo mật. Khóa gói tại `backend/package-lock.json`; không sử dụng bản sanitizer cũ để né lỗi ESM trong test.

Các sự kiện hoạt động rời rạc gửi khi online; tiến độ/nhật ký có hàng đợi offline. Dữ liệu tự học đồng bộ được gắn nguồn `learner-self-report`, tách với điểm được server chấm. Báo cáo đánh giá pre/post dùng chung trên trình duyệt không tự đưa lên tài khoản cá nhân.

Xem [thiết lập backend](backend-deployment.md) và [agent](backend-agent.md) để triển khai.
