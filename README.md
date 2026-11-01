# ST-Robot

Bản giao diện đồng bộ theo `frontend.rar`: thanh điều hướng, trang chủ, giới thiệu, bộ kit, danh mục khóa học, quiz, đăng ký và không gian tự học. Giữ dữ liệu và chức năng của ST-ROBOT; không nhập backend/database của bản mẫu, không nhập thư viện video hoặc liên kết YouTube.

## Mở website

Cần Node.js 22 trở lên. Tại thư mục dự án, chạy:

```sh
node start-web.cjs
```

Trên Windows có thể nhấp đúp `MO-WEB.bat`. Mở địa chỉ hiển thị trong cửa sổ lệnh; giữ cửa sổ đó mở khi sử dụng web. Không cần `npm install` cho frontend. Không mở trực tiếp HTML bằng `file://` vì các module JavaScript cần HTTP.

Một cách khác, khi có Python 3:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Các trang HTML ở thư mục gốc chuyển về `frontend/public/` và giữ tham số khóa học/bài học. Có thể tiếp tục phục vụ thư mục dự án bằng GitHub Pages; đường dẫn tài nguyên hỗ trợ cả đường dẫn dự án con.

## Chức năng được giữ

- 5 khóa × 6 bài: Arduino Uno, VEX IQ, Micro:bit, LEGO SPIKE Prime và VEXcode VR.
- Lý thuyết, code mẫu, bài tập, quiz, nhật ký, điều kiện hoàn thành và tải PDF.
- Lab chạy trực tiếp trong website. Chỉ hiển thị nền tảng nhúng đã được kiểm chứng; nền tảng bị chặn hoặc chưa kiểm chứng sẽ bị ẩn, không có nút mở ngoài.
- Nội dung 30 bài có mục tiêu, kiến thức theo bước, ví dụ có đơn vị, lỗi thường gặp, tự kiểm tra và nguồn chính thức.
- micro:bit có cả mã mẫu MakeCode JavaScript và MicroPython; chọn đúng môi trường trước khi sao chép.
- Tìm/lọc bộ kit, thông số chi tiết, quiz ôn tập và chọn khóa từ trang đăng ký.
- AI trang chủ và AI Tutor tiếp tục gọi dịch vụ đã cấu hình tại `st-robot.onrender.com`; giao diện mới không thay endpoint hay gửi khóa bí mật từ trình duyệt.
- Chế độ sáng/tối và menu điện thoại.

Tiến độ và nhật ký lưu trong trình duyệt. Biểu mẫu đăng ký hiện chỉ mở khóa tự học; không tạo tài khoản, gửi thông tin liên hệ hay xác nhận thanh toán.

## AI server

Mã API `ai-server/server.mjs` được giữ nguyên; giáo trình AI và giáo trình hiển thị được đồng bộ từ `ai-server/curriculum.json`. Để chạy riêng: `cd ai-server` rồi `npm start` (Node >=22). Cần cấu hình `WOKU_API_KEY` an toàn ở phía máy chủ để có phản hồi thật, cùng `ALLOWED_ORIGIN` phù hợp với website. Frontend vẫn dùng endpoint triển khai cũ; khởi động server local không tự đổi endpoint đó.

## Kiểm tra giao diện

Bộ smoke test dùng Python, Playwright, pypdf và Chromium. Sau khi phục vụ thư mục dự án qua Python như trên:

```sh
python3 tests/ui-smoke.py --base http://127.0.0.1:8000 --chromium /usr/bin/chromium
```

Đổi `--chromium` theo nơi cài trình duyệt nếu cần. Test chặn kết nối ngoài và giả lập cả hai API AI; không gọi dịch vụ AI trả phí. Test kiểm tra giao diện, danh mục, đường dẫn cũ, kit, quiz, đăng ký, 30 bài học, lab nội bộ, lưu nhật ký, tải PDF, AI, menu và bố cục điện thoại. Các simulator bên ngoài và phản hồi AI thật phụ thuộc dịch vụ đang triển khai, không được xác nhận bởi test giả lập.

## Phòng lab trong website

Bàn thí nghiệm nội bộ luôn chạy trong trang. Nền tảng ngoài chỉ xuất hiện khi có kết quả kiểm chứng nhúng thành công đúng URL và origin website; các ứng viên chưa kiểm chứng hoặc bị chặn bị ẩn khỏi bộ chọn. Hiện môi trường kiểm tra chưa truy cập được nhà cung cấp để xác minh trực tiếp nên chỉ bàn thí nghiệm nội bộ được hiển thị.

Không có nút mở nền tảng ở tab riêng, không có hướng dẫn nền tảng trong giao diện. Khung nhúng không được phép mở popup hoặc điều hướng trang chính. Lỗi tải khung sẽ gỡ nền tảng đó khỏi bộ chọn và trở về bàn thí nghiệm nội bộ. Quiz, nhật ký, PDF và AI được giữ nguyên. Hồ sơ nguồn và điều kiện kiểm chứng: [docs/lab-platforms.md](docs/lab-platforms.md).

## Cập nhật nội dung và PDF cùng lúc

Chỉ sửa giáo trình gốc ở `ai-server/curriculum.json`, giữ nguyên ID khóa/bài để bảo toàn link và tiến độ. Tạo lại dữ liệu trình duyệt, thẻ khóa học và 5 PDF bằng:

```sh
python3 -m pip install -r scripts/requirements-content.txt
python3 scripts/build-learning-content.py
python3 tests/content-validation.py
```

Công cụ tạo PDF cần phông DejaVu Sans (`fonts-dejavu-core` trên Debian/Ubuntu), hoặc truyền `--symbol-font /duong/dan/DejaVuSans.ttf`. Font hỗ trợ ký hiệu khoa học, bên cạnh Be Vietnam Pro có sẵn trong dự án. Các file JS sinh ra đã được commit; người dùng website không cần Python hoặc công cụ build.

`python3 scripts/build-learning-content.py --check` phát hiện dữ liệu/PDF chưa cập nhật. Kiểm thử nội dung đọc PDF thật, đối chiếu đủ 30 bài và kiểm tra dữ liệu AI trùng dữ liệu frontend. Kiểm thử trình duyệt chặn các dịch vụ ngoài, xác nhận luồng chọn lab/ẩn nền tảng bị chặn và không mở tab ngoài, không khẳng định máy chủ ngoài đang hoạt động hoặc cho phép nhúng ở mọi thời điểm.
