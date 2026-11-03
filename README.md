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
- Khôi phục các lab gốc CircuitJS, AVR8js, MakeCode micro:bit và GearsBot; bổ sung Wokwi, PhET, Scratch và MakeCode Arcade bằng đường nhúng chính thức. Mỗi lab có thêm lựa chọn mở riêng ở tab ngoài; khung nhúng và mặc định cũ giữ nguyên.
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

Các nền tảng, URL và lựa chọn mặc định cũ được khôi phục theo bản `4b26e4a`: Arduino mở AVR8js (có thêm CircuitJS), micro:bit mở MakeCode, các khóa robot mở GearsBot. Bàn thí nghiệm nội bộ vẫn ở cuối danh sách như trước.

Các mục mới dùng endpoint nhúng chính thức: Wokwi Uno, PhET mạch DC, Scratch Maze Starter và MakeCode Arcade. Công cụ chỉ có editor mở ngoài không được thêm. Mỗi lab có nút “Mở riêng ở tab ngoài” tùy chọn; không có phần hướng dẫn nền tảng trong giao diện. Nút mở editor/toàn trang tương ứng với lab đang chọn, còn bàn thí nghiệm nội bộ mở đúng khóa/bài hiện tại trong một tab mới. Bản bổ sung có lỗi tải sẽ quay về lab gốc; không xóa/ẩn các nền tảng gốc chỉ vì môi trường kiểm tra không truy cập được chúng.

Lý thuyết 30 bài, code mẫu, quiz, nhật ký, PDF và AI được giữ nguyên. Nguồn xác nhận các đường nhúng và giới hạn kiểm thử: [docs/lab-platforms.md](docs/lab-platforms.md).

## Cập nhật nội dung và PDF cùng lúc

Chỉ sửa giáo trình gốc ở `ai-server/curriculum.json`, giữ nguyên ID khóa/bài để bảo toàn link và tiến độ. Tạo lại dữ liệu trình duyệt, thẻ khóa học và 5 PDF bằng:

```sh
python3 -m pip install -r scripts/requirements-content.txt
python3 scripts/build-learning-content.py
python3 tests/content-validation.py
```

Công cụ tạo PDF cần phông DejaVu Sans (`fonts-dejavu-core` trên Debian/Ubuntu), hoặc truyền `--symbol-font /duong/dan/DejaVuSans.ttf`. Font hỗ trợ ký hiệu khoa học, bên cạnh Be Vietnam Pro có sẵn trong dự án. Các file JS sinh ra đã được commit; người dùng website không cần Python hoặc công cụ build.

`python3 scripts/build-learning-content.py --check` phát hiện dữ liệu/PDF chưa cập nhật. Kiểm thử nội dung đọc PDF thật, đối chiếu đủ 30 bài và kiểm tra dữ liệu AI trùng dữ liệu frontend. Kiểm thử trình duyệt chặn các dịch vụ ngoài, xác nhận luồng chọn lab/ẩn nền tảng bị chặn và không mở tab ngoài, không khẳng định máy chủ ngoài đang hoạt động hoặc cho phép nhúng ở mọi thời điểm.

### Tránh lệch phiên bản danh sách lab

Danh sách lab được chèn trực tiếp vào trang học cùng mã hiển thị, thay vì tải một bản `lab-platforms.js` có thể còn trong cache cũ. Khi sửa `frontend/src/data/lab-platforms.js`, chạy:

```sh
python3 scripts/build-lab-snapshot.py
python3 scripts/build-lab-snapshot.py --check
```

Bộ kiểm thử giả lập máy chủ trả danh sách lab cũ và xác nhận trang mới không tải file rời đó, đồng thời vẫn hiện đủ 5 lựa chọn Arduino và tự mở AVR8js.

## Kiểm tra kiến thức theo khóa học

Trang Kiểm tra có 90 câu hỏi: 18 câu/khóa và 3 câu/bài, phủ đủ 5 khóa và 30 bài. Người học chọn khóa, chọn một bài hoặc cả khóa rồi chọn số câu. Đề cả khóa có 6/12/18 câu, phân bổ đều cho 6 bài; đề một bài có 3 câu. Chọn đáp án rồi xác nhận để xem đúng/sai và giải thích; kết quả có điểm, thống kê theo bài và liên kết ôn lại đúng nội dung. Tối đa 20 lượt hoàn thành lưu trên trình duyệt; mỗi phạm vi hiển thị 3 lượt gần nhất.

30 câu gốc lấy từ giáo trình đã duyệt. 60 câu bổ sung nằm trong `frontend/src/data/quiz-extra.json`; không chỉnh trực tiếp file sinh `frontend/src/data/quiz.js`. Khi cập nhật ngân hàng câu hỏi:

```sh
python3 scripts/build-quiz-bank.py
python3 scripts/build-quiz-bank.py --check
node tests/quiz-service.mjs
```

Bộ kiểm thử xác nhận câu hỏi không lẫn khóa/bài, phân bổ đề đều, chấm điểm không cộng lặp, khóa câu đã xác nhận, xem lại lời giải và lưu kết quả theo đúng phạm vi. Các module giao diện quiz dùng cùng mã phiên bản trên URL để tránh tải lẫn phiên bản cũ sau triển khai.

## Ôn tập theo lỗi

Trên trang **Kiểm tra**, hoàn thành một lượt rồi chọn **Ôn theo lỗi của tôi**. Mỗi lượt chọn tối đa 6 câu trong đúng khóa: ưu tiên câu có đáp án gần nhất chưa đúng, câu chưa làm trong bài đang có lỗi, rồi câu đã đến ngày ôn lại. Mỗi câu hiện lý do được chọn. Sau các lần đúng liên tiếp, lịch ôn lần lượt là 1, 3 và 7 ngày; trả lời sai thì ưu tiên ôn ngay.

Hồ sơ lưu đáp án từng câu của tối đa 120 lượt hoàn thành gần nhất. Lượt bỏ dở không được ghi nhận; lịch sử điểm cũ không tự chuyển thành dữ liệu lỗi từng câu. Có nút tải JSON và xóa dữ liệu kiểm tra, ôn tập riêng của khóa đã chọn. Nhật ký học, các khóa khác và dữ liệu đánh giá trước–sau được giữ lại.

Hồ sơ ôn thuộc trình duyệt đang sử dụng, chưa liên kết với tài khoản hoặc đồng bộ giữa các máy. Khi đổi người học trên máy chung, tải dữ liệu cần giữ rồi xóa hồ sơ của khóa trước khi bắt đầu.

## Đánh giá trước và sau khi học

Mở liên kết **Đánh giá trước – sau** trên trang Kiểm tra, hoặc trang `assessment.html`. Chức năng này dành cho một đợt dùng thử sáu bài Arduino:

- Hai đề A/B có tổng cộng 24 câu riêng, mỗi đề 12 câu, hai câu cho mỗi bài; không đưa vào ngân hàng luyện tập.
- Mã người tham gia ẩn danh, nhóm học theo thứ tự/ôn theo lỗi và thứ tự A→B/B→A được chọn trước khi làm bài.
- Bài đang làm được lưu để tiếp tục sau khi tải lại trang. Chỉ làm bài sau học khi đã nộp bài trước học; không làm lại một giai đoạn dưới cùng mã.
- Không hiện điểm, đáp án hoặc lời giải trước khi hoàn thành cả hai giai đoạn.
- Báo cáo chỉ ghép các mã đủ hai bài, hiển thị số mã chưa đủ cặp, điểm trung bình và mức thay đổi theo điểm phần trăm. Có xuất CSV từng câu và bản sao JSON, xóa một mã hoặc toàn bộ dữ liệu đánh giá sau khi xác nhận.

Hai đề cân bằng phạm vi nội dung nhưng chưa được hiệu chuẩn độ khó. Điểm tăng không tự chứng minh tác dụng của chức năng; cần khảo sát thật với điều kiện học được kiểm soát. Xem [hướng dẫn tổ chức và đọc kết quả](docs/learning-evaluation.md) trước khi dùng cho đề tài.

Kiểm thử các chức năng mới:

```sh
node tests/adaptive-review.mjs
node tests/assessment-service.mjs
python3 tests/learning-evidence-smoke.py --base http://127.0.0.1:5500 --chromium /usr/bin/chromium
```

Lệnh kiểm tra trình duyệt cần website đang chạy bằng `node start-web.cjs`. Các kiểm thử không gọi AI hoặc dịch vụ trả phí; kết quả ghi ngoài thư mục dự án.
