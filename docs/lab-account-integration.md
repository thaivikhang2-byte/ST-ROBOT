# Tài khoản và cách lưu bài thực hành

Học sinh đăng nhập ST-Robot, mở bài rồi chọn **Thực hành → Lưu bài**. Bài làm được lưu riêng theo tài khoản, khóa học, bài học và nền tảng. Chỉ chuyển thiết bị khi thấy **Đã đồng bộ bài làm vào tài khoản**. Thông báo giữ bản nháp trên thiết bị chưa có nghĩa là máy chủ đã nhận bài.

Sau khi đăng xuất, phần bài làm cá nhân được xóa khỏi màn hình và khóa thao tác lưu, kể cả tệp đang đọc dở. Bản trên máy chủ được giữ nguyên. Các tab cùng phiên trong trình duyệt nhận thông báo đăng xuất; thiết bị độc lập vẫn dùng được. Bài khách đã có được giữ riêng, không tự nhập vào tài khoản khác.

## Lưu và mở lại theo nền tảng

| Nền tảng | Cần lưu | Cách tiếp tục |
| --- | --- | --- |
| CircuitJS | Tệp mạch `.txt` từ **File → Save As…**, hoặc văn bản từ **Export As Text…** | Tải tệp ở ST-Robot rồi dùng **File → Open File…**; văn bản dùng **Import From Text…** |
| AVR8js | Bản sketch Arduino C++ hoặc tệp `.ino`; ghi các tham số và nhịp LED | Dừng chương trình, thay sketch bằng bản đã lưu rồi Run |
| Wokwi | Liên kết dự án của chính học sinh; nên giữ thêm `sketch.ino`, `diagram.json` và tệp phụ | Mở liên kết bằng tài khoản Wokwi sở hữu dự án, hoặc đưa các tệp vào dự án Uno mới |
| micro:bit Python | Editor nhúng tự lưu toàn bộ dự án qua bridge theo bài/tài khoản; có thể giữ thêm bản `main.py` hoặc tệp xuất | Editor nhúng nạp dự án của bài; bản `.py` riêng chỉ giữ mã chính, không thay toàn bộ dự án nhiều tệp |
| GearsBot | **File → Export zip package to your computer**; nếu chỉnh sân, lưu thêm **Worlds → Save to file** | Import ZIP bằng menu File; mở tệp sân JSON bằng **Worlds → Load from file**. ZIP chương trình không chứa sân |
| PhET | Phiếu ghi cách mắc mạch, giá trị và số đo | Dựng lại mạch theo phiếu; ST-Robot không khôi phục bố trí mạch PhET |
| Bàn mô hình trong bài | Phiếu đầu vào/kết quả; nút **Nhận kết quả từ bàn thực hành** điền kết quả đã chạy | Nhập lại các đầu vào trong phiếu; không xem phiếu là ảnh chụp toàn bộ trạng thái mô hình |

Trong mỗi nền tảng có hướng dẫn lưu và phần **Mở lại bài trên nền tảng này**. **Bản sao mã nguồn** là phần tùy chọn: sửa ô này không sửa tệp dự án đã đính kèm. Sau khi thay đổi trong editor, xuất và thêm lại tệp để giữ phiên bản mới. **Xem bản đã lưu** nạp lại các ô của ST-Robot, không điều khiển editor ngoài.

GearsBot có thể giữ dự án trước đó trong bộ nhớ riêng của trình duyệt. Đăng xuất ST-Robot không xóa bộ nhớ khác miền này. Khi dùng máy chung, luôn mở tệp của mình trước khi chạy. Các nền tảng ngoài có tài khoản và quyền chia sẻ riêng; ST-Robot không dùng mật khẩu học sinh để đăng nhập thay hay giả lập SSO. Liên kết được giữ riêng trong ST-Robot không làm dự án chia sẻ ở nền tảng ngoài trở thành riêng tư.

Scratch và Arcade đã được bỏ khỏi lựa chọn vì các khung cũ chỉ chạy dự án mẫu. Bài cũ của hai nền tảng được giữ trong dữ liệu và hồ sơ sao lưu, không bị xóa khi đổi menu. Tải hồ sơ ở **Kiểm tra → Sao lưu hoặc khôi phục hồ sơ khóa học**.

## Dữ liệu và quyền truy cập

Dùng khóa đồng bộ hiện có `strobot.original.course.v3`, tại `[courseId][lessonId].labWork[platformKey]`. Server xác định chủ sở hữu từ phiên đăng nhập. Không thêm bảng hoặc migration.

- Phiên bản 1 giữ nguyên các trường `version`, `savedAt`, `code`, `notes`, `projectUrl`, `fileName`.
- Phiên bản 2 thêm `files:[{name,dataBase64}]`. Tối đa bốn tệp, tổng byte giải mã 256 KiB; phần mở rộng kiểm tra theo nền tảng. Tên chỉ là tên tệp, không có đường dẫn. Từ chối trường lạ, tên trùng không phân biệt hoa/thường và base64 không chuẩn.
- Tệp được giữ nguyên byte, không giải nén, không thực thi hoặc nhúng HTML; tải về bằng kiểu `application/octet-stream`.
- Mã UTF-8 tối đa 32 KiB; ghi chú 2.000 ký tự; URL HTTPS 2.048 ký tự không chứa thông tin đăng nhập; tên tệp 120 ký tự.
- Tổng trạng thái khóa học vẫn 5 MiB; snapshot đồng bộ 8 MiB. Các tệp hợp lệ riêng lẻ vẫn có thể vượt hạn mức chung. Không tự tăng quota hoặc cắt mất nội dung.
- Báo cáo quản trị chỉ có tiến độ tổng hợp, không có mã, ghi chú, tên hoặc byte tệp. AI của người học chỉ nhận bản mã/ghi chú đã giới hạn ở đúng bài/nền tảng; backend có thể cung cấp tên/số lượng tệp, không đọc/gửi byte tệp sang AI. Chuỗi giống khóa/mật khẩu được che trước khi đưa vào ngữ cảnh.
- Mất mạng giữ bản nháp theo tài khoản. Xung đột yêu cầu chọn bản, không ghi đè ngầm. Restore/xóa tệp, đổi bài, đổi tài khoản và đăng xuất vô hiệu hóa thao tác nhập tệp cũ đang đọc dở.

## Kiểm chứng và triển khai

`tests/lab-native-files.mjs` kiểm tra byte, kiểu tệp, giới hạn, backup cũ và dữ liệu AI. `tests/lab-workspace-smoke.py` kiểm tra thao tác thật, tải ZIP nguyên byte, reload, nhập tệp chậm, đổi chủ và đăng xuất. `tests/product-journey-smoke.py` dùng PostgreSQL/Redis thử nghiệm để xác nhận tệp Wokwi, tiến độ, nhật ký và mã của cùng học sinh xuất hiện trên thiết bị thứ hai; tài khoản khác không đọc được.

Backend phải được triển khai cùng frontend mới để chấp nhận schema phiên bản 2. Trên Render, nếu Auto-Deploy tắt, chọn **strobot-backend → Manual Deploy → Deploy latest commit**, chờ **Live** rồi tải lại website. Không cần tạo lại database, admin hoặc nhập lại khóa AI. Kiểm thử cục bộ không xác nhận tình trạng trực tiếp của nhà cung cấp lab/AI.
