# Tài khoản và cách lưu bài thực hành

Học sinh đăng nhập ST-Robot, mở bài rồi chọn **Thực hành → Lưu bài**. Bài làm được lưu riêng theo tài khoản, khóa học, bài học và nền tảng. Tệp được lưu ngay khi tải lên hoàn tất và hiện **Đã lưu … tệp vào tài khoản**. Nút **Lưu bài thực hành** lưu ghi chú, liên kết và bản mã; các mục này cần báo **Đã đồng bộ bài làm vào tài khoản** trước khi chuyển thiết bị. Thông báo giữ bản nháp trên thiết bị chưa có nghĩa là máy chủ đã nhận bài.

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

Trong mỗi nền tảng có hướng dẫn lưu và phần **Mở lại bài trên nền tảng này**. **Bản sao mã nguồn** là phần tùy chọn: sửa ô này không sửa tệp dự án đã đính kèm. Sau khi thay đổi trong editor, xuất và thêm lại tệp để giữ phiên bản mới. **Xem bản đã lưu** mở danh sách tệp của bài/nền tảng đang chọn. Chọn tệp để xem ảnh, PDF hoặc văn bản; Word, video, tệp nén và định dạng chưa xem trực tiếp được có nút tải nguyên bản. Ghi chú/bản mã đã lưu nằm ở một phần riêng. Mở danh sách không thay nội dung đang nhập và không điều khiển editor ngoài.

GearsBot có thể giữ dự án trước đó trong bộ nhớ riêng của trình duyệt. Đăng xuất ST-Robot không xóa bộ nhớ khác miền này. Khi dùng máy chung, luôn mở tệp của mình trước khi chạy. Các nền tảng ngoài có tài khoản và quyền chia sẻ riêng; ST-Robot không dùng mật khẩu học sinh để đăng nhập thay hay giả lập SSO. Liên kết được giữ riêng trong ST-Robot không làm dự án chia sẻ ở nền tảng ngoài trở thành riêng tư.

Scratch và Arcade đã được bỏ khỏi lựa chọn vì các khung cũ chỉ chạy dự án mẫu. Bài cũ của hai nền tảng được giữ trong dữ liệu và hồ sơ sao lưu, không bị xóa khi đổi menu. Tải hồ sơ ở **Kiểm tra → Sao lưu hoặc khôi phục hồ sơ khóa học**.

## Dung lượng và loại tệp

- Nhận mọi định dạng, có hoặc không có phần mở rộng. Không giới hạn tệp theo loại lab. Hướng dẫn từng nền tảng vẫn chỉ rõ tệp gốc nào cần để mở lại dự án, ví dụ ZIP chương trình và JSON sân của GearsBot.
- Mỗi tệp tối đa **25 MiB**; mỗi tài khoản **250 MiB**, tối đa **500 tệp**. Mỗi bài trên một nền tảng tối đa **50 tệp**. Giao diện ghi giới hạn và dung lượng đã dùng ngay dưới chỗ thêm tệp; MB trong giao diện được tính theo 1.024 × 1.024 byte.
- Tệp trùng tên được lưu thành mục riêng, kèm thời điểm tải. Không ghi đè ngầm tệp trước. Tệp đang tải cũng được tính vào quota để các lượt đồng thời không vượt hạn mức. Hủy/dọn lượt tải không hoàn tất sẽ giải phóng phần đã giữ chỗ; lượt bỏ dở hết hạn sau 24 giờ và được dọn khi người đó mở kho tệp hoặc tải mới.
- Tệp mới nằm trong kho tệp riêng trên PostgreSQL, chia khối 1 MiB. Không đưa byte vào learner snapshot/localStorage hoặc tải hết tệp khi đăng nhập/đổi trang. Danh sách chỉ tải metadata; nội dung chỉ tải khi người học chọn xem/tải.
- Dữ liệu lớn truyền tối đa hai khối đồng thời, có tiến độ và nút hủy. Tệp chỉ xuất hiện như đã lưu khi đủ byte và hoàn tất trên server. Đổi bài/tài khoản hoặc đăng xuất dừng yêu cầu cũ và đóng trình xem.
- Tên tệp tối đa 180 ký tự, không có đường dẫn hoặc ký tự điều khiển. Mọi định dạng được giữ như byte, không giải nén hoặc thực thi. Ảnh raster nhận diện theo chữ ký; HTML/SVG không được nhúng để chạy. Văn bản xem bằng textContent, tối đa 512 KiB; PDF nhúng trong iframe sandbox. Định dạng khác luôn tải về nguyên bản.

## Dữ liệu và quyền truy cập

Snapshot hiện có giữ khóa `strobot.original.course.v3`, tại `[courseId][lessonId].labWork[platformKey]`. Phiên bản 1 giữ nguyên các trường ghi chú/mã; phiên bản 2 cũ có `files:[{name,dataBase64}]` vẫn đọc và sao lưu được với giới hạn cũ bốn tệp/256 KiB. Tệp mới đi qua API `/api/v1/lab-files`, vào hai bảng `learner_lab_files` và `learner_lab_file_chunks`; không viết thêm base64 vào hồ sơ khóa học. Không xóa hoặc chuyển tự động các tệp cũ.

- Chủ sở hữu luôn lấy từ phiên đăng nhập. Mỗi lần liệt kê, tải, hoàn tất hoặc xóa đều kiểm tra phiên/quyền hiện tại, kể cả đã bị thu hồi; tài khoản khác không đọc/xóa được tệp chỉ bằng ID. Khóa hàng user tuần tự hóa quota và ghi/xóa với việc thu hồi phiên.
- API file trả no-store. Nhật ký chỉ ghi ID/số byte, không ghi tên hoặc nội dung. Báo cáo admin không có tệp riêng. AI không nhận byte tệp đính kèm.
- Mã UTF-8 vẫn tối đa 32 KiB; ghi chú 2.000 ký tự; URL HTTPS 2.048 ký tự không chứa thông tin đăng nhập. Tổng hồ sơ khóa học vẫn 5 MiB, snapshot 8 MiB, độc lập với kho tệp 250 MiB.
- Sao lưu hồ sơ khóa học xuất tiến độ/ghi chú/bản mã và các tệp base64 cũ. Tệp mới trong kho tệp không gộp vào JSON; tải riêng từ danh sách đã lưu. Khôi phục JSON không xóa tệp mới.
- Mất mạng giữ bản nháp ghi chú theo tài khoản. Tải tệp lỗi không thay đổi tệp đã hoàn tất; người học chọn tải lại. Xóa tệp cần chủ động xác nhận, không xóa ghi chú hoặc tệp khác.

## Kiểm chứng và triển khai

`tests/lab-file-store.mjs` kiểm tra kiểu tệp tự do, khối dữ liệu, byte, hủy và đổi chủ. `tests/lab-file-viewer-smoke.py` kiểm tra chọn tệp, ảnh/văn bản/PDF, HTML không chạy mã, tải nguyên byte, hủy yêu cầu và bố cục điện thoại. `tests/lab-workspace-smoke.py` kiểm tra các kiểu tệp, kho tách khỏi hồ sơ, reload, hủy/xóa, tài khoản và đăng xuất. Các kiểm thử v1/v2/backup cũ được giữ.

`tests/product-journey-smoke.py` áp dụng migration vào PostgreSQL/Redis thử nghiệm, tải PNG và tệp lạ hơn 1 MiB, rồi xem ảnh/tải byte nguyên vẹn trên trình duyệt thứ hai. Nó cũng xác nhận học sinh khác không thể GET/xóa theo ID và admin không nhận nội dung riêng.

Backend phải cập nhật cùng frontend. Startup tự áp dụng migration bổ sung `20261125000000_learner_lab_files`; không tạo lại database hoặc tài khoản. Trên Render, nếu Auto-Deploy tắt, chọn **strobot-backend → Manual Deploy → Deploy latest commit**, chờ **Live** rồi tải lại website. Không cần cấu hình S3, mua storage mới hoặc nhập lại khóa AI. Kiểm thử cục bộ không xác nhận tình trạng trực tiếp của nhà cung cấp lab/AI.
