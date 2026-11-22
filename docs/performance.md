# Tốc độ mở trang, đăng nhập và thao tác

Bản tối ưu ngày 21/11/2026 giữ giao diện, luồng duyệt học sinh, quyền quản trị và cách lưu bài theo tài khoản. Không đổi nhà cung cấp AI, mật khẩu, database hay gói Render.

## Thay đổi

- Sau khi trang thực sự hiển thị, web chuẩn bị một kết nối tài khoản ở nền trong lúc người dùng đọc. Tab đang ẩn chưa gọi máy chủ; rời trang sẽ hủy phần chờ của tab đó. Không có vòng lặp ping giữ máy chủ thức và không tự gửi lại yêu cầu đăng nhập/đăng ký.
- Mỗi trang chỉ tải controller cần dùng. Trong kiểm thử Chromium trang tài khoản, số module JavaScript tải giảm từ 62 xuống 45, tránh tải 105.750 byte mã đã giải nén. Đây là số đo mã JavaScript ở fixture, không phải toàn bộ dung lượng trang hoặc thời gian mạng trên Render.
- Việc khôi phục cùng phiên và nhận cấu hình đăng ký không tải lặp danh sách học sinh. Trong fixture có độ trễ, bốn lần đọc trùng giảm còn một. Kết quả chỉ dùng trong cùng phiên/quyền, có thời hạn ngắn; đổi người dùng, đăng xuất, mất quyền hoặc chế độ offline sẽ hủy dữ liệu đang chờ và xóa phần xem cũ. Làm mới hay ghi thay đổi vẫn yêu cầu kết quả mới.
- Trước khi hỏi agent, web gửi phần học tập còn chưa đồng bộ. Nếu bản trên máy đã sạch, không tải lại toàn bộ snapshot chỉ để bắt đầu câu hỏi. Agent vẫn đọc dữ liệu thuộc tài khoản từ server; nút Đồng bộ và thao tác mở lại hồ sơ vẫn nhận dữ liệu mới từ thiết bị khác.
- Lưu bài kiểm tra dung lượng trên một lần đọc hồ sơ. Fixture 2,4 MB xác nhận một lần đọc envelope và một lần ghi; không phân tích lại hồ sơ cho từng mục lưu trữ. Giới hạn 5 MiB khóa học, 8 MiB snapshot, kiểm tra sau khi hợp nhất dữ liệu giữa tab và bảo toàn bản cũ khi lỗi vẫn được giữ.
- Trình duyệt có thể nhớ chính sách CORS preflight hợp lệ trong 600 giây để giảm lượt OPTIONS lặp. HTTP response của dữ liệu tài khoản vẫn không được cache; session, quyền và thu hồi phiên vẫn được kiểm tra trên từng yêu cầu API.

## Giới hạn của Render Free

Khi backend ngủ sau thời gian không dùng, lần mở lại vẫn phải chờ Render khởi động. Chuẩn bị kết nối sớm giúp giấu một phần thời gian chờ nếu người dùng đọc trang trước khi đăng nhập; mở thẳng bookmark trang tài khoản vẫn có thể gặp thời gian thức máy đó. Fixture mô phỏng xác minh cách xếp yêu cầu, không chứng minh độ trễ của dịch vụ công khai.

Muốn tránh hẳn thời gian thức máy cần backend luôn hoạt động. Đó là lựa chọn hạ tầng riêng; bản cập nhật này không mua hoặc nâng gói. Không cần nhập lại API key hay tạo lại tài khoản. Để áp dụng phần CORS, backend cần triển khai commit mới như frontend.

## Kiểm thử

`node tests/account-connection-warmup.mjs`, `node tests/router-loading.mjs`, `node tests/learner-sync.mjs` và các kiểm tra tài khoản hiện có xác minh lịch kết nối, hủy chờ, phiên, không gửi lặp POST, cách ly tài khoản, giới hạn dung lượng và đồng bộ.

`tests/account-performance-smoke.py` kiểm tra yêu cầu lặp với API giả lập có độ trễ, đọc cũ trong lúc ghi, làm mới bắt buộc và đổi phiên. `tests/route-loading-smoke.py` kiểm tra các trang cùng việc khôi phục đúng tài khoản trước khi chạy quiz. `tests/product-journey-smoke.py` dùng PostgreSQL/Redis riêng để kiểm tra lại đăng ký, duyệt, lưu bài, đổi thiết bị và đăng xuất nhiều tab. Các kiểm thử không gọi nhà cung cấp AI thật hoặc dùng dữ liệu production.

## Khi đăng nhập vẫn mất nhiều giây

Từ bản `timing-v1`, trang tài khoản giữ số đo của lần đăng nhập trong bộ nhớ tab. Mục **Chi tiết thời gian đăng nhập** xuất hiện khi chờ ít nhất tám giây hoặc gặp lỗi kết nối/máy chủ. Đường dẫn `account.html?diagnostics=login` cho phép chủ động xem số đo kể cả khi đăng nhập nhanh. Mở mục đó rồi bấm **Sao chép chi tiết** để lấy báo cáo.

`connectionMs` là thời gian lần đăng nhập chờ kết nối sẵn sàng; `authenticationMs` là thời gian yêu cầu xác thực và đọc JSON; `clientMs` là phần xử lý trình duyệt còn lại; `totalMs` là tổng thời gian. Báo cáo chỉ chứa các thời lượng, trạng thái, mã lỗi giới hạn và mã yêu cầu UUID hợp lệ nếu server trả về. Không chứa email, mật khẩu, ID người dùng, token, header, nội dung bài học hay thông báo lỗi thô. Đây là số đo chờ ở trình duyệt, không phải các pha SQL/bcrypt của server.

Kết nối chậm và xác thực chậm cần được phân biệt bằng số đo thực tế. Không thể suy ra nguyên nhân của mọi lần đăng nhập từ các kiểm thử local. Khi có `requestId`, quản trị viên có thể mở **strobot-backend → Logs** trên Render và tìm đúng mã đó. Backend giữ log HTTP thành công từ một giây trở lên thay vì bỏ qua do lấy mẫu; các trường vẫn giới hạn ở method, mẫu route, trạng thái, thời gian và mã đối chiếu. Thay đổi này không rút ngắn timeout, bỏ xác thực, đổi phí hay khẳng định đã giải quyết độ trễ production.
