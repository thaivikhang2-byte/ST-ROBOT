# Luồng tự học và thực hành

Bản cập nhật này chuẩn bị phần giao diện và nội dung cho học sinh THCS, THPT bắt đầu học STEM Robotics. Database, đăng nhập, agent và khảo sát thuộc giai đoạn tích hợp tiếp theo.

## Hành trình học

1. Trang bắt đầu chọn một trong năm khóa và kinh nghiệm hiện tại. Vào bài đầu trực tiếp, không thu tên hoặc thông tin liên hệ để mở học liệu.
2. Mỗi bài nêu mục tiêu, điều cần chuẩn bị và một ý chính trước khi mở phần giải thích sâu hơn.
3. Trong tab Thực hành, học sinh đọc nhiệm vụ và ghi dự đoán. Hướng dẫn từng bước, hướng dẫn editor và mã mẫu ở cùng tab với lab. Có nút chuyển nhanh giữa nhiệm vụ, bàn thực hành và ghi kết quả.
4. Học sinh thao tác trong editor, bộ kit hoặc mô hình quy tắc của bài; ghi quan sát, giải thích và kết quả khi đổi đầu vào.
5. Câu kiểm tra giúp đối chiếu kiến thức. Hoàn thành là học sinh **tự xác nhận** sau khi điền các phần và trả lời đúng; không phải điểm năng lực tự động chấm từ văn bản.

Các bài đầu được chia thành thao tác nhỏ. Micro:bit dùng MicroPython trong Python Editor làm môi trường chính; MakeCode được ghi rõ là biến thể riêng. Nguồn curriculum và ngân hàng câu hỏi được dựng lại cùng PDF để nội dung đồng nhất.

## Mô hình trong web

Có mô hình riêng cho 30 bài, chia thành các bộ: Arduino (mạch, nhịp, Echo, ngưỡng, hiệu chuẩn, hysteresis), micro:bit (ma trận, nút, ánh sáng, đếm, giao thức radio, kiểm thử), robot (lệnh từng bước, cảm biến, vòng lặp, điều khiển, BFS/DFS), và cơ cấu/phân loại LEGO.

Đây là mô hình quy tắc được công bố, không phải trình chạy mã tùy ý. Ví dụ nguồn 5 V và sụt áp LED 2 V là giả định của mô hình; khoảng cách từ Echo dùng vận tốc âm thanh giả định. Kết quả không thay cho số đo phần cứng. BFS/DFS ở bài thực nghiệm dùng cùng bản đồ, điểm đầu/đích, thứ tự lân cận, chi phí và giới hạn mở rộng như chương trình Python; tình huống không có đường đi vẫn là thất bại nhiệm vụ.

`mountLessonBench(host,{course,lesson,onEvidence})` trả về `destroy()`. Callback chỉ phát khi có thao tác, không phát lúc mở bài hoặc đặt lại. Nó gửi `kind`, `lessonId`, `summary`, `actions`; trang thêm bản chụp dự đoán tại thời điểm thao tác. Nếu sửa dự đoán, cần chạy lại mô hình trước khi tự xác nhận. Callback này không chứng minh code đã chạy hay lời giải đúng.

## Hồ sơ và giới hạn lưu trữ

Giữ khóa `strobot.original.course.v3` và các ghi chú/tiến độ cũ. Bản ghi mới thêm `prediction`, `observation`, `explanation`, `transfer`, `source`, `projectUrl`, `modelEvidence`, `completionSource`, `completedAt`. `source` là `local-model`, `external` hoặc `hardware`. Chỉnh các phần minh chứng hoặc làm lại kiểm tra sẽ mở lại trạng thái hoàn thành; ghi chú thêm không xóa tiến độ.

Tải hồ sơ xuất JSON phiên bản 2 theo từng khóa. Khôi phục hỗ trợ bản cũ, kiểm tra toàn bộ tệp trước khi thay dữ liệu, yêu cầu xem trước và xác nhận thay các bài có trong tệp; giữ các bài khác/khóa khác. Dữ liệu nhập đánh dấu hoàn thành được gắn `imported-self-report`; không tiếp nhận cờ chấm điểm hoặc xác minh tùy ý. Tệp tối đa 1 MiB, chỉ nhận bài thuộc khóa và đường dẫn dự án HTTPS. Đã có kiểm thử tệp lỗi, giới hạn dữ liệu và khóa có nguy cơ sửa prototype.

Hồ sơ trên là dự đoán, quan sát và ghi chú. Tệp mã/dự án thực tế của editor cần lưu hoặc tải tại nền tảng đó. Cầu nối micro:bit hiện có vẫn lưu dự án từng bài ở bộ nhớ trình duyệt riêng và cho tải `.py`. Các iframe khác giữ cách lưu dự án của nền tảng tương ứng; tài khoản nền tảng đó độc lập. Tệp hồ sơ có thể chuyển thủ công sang trình duyệt khác, chưa có đồng bộ tài khoản tự động.

Lỗi tải iframe giữ tùy chọn nền tảng, cho thử tải lại, mở riêng hoặc chuyển mô hình. Một lần tải lỗi không xóa nền tảng khỏi danh sách. Các mô hình và PDF được phục vụ cùng web nên vẫn dùng khi bên cung cấp lab gián đoạn; không cam kết chúng thực thi thay mọi dự án trên nền tảng đó.

## Tích hợp sau này

Nhóm phụ trách database có thể lưu bản ghi theo người dùng + khóa + bài, giữ định danh cũ và phân biệt dữ liệu người học báo cáo với thao tác máy ghi nhận. Agent cần adapter chính thức cho từng editor và sự cho phép của người học trước khi áp dụng sửa mã. Ba nút gợi ý AI hiện chỉ điền câu hỏi để người học xem và gửi; chúng không tự gọi API hoặc điều khiển iframe. Cấu hình provider và luồng lập đề AI hiện tại được giữ nguyên.

## Kiểm tra cục bộ

- `node tests/lesson-bench.mjs`
- `node tests/practice-portfolio.mjs`
- `node tests/quiz-service.mjs`
- `python3 tests/guided-learning-smoke.py --base http://127.0.0.1:5500`
- `python3 tests/ui-smoke.py --base http://127.0.0.1:5500`
- `python3 tests/ai-formatting-smoke.py --base http://127.0.0.1:5500`
- `python3 tests/content-validation.py`
- `python3 tests/lesson-code-validation.py`

Các kiểm thử trình duyệt chặn iframe bên ngoài và dùng phản hồi AI kiểm thử. Chúng xác minh giao diện, quy trình và dữ liệu, không xác nhận trạng thái dịch vụ bên ngoài hoặc hiệu quả thực nghiệm trên học sinh.

## Hướng dẫn theo nền tảng và AI nổi

Trang học dùng `PlatformGuides.js` để chọn nhiệm vụ, các bước chuẩn bị, cách chạy, kết quả dự kiến, cách xử lý lỗi và mã theo bộ ba khóa/bài/nền tảng. Có 126 hoạt động cho các lựa chọn hiện có. Mỗi hoạt động ghi rõ là thực hành chính hay bổ trợ và nêu phần có thể so sánh với bài học. Python Editor chỉ hiện MicroPython; GearsBot dùng API ev3dev2 hoặc Python tính toán đúng theo mẫu. Scratch có công thức khối lệnh; Arcade có TypeScript. Các bàn mô hình và mô phỏng mạch không có editor mã dùng hướng dẫn thao tác. Với khung chỉ chạy dự án mẫu, hướng dẫn chỉ rõ cách vào editor đầy đủ ở tab riêng để sửa và lưu.

Mỗi bài có giải thích nhập môn, ví von kèm giới hạn, thuật ngữ, một trường hợp làm từng bước, câu hỏi tự giải thích và ba mức đọc. Mức đọc do học sinh tự chọn và được nhớ trên trình duyệt. Các nội dung này cũng có trong PDF; chương trình, câu hỏi và đáp án cũ được giữ nguyên.

`FloatingTutor.js` quản lý nút AI và cửa sổ trò chuyện, không dành một cột cố định trong bài học. Có thể kéo bằng chuột/cảm ứng, di chuyển bằng bàn phím trên tay nắm, thu gọn, mở lại và khôi phục vị trí. Cửa sổ nằm trong vùng nhìn thấy khi đổi kích thước hoặc mở bàn phím điện thoại. Escape ưu tiên hộp thoại PDF/khôi phục đang mở.

## Ảnh lỗi và chụp màn hình

`TutorAttachments.js` nhận tệp PNG/JPEG/WebP, ảnh dán hoặc một khung hình từ tab/cửa sổ/màn hình do người học chọn qua bộ chọn của trình duyệt. Đây là thao tác người học chủ động: ảnh được xem trước, bỏ hoặc gửi cùng câu hỏi. Trình duyệt không hỗ trợ chia sẻ màn hình dùng tải/dán ảnh. Nguồn chia sẻ không có âm thanh; các track dừng sau một ảnh, khi hủy/đóng/đổi bài hoặc gặp lỗi. Không lưu ảnh vào localStorage, hồ sơ thực hành hay lịch sử yêu cầu tiếp theo.

Tệp gốc giới hạn 8 MiB, tối đa 25 triệu pixel; ảnh chuẩn hóa JPEG, cạnh dài tối đa 1600 pixel và loại bỏ metadata. Mỗi câu hỏi tối đa hai ảnh, mỗi ảnh 1.5 MiB, tổng 3 MiB. Xem trước trước khi gửi; giới hạn này chỉ là giới hạn kỹ thuật, không phải bảo đảm AI đọc đúng mọi thông báo. Nên chụp rõ mã, lỗi và vùng kết quả có liên quan.

`/api/tutor` nhận thêm `images:[{dataUrl}]`, `platformKey` và `learningLevel`; server kiểm tra byte ảnh, kiểu dữ liệu, giới hạn request và lựa chọn nền tảng theo khóa. Ảnh nằm trong lượt hỏi hiện tại dưới dạng multimodal `image_url`. Khi thử lại hoặc chuyển model, ảnh được giữ nguyên; provider từ chối đọc ảnh trả lỗi riêng, không tự bỏ ảnh rồi trả lời như đã xem. Lượt hỏi văn bản và cấu hình provider vẫn dùng luồng có sẵn. AI được cung cấp mô tả nền tảng/mức đọc do server quản lý; mã trong giáo trình được phân biệt với mã thực tế học sinh gửi.

Kiểm tra bổ sung:

- `node tests/platform-guides.mjs` kiểm tra 378 tổ hợp bài/nền tảng/mức đọc, cú pháp Python, sáu sketch AVR và các công thức Arcade trong môi trường kiểm thử API.
- `node tests/tutor-images.mjs` kiểm tra dữ liệu ảnh, giới hạn streaming, context và payload provider bằng nhà cung cấp giả lập.
- `python3 tests/floating-tutor-smoke.py --base http://127.0.0.1:5500` kiểm tra kéo chuột/cảm ứng, bàn phím, lưu vị trí, vùng nhìn thấy và hộp thoại.
- `python3 tests/tutor-images-smoke.py --base http://127.0.0.1:5500` kiểm tra tải/dán/chụp, xem trước, gửi, giữ khi lỗi và dừng track. Nguồn chụp và phản hồi AI được giả lập, không phát sinh lượt hỏi dịch vụ thật.
