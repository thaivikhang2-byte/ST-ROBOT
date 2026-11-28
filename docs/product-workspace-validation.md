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

## Kiểm chứng phần lab và tệp dự án — 25/11/2026

- Backend build/typecheck và toàn bộ 45 bộ Jest: 357 kiểm thử đạt; sáu kiểm thử Redis tùy chọn không chạy trong lượt này. Sau khi chỉnh câu chữ hướng dẫn, ba bộ liên quan được chạy lại: 32 kiểm thử đạt.
- Schema native v2 giữ nguyên bản v1, các bài Scratch/Arcade cũ, quota 5 MiB/8 MiB và quyền chủ tài khoản. Kiểm tra tên, phần mở rộng, canonical base64, byte thực và tổng 256 KiB đạt; không giải nén hay gửi tệp sang AI.
- Hướng dẫn theo nền tảng: 78 hoạt động, 234 mức giải thích; cú pháp Python và sáu sketch AVR biên dịch/chạy đạt. Menu lưu GearsBot và CircuitJS được đối chiếu với mã nguồn chính thức.
- Browser UI: 15 nhóm đạt, 30 bài, 78 hướng dẫn, 37 mẫu mã hiển thị/sao chép; không có lỗi JavaScript. Wokwi mở editor khi chủ động bấm, iframe CircuitJS tải lại được khi lỗi, bố cục điện thoại không tràn ngang.
- Guided learning: đủ 30 mô hình có thao tác thật, không tự sinh minh chứng khi mở bài; kiểm tra dự đoán, đổi đầu vào, điều kiện hoàn thành, tải/khôi phục hồ sơ và dữ liệu cũ đạt.
- Lab workspace: tải ZIP nguyên byte, reload, nhập tệp quá giới hạn, khôi phục/xóa tệp khi còn lượt đọc chậm, đổi tài khoản và đăng xuất đều được kiểm tra. Ảnh desktop/mobile được xem lại trực tiếp.
- Hành trình PostgreSQL/Redis: chín nhóm đạt. Tệp `sketch.ino` và `diagram.json` cùng bài làm đi qua database; thiết bị thứ hai tải được `diagram.json` nguyên byte. Đăng xuất xóa tệp khỏi giao diện và không gửi yêu cầu ghi muộn; học sinh khác không có tệp. Báo cáo admin không chứa nội dung riêng.

Các kiểm thử dùng database riêng và phản hồi provider giả lập, không gọi sinh nội dung AI trả phí. Không kiểm chứng trực tiếp uptime, header iframe hoặc simulator ở các tên miền ngoài do chính sách mạng của môi trường. Bridge micro:bit được kiểm tra bằng bộ giao thức hiện có; không chạy lại editor upstream thực trong đợt này. Kết quả không thay cho thử nghiệm trên phần cứng hoặc đánh giá của giám khảo.

## Kho tệp và xem bài đã lưu — 26/11/2026

Tệp mới nhận mọi định dạng, tối đa 25 MiB/tệp và 250 MiB/tài khoản, 50 tệp cho một bài/nền tảng. Chúng nằm trong bảng PostgreSQL riêng, truyền theo khối 1 MiB; không nới hoặc làm nặng snapshot tiến độ. V1/v2 cũ được giữ nguyên. Migration chỉ bổ sung bảng/chỉ mục/ràng buộc và được áp dụng khi startup.

- Ba bộ backend mới có 52 kiểm thử đạt: phiên/quyền hiện tại, chủ sở hữu, quota gồm giữ chỗ, giới hạn parser, thử lại idempotent, tệp rỗng, hoàn tất thiếu byte, hết hạn và xóa. Tài khoản khác không GET/xóa tệp theo ID được.
- Node file-store và browser workspace/viewer đạt: ảnh PNG, định dạng lạ hơn 256 KiB, tệp không có phần mở rộng, văn bản/PDF, HTML không chạy mã, tải nguyên byte, hủy/đổi lựa chọn và đăng xuất đóng ảnh. Trình xem tải một tệp được chọn, không tải nội dung toàn danh sách.
- Hành trình PostgreSQL/Redis chín nhóm đạt sau migration mới: bốn tệp gồm PNG và tệp lạ lớn hơn 1 MiB lưu qua database; thiết bị thứ hai xem ảnh/tải đúng byte. Snapshot học tập không chứa các tệp mới. Dữ liệu và quyền học sinh/admin trước đó tiếp tục hoạt động.
- Khi tiếp tục sau ngắt kết nối: build/typecheck đạt; toàn bộ 48 bộ Jest đạt với 409 kiểm thử, sáu kiểm thử Redis tùy chọn được bỏ qua. Các bộ Node file-store, native v2 cũ, portfolio và ngữ cảnh tutor cũng đạt. Không khởi động server thường trực để kiểm tra lại.

Lượt tải đã tạo thành công nhưng mất phản hồi trước khi client nhận ID có thể giữ quota đến lần dọn sau 24 giờ. Tệp đã hoàn tất và ghi chú không bị thay đổi. Chi tiết dung lượng, cách xem lại và phạm vi sao lưu ở [hướng dẫn lưu bài](lab-account-integration.md).

## Tiết kiệm credit và ngân sách AI — 28/11/2026

Thêm chế độ tiết kiệm mặc định: tối đa hai dispatch/provider cho một câu hỏi agent, một lần thử mỗi lượt, không tự đổi provider khi lỗi; đầu ra 700 token. Lịch sử giữ hai lượt cũ theo nhóm đầy đủ và byte budget, giữ chữ ký tool. Ngữ cảnh tài khoản được rút gọn nhưng mã/ghi chú bài đang chọn vẫn được giữ. Giá định tuyến xét cả đầu vào/đầu ra đã xác nhận trong cùng provider.

Chính sách USD là lựa chọn riêng, chưa tự bật trên production: admin cần nhập đúng giá Woku và xác nhận. Preset một USD, 0,03 USD/ngày trước thi và 0,40 USD dành từ 00:00 ngày 12/12 giờ Việt Nam. Mọi tài khoản dùng chung trần; dự toán trước dispatch được giữ dưới khóa database. Các lượt thiếu usage hoặc reservation hết hạn không tự trở thành miễn phí.

- Build/typecheck đạt; toàn bộ 50 bộ Jest đạt với 455 kiểm thử, sáu kiểm thử Redis tùy chọn được bỏ qua. Bộ giới hạn agent xác nhận tối đa hai dispatch và lỗi provider không tự gọi lại; lịch sử chữ ký/JSON, quyền và model scope được giữ.
- Bộ spending kiểm tra giá chưa xác nhận, quota tổng/ngày, giờ Việt Nam, dự phòng ngày thi, CAS, TLS, quyền hiện tại và usage chưa rõ. Chi phí rất nhỏ được trả bằng chuỗi thập phân để nhập lại cấu hình an toàn.
- `tests/ai-spending-pg.cjs` đạt sáu nhóm trên PostgreSQL thật, dùng hai kết nối tranh quota để xác nhận chỉ một lượt được nhận ở sát giới hạn. SQL trả đúng Decimal/bigint, khóa giữ chỗ và mốc dự phòng hoạt động. Database ngẫu nhiên thử riêng đã được dọn.
- Các kiểm thử legacy xác nhận mặc định không sinh nội dung, khách cần đăng nhập, ảnh không chuyển sang kênh ngoài ngân sách trong chế độ tiết kiệm. Chỉ explicit opt-in mới mở legacy. Ảnh không bị tự bỏ để trả lời như đã xem.
- Hành trình PostgreSQL/Chromium chín nhóm được chạy lại sau migration ngân sách: đăng ký/duyệt, AI metadata, lưu/tải tệp đa thiết bị, đăng xuất và cách ly tài khoản tiếp tục đạt; không phát sinh request sinh nội dung provider.

Các kiểm tra không xác minh khóa hoặc số dư Woku thật. Danh sách key trống cần shop đối soát; không tự kết luận đã hết credit hoặc tự nạp tiền. Xem [cách cấu hình ngân sách và phạm vi bảo vệ](ai-spending.md).

## Triển khai và sử dụng

Backend Render giữ Root Directory `backend`, build `npm ci --include=dev && npm run prisma:generate && npm run build`, start `npm run start:production`. Startup tự áp dụng migration bổ sung cờ chờ duyệt, giữ dữ liệu tài khoản cũ. Với `MANAGED_ACCOUNTS_ENABLED=true`, luồng học sinh chờ duyệt mặc định được bật; không cần nhập lại khóa AI hay tạo lại admin. GitHub Pages phục vụ frontend mới từ cùng nhánh chính. Nếu Auto-Deploy bị tắt, chọn **strobot-backend → Manual Deploy → Deploy latest commit** rồi chờ Live. Backend và frontend phải cùng cập nhật trước khi kiểm tra đăng ký mới.

Học sinh chọn **Đăng nhập → Tạo tài khoản**, chờ duyệt rồi đăng nhập để học. Admin chọn **Học viên → Chờ duyệt → Duyệt học sinh**. Bài học gần nhất và tiến độ nằm ở **Việc học của tôi**; bài lab có **3. Lưu bài thực hành**. Chờ thông báo đã đồng bộ trước khi chuyển máy.

Render Free vẫn có thời gian thức dậy sau khi ngủ. Các thay đổi giảm chờ thừa trong ứng dụng, không tạo cam kết backend luôn sẵn sàng. Để trình diễn ít rủi ro hơn, mở thử đăng nhập và agent trước buổi thi; triển khai backend luôn chạy là lựa chọn hạ tầng riêng, không được tự mua hoặc nâng gói trong lần cập nhật này. Database miễn phí của bản Render đã tạo có ngày hết hạn hiển thị 15/12/2026; phải xuất dữ liệu hoặc chuyển/nâng database trước ngày đó nếu tiếp tục sử dụng.

Tài khoản nền tảng lab ngoài chưa có SSO chung. Bản mã/ghi chú/liên kết trong ST-Robot được đồng bộ theo tài khoản; dự án ngoài tuân theo cơ chế lưu và quyền riêng tư của nhà cung cấp. Xem [phạm vi tích hợp từng nền tảng](lab-account-integration.md).
