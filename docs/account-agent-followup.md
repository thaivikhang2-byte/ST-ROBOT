# Agent gắn với tài khoản và giao diện quản lí — 15/11/2026

## Thay đổi

- Chat chữ khi đã đăng nhập, cả trang chủ lẫn bài học, gọi agent backend và đọc dữ liệu đã lưu của đúng chủ tài khoản. Chat theo bài dùng slug giáo trình, bài và nền tảng đang chọn; chat trang chủ có hội thoại riêng.
- Agent biết danh sách lab thực sự có trên website và có công cụ đọc tiến độ, nhật ký, quiz/ôn tập và phần dự án đã lưu theo khóa/bài. Metadata lạ, bí mật xác thực và dữ liệu tài khoản khác không được đưa vào ngữ cảnh. Các báo cáo học tập có nhãn nguồn; không tự nhận đã chấm điểm hoặc nhìn thấy iframe bên ngoài.
- Người học khách và câu hỏi có ảnh giữ API vision hiện tại. Chúng gửi một báo cáo trình duyệt có giới hạn và danh mục lab cố định ở server; không tự nhận đã đọc database. Lỗi backend/phiên/provider trong chat tài khoản không tự đổi thành chat khách.
- Có giao diện học sinh với thống kê, tiếp tục bài học, lớp tham gia và lịch sử thao tác; giao diện quản trị dùng quyền thực để xem thống kê, tạo học sinh, khóa/mở khóa và đặt lại mật khẩu học sinh.
- Trạng thái phân loại tài khoản bị khóa được tách khỏi quyền đang có. Mở khóa không khôi phục token cũ; các công cụ quản lí lớp không áp dụng cho tài khoản nhân viên bị ẩn quyền.
- Chế độ tài khoản trường học hỗ trợ quản trị viên nội bộ và tài khoản học sinh do quản trị xác nhận mà không cần SMTP. Tự đăng ký công khai phải tắt trong chế độ không gửi email. Mặc định xác minh email của hệ thống cũ giữ nguyên.
- Giao diện cấu hình AI dùng API mã hóa credential, revision CAS, model registry và công tắc bật/tắt có audit. Key không được lưu trong browser storage hoặc source. Phải cấu hình kho khóa bền vững/master key phía server; giao diện không tự gọi AI tính phí khi mở trang hoặc lưu cấu hình.
- Bổ sung startup migration/seed và CLI nhập admin riêng cho server, cùng bộ cấu hình VPS có HTTPS. Chúng không tự mua/chạy dịch vụ cloud, không đưa mật khẩu admin vào môi trường backend chạy lâu dài.

## Kiểm tra

- Build và typecheck backend qua; **29 suites / 197 tests** Jest qua.
- Các unit frontend cho tài khoản, dashboard, AI setup, tutor context, startup và vòng đời secret qua.
- Chromium có fixture API: chat trang chủ/bài học dùng account agent, hủy/xóa lịch sử khi đổi tài khoản, giữ câu hỏi khi backend 503; chụp/cắt ảnh vẫn đi qua vision và không chuyển bearer tới dịch vụ cũ.
- Chromium có fixture API: học sinh/quản trị tách theo quyền; form mật khẩu dùng POST ngay cả khi module chưa tải; tạo, reset, khóa/mở khóa, mobile và thu hồi quyền qua.
- **5 nhóm thử nghiệm thật** trên PostgreSQL/Redis riêng: quản trị tạo học sinh đã xác nhận, học sinh đăng nhập bằng điện thoại và lưu nhật ký database; khóa thu hồi phiên ngay; mở khóa không hồi token; reset làm mật khẩu cũ thất bại và mật khẩu mới truy cập lại nhật ký. Không lỗi JavaScript không được xử lí.
- AI setup được kiểm tra bằng client/Chromium và 7 ca backend quyền/TLS. Không gọi provider AI thật, không gửi SMTP thật. Các khóa và người dùng thử đều ngoài repository.

## Triển khai công khai

Địa chỉ Render `st-robot-1.onrender.com` đang phục vụ AI cũ; ảnh dashboard của người vận hành cho thấy service Node Free ở commit cũ. Một commit GitHub chứa backend không tự tạo PostgreSQL, Redis hoặc ổ đĩa bền vững cho kho khóa agent. Cần xác định các dịch vụ hiện có trong Dashboard, chọn cấu hình host và được chủ hệ thống duyệt chi phí trước khi tạo dịch vụ trả phí.

Không nhúng credential quản trị được cung cấp trong ảnh vào source hoặc tài khoản mặc định. Người vận hành tạo admin trên database được chọn bằng CLI riêng sau khi backend thật đã migrate/seed. Chỉ đặt URL API công khai của frontend sau khi xác nhận backend đó sẵn sàng. Xem [hướng dẫn backend](backend-deployment.md), [tài khoản nội bộ](managed-accounts.md) và [agent](backend-agent.md).
