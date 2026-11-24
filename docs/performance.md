# Tốc độ mở trang, đăng nhập và thao tác

Bản tối ưu ngày 21/11/2026 giữ giao diện, luồng duyệt học sinh, quyền quản trị và cách lưu bài theo tài khoản. Không đổi nhà cung cấp AI, mật khẩu, database hay gói Render.

## Thay đổi

- Sau khi trang thực sự hiển thị, web chuẩn bị một kết nối tài khoản ở nền trong lúc người dùng đọc. Tab đang ẩn chưa gọi máy chủ; rời trang sẽ hủy phần chờ của tab đó. Không có vòng lặp ping giữ máy chủ thức và không tự gửi lại yêu cầu đăng nhập/đăng ký.
- Mỗi trang chỉ tải controller cần dùng. Trong kiểm thử Chromium trang tài khoản, số module JavaScript tải giảm từ 62 xuống 45, tránh tải 105.750 byte mã đã giải nén. Đây là số đo mã JavaScript ở fixture, không phải toàn bộ dung lượng trang hoặc thời gian mạng trên Render.
- Việc khôi phục cùng phiên và nhận cấu hình đăng ký không tải lặp danh sách học sinh. Trong fixture có độ trễ, bốn lần đọc trùng giảm còn một. Kết quả chỉ dùng trong cùng phiên/quyền, có thời hạn ngắn; đổi người dùng, đăng xuất, mất quyền hoặc chế độ offline sẽ hủy dữ liệu đang chờ và xóa phần xem cũ. Làm mới hay ghi thay đổi vẫn yêu cầu kết quả mới.
- Trước khi hỏi agent, web gửi phần học tập còn chưa đồng bộ. Nếu bản trên máy đã sạch, không tải lại toàn bộ snapshot chỉ để bắt đầu câu hỏi. Agent vẫn đọc dữ liệu thuộc tài khoản từ server; nút Đồng bộ và thao tác mở lại hồ sơ vẫn nhận dữ liệu mới từ thiết bị khác.
- Lưu bài kiểm tra dung lượng trên một lần đọc hồ sơ. Fixture 2,4 MB xác nhận một lần đọc envelope và một lần ghi; không phân tích lại hồ sơ cho từng mục lưu trữ. Giới hạn 5 MiB khóa học, 8 MiB snapshot, kiểm tra sau khi hợp nhất dữ liệu giữa tab và bảo toàn bản cũ khi lỗi vẫn được giữ.
- Trình duyệt có thể nhớ chính sách CORS preflight hợp lệ trong 600 giây để giảm lượt OPTIONS lặp. HTTP response của dữ liệu tài khoản vẫn không được cache; session, quyền và thu hồi phiên vẫn được kiểm tra trên từng yêu cầu API.

## Xác thực mật khẩu ngày 24/11/2026

Mật khẩu mới dùng Argon2id v19 với 64 MiB bộ nhớ, ba vòng, một luồng và salt ngẫu nhiên 16 byte. Backend giới hạn tối đa hai tác vụ Argon cùng lúc. Mật khẩu bcrypt đã lưu vẫn được kiểm tra theo chi phí cũ; không giảm số vòng bcrypt. Đăng nhập thành công chuyển hash cũ sang định dạng mới trong lần cập nhật thời điểm đăng nhập, giữ nguyên mật khẩu người dùng, phiên và phiên bản xác thực. Lần chuyển đầu tiên vẫn phải làm cả công việc cũ và mới; lợi ích tốc độ áp dụng ở những lần đăng nhập sau. Ứng viên mật khẩu vượt 72 byte UTF-8 không tự chuyển vì bcrypt vốn cắt đầu vào ở mức đó.

Phép kiểm tra và tạo hash chạy ngoài khóa hàng database. Trước khi cấp phiên, transaction vẫn đọc lại hash, phiên bản xác thực, trạng thái chờ duyệt/khóa/xóa và quyền mới nhất. Hai lần đăng nhập chuyển hash đồng thời chỉ được thử lại một lần với hash mới, kiểm tra mật khẩu lại ngoài transaction. Đổi mật khẩu hoặc thu hồi phiên đồng thời vẫn làm lần đăng nhập cũ thất bại. Các nhánh sai mật khẩu và không có tài khoản đều thực hiện ngân sách hai thuật toán, không thêm thời gian chờ cố định vào đăng nhập thành công.

Prisma 6.19 bật `relationJoins` để lấy đồ thị quyền bằng truy vấn gộp. Fixture PostgreSQL đếm tại driver, gồm transaction, cho đăng nhập giảm từ 15 xuống tám câu lệnh; kiểm tra JWT giảm từ chín xuống một. Payload/quyền tương đương và khóa cập nhật vẫn chặn người ghi đồng thời; không thêm Prisma client hoặc connection pool thứ hai. Đây là tính năng preview nên cần chạy đầy đủ kiểm thử backend cùng hành trình PostgreSQL trước khi nâng Prisma sau này.

Khi triển khai, giữ nguyên các biến môi trường, tài khoản, dữ liệu và cấu hình AI. `npm ci --include=dev` cài binding native của `@node-rs/argon2` đã khóa phiên bản 2.2.2; không bỏ optional dependencies. Build phải chạy lại `npm run prisma:generate`. Sau khi có hash Argon, bản dùng để rollback phải hỗ trợ cả Argon và bcrypt; quay về mã chỉ hiểu bcrypt sẽ khiến tài khoản đã chuyển không đăng nhập được.

### Số đo của bản xác thực

Docker giới hạn thực `cpu.max=10000 100000`, bộ nhớ 512 MiB, Node 22.23.5, ứng dụng Nest/Prisma/queue đầy đủ và PostgreSQL/Redis dùng riêng. Mẫu so sánh bcrypt là tài khoản giữ hash cũ vì ứng viên dài hơn 72 byte; các mẫu Argon dùng cùng ứng dụng và đồ thị quyền mới. Không gọi nhà cung cấp AI.

| Phép đo | Kết quả |
| --- | --- |
| Đăng nhập bcrypt chưa chuyển, sau mẫu JIT đầu | 2.797–3.000 ms |
| Đăng nhập sau chuyển Argon, bốn mẫu | 798–1.098 ms; trung vị 902 ms |
| Tài khoản Argon mới, bốn mẫu | 806–996 ms; trung vị 899 ms |
| Đăng nhập qua HTTP đầy đủ | 200; 1.095 ms |
| Lần đầu kiểm tra bcrypt và chuyển hash | 3.201 ms |
| Hai đăng nhập đồng thời chia sẻ 0,1 CPU | Cả hai thành công; 2.106/2.605 ms |
| RSS cao nhất toàn tiến trình, gồm hai tác vụ Argon đồng thời | 290,9 MiB; không OOM |

Mẫu bcrypt đầu tiên mất 4.003 ms do ứng dụng chưa làm nóng; không dùng mẫu này để quảng bá tốc độ ổn định. Các số đo local trên giới hạn tài nguyên tương đương gói Free không bao gồm mạng Internet và thời gian Render thức máy. Chúng không phải số đo website production hay cam kết mọi lượt đăng nhập đều dưới một giây.

## Giới hạn của Render Free

Khi backend ngủ sau thời gian không dùng, lần mở lại vẫn phải chờ Render khởi động. Chuẩn bị kết nối sớm giúp giấu một phần thời gian chờ nếu người dùng đọc trang trước khi đăng nhập; mở thẳng bookmark trang tài khoản vẫn có thể gặp thời gian thức máy đó. Fixture mô phỏng xác minh cách xếp yêu cầu, không chứng minh độ trễ của dịch vụ công khai.

Muốn tránh hẳn thời gian thức máy cần backend luôn hoạt động. Đó là lựa chọn hạ tầng riêng; bản cập nhật này không mua hoặc nâng gói. Không cần nhập lại API key hay tạo lại tài khoản. Để áp dụng phần CORS, backend cần triển khai commit mới như frontend.

## Kiểm thử

`node tests/account-connection-warmup.mjs`, `node tests/router-loading.mjs`, `node tests/learner-sync.mjs` và các kiểm tra tài khoản hiện có xác minh lịch kết nối, hủy chờ, phiên, không gửi lặp POST, cách ly tài khoản, giới hạn dung lượng và đồng bộ.

`tests/account-performance-smoke.py` kiểm tra yêu cầu lặp với API giả lập có độ trễ, đọc cũ trong lúc ghi, làm mới bắt buộc và đổi phiên. `tests/route-loading-smoke.py` kiểm tra các trang cùng việc khôi phục đúng tài khoản trước khi chạy quiz. `tests/product-journey-smoke.py` dùng PostgreSQL/Redis riêng để kiểm tra lại đăng ký, duyệt, lưu bài, đổi thiết bị và đăng xuất nhiều tab. Các kiểm thử không gọi nhà cung cấp AI thật hoặc dùng dữ liệu production.

`node tests/auth-upgrade-pg.cjs --env-file /private/disposable-test-env.json` kiểm tra native bcrypt/Argon và tám nhóm PostgreSQL: payload quyền gộp, chuyển hash giữ phiên, hai lần đăng nhập đồng thời, reset ở hai điểm đua, biên UTF-8, trạng thái/quyền mới nhất và từ chối chung. Tệp JSON chỉ cần `NODE_ENV=test` và `DATABASE_URL` loopback có quyền tạo database; fixture chỉ tạo/xóa database ngẫu nhiên của chính nó. CI chạy kiểm tra này trước hành trình học tập. Kết quả không in thông tin kết nối, hash, mật khẩu hay token.

## Theo dõi hiệu năng khi bảo trì

Trang tài khoản không hiển thị bảng chi tiết thời gian, nút sao chép báo cáo hay bộ đếm giây. Đường dẫn có tham số chẩn đoán cũ cũng mở cùng giao diện đăng nhập gọn.

Kiểm thử nội bộ vẫn phân biệt thời gian chờ kết nối, yêu cầu xác thực và xử lý trình duyệt. Backend giữ log HTTP thành công từ một giây trở lên với các trường giới hạn ở method, mẫu route, trạng thái, thời gian và mã đối chiếu. Các phép đo nội bộ không chứa thông tin đăng nhập hay nội dung học tập và không phải bằng chứng đã giải quyết độ trễ production.
