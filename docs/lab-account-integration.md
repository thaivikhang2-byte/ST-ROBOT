# Tài khoản học tập và bài thực hành

Học sinh dùng một tài khoản ST-Robot để xem tiến độ, ghi chép và tiếp tục bài thực hành trên các thiết bị. Trong mỗi bài, chọn **Thực hành**, chọn nền tảng rồi dùng **Bài thực hành của tôi**. Ghi chú, liên kết dự án và bản mã được lưu riêng theo khóa, bài và nền tảng. Khi trạng thái báo **Đã đồng bộ bài làm vào tài khoản**, máy khác đăng nhập cùng tài khoản có thể nạp lại bản này. Bản khách vẫn tách riêng; hệ thống không tự nhập bài của người trước vào tài khoản mới.

Mã và ghi chú là bản riêng của người học trong ST-Robot. Admin xem báo cáo tiến độ tổng hợp, không nhận nội dung mã/ghi chú qua báo cáo đó. AI học tập của chính người học có thể đọc bản đã đồng bộ của bài/nền tảng đang chọn để hỗ trợ; đây là bản sao đã lưu, không phải khả năng nhìn trực tiếp editor ngoài. Các chuỗi giống khóa/mật khẩu được che trước khi chuyển vào ngữ cảnh AI; học sinh vẫn không nên ghi thông tin đăng nhập trong bài.

| Nền tảng | Được gắn với tài khoản ST-Robot | Cách tiếp tục dự án ngoài |
| --- | --- | --- |
| Bàn mô hình trong bài | Tự lưu dự đoán, thao tác minh chứng, kết quả và tiến độ | Đổi tham số trong bàn mô hình; không có tài khoản ngoài |
| micro:bit Python Editor | Bridge chính thức tự lưu/khôi phục dự án theo bài trong hồ sơ tài khoản; có thể lấy mã Python vào bản bài làm hoặc tải `.py` | Chờ editor báo đã lưu; giữ tệp tải về khi cần |
| Wokwi / AVR8js | Lưu liên kết dự án, bản mã văn bản và ghi chú | Lưu dự án tại nền tảng hoặc tải tệp rồi nhập bản mã vào ST-Robot |
| GearsBot | Lưu liên kết, bản mã Python/văn bản và ghi chú | Dùng chức năng lưu/mở dự án của GearsBot; dự án Blockly lớn giữ tệp gốc |
| Scratch / MakeCode Arcade | Lưu liên kết và ghi chú; nhận bản mã văn bản phù hợp | Dùng tài khoản/lưu tệp của nền tảng; tệp `.sb3`/dự án nén không nhập như mã văn bản |
| CircuitJS / PhET | Lưu liên kết và ghi chú quan sát | Dùng chức năng chia sẻ/xuất của nền tảng nếu có |

ST-Robot không dùng mật khẩu học sinh để đăng nhập Wokwi/Scratch/GearsBot và không giả lập SSO. Trình duyệt chặn đọc dữ liệu của iframe khác miền; chỉ micro:bit có giao thức bridge được triển khai và kiểm tra nguồn gửi. **Mở riêng ở tab ngoài** luôn có sẵn khi cần không gian editor rộng hơn. Liên kết được lưu riêng trong ST-Robot không làm dự án ngoài trở thành riêng tư: phải đặt quyền chia sẻ ở nền tảng đó; đường dẫn chia sẻ có thể công khai. Giao diện nhắc điều này khi nhập liên kết.

Để có đăng nhập một lần cho một nền tảng ngoài, nền tảng phải có tích hợp được hỗ trợ như OAuth/OIDC/LTI hoặc API chính thức cho tổ chức. Cần kiểm tra điều khoản, quyền dữ liệu và khả năng của từng nhà cung cấp trước khi triển khai. Với các editor hiện có, quy trình khả thi là đăng nhập ST-Robot một lần, tiếp tục bản bài làm trong tài khoản, mở liên kết/tệp dự án ngoài khi cần.

## Dữ liệu và giới hạn

Bản bài làm dùng khóa đồng bộ hiện có `strobot.original.course.v3`, tại `[courseId][lessonId].labWork[platformKey]`. Mỗi bản có đúng các trường `version: 1`, `savedAt` ISO, `code`, `notes`, `projectUrl`, `fileName`. Chủ sở hữu do phiên đăng nhập/server quyết định; payload không có quyền chọn người sở hữu. Không thêm bảng, storage key hay dữ liệu tài khoản ngoài.

- Mã/tệp văn bản UTF-8 tối đa 32 KiB, ghi chú 2.000 ký tự, URL HTTPS 2.048 ký tự không chứa tên/mật khẩu, tên tệp 120 ký tự an toàn.
- Chỉ nhận nền tảng được phép của từng khóa; từ chối khóa prototype và trường lạ cả khi nhập bản sao.
- Tổng trạng thái khóa học tối đa 5 MiB, snapshot đồng bộ tối đa 8 MiB. Backup hồ sơ khóa tối đa 5 MiB và giữ `labWork`; tệp không hợp lệ không thay bản đang nhập/lưu.
- Mã quá lớn không bị cắt để lưu: bản đang nhập được giữ, có nút tải mã. Dự án nén/nhị phân được giữ tại nền tảng gốc hoặc trên máy, liên kết có thể lưu trong ST-Robot.
- Lưu trên thiết bị khác với đã đồng bộ. Mất mạng giữ hàng đợi theo đúng tài khoản; xung đột yêu cầu người học chọn/giữ bản, không tự ghi đè nội dung chồng nhau.
- Trong lúc khôi phục phiên/kết nối, lý thuyết và điều hướng hiển thị ngay. Chức năng sửa hồ sơ, tự hoàn thành, nhập tệp và bridge editor chỉ mở sau khi xác định đúng không gian lưu. Chọn bài/tab/nền tảng trong lúc chờ được giữ lại.

Kiểm thử: `node tests/lab-workspace.mjs`; `node tests/practice-portfolio.mjs`; `node tests/learner-sync.mjs`; `node tests/tutor-learning-context.mjs`; `python tests/lab-workspace-smoke.py --base http://127.0.0.1:5518`; `python tests/guided-learning-smoke.py --base http://127.0.0.1:5518`. Backend có kiểm tra policy snapshot và ngữ cảnh bài học; hành trình sản phẩm kiểm tra dữ liệu thật qua database thử nghiệm, đồng bộ máy thứ hai và cách ly học sinh khác. Các kiểm thử này không gọi AI trả phí hoặc khẳng định có SSO ngoài.
