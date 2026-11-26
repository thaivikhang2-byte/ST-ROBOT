# Luồng tự học và thực hành

Giao diện dành cho học sinh THCS, THPT bắt đầu học STEM Robotics. Tài khoản, tiến độ và bài thực hành được đồng bộ với database; agent dùng cấu hình do admin quản lý.

## Hành trình học

1. Trang bắt đầu chọn một trong năm khóa và kinh nghiệm hiện tại. Vào bài đầu trực tiếp, không thu tên hoặc thông tin liên hệ để mở học liệu.
2. Mỗi bài nêu mục tiêu, điều cần chuẩn bị và một ý chính trước khi mở phần giải thích sâu hơn.
3. Trong tab Thực hành, học sinh đọc nhiệm vụ và ghi dự đoán. Hướng dẫn từng bước, hướng dẫn editor và mã mẫu ở cùng tab với lab. Thanh bốn bước chuyển tới Hướng dẫn, Chạy thử, Lưu bài và Kiểm tra. Chuẩn bị và các bước chính hiện ngay; xử lý lỗi, mở rộng, mã đầy đủ và sao lưu được thu gọn.
4. Học sinh thao tác trong editor, bộ kit hoặc mô hình quy tắc của bài; ghi quan sát, giải thích và kết quả khi đổi đầu vào.
5. Câu kiểm tra giúp đối chiếu kiến thức. Hoàn thành là học sinh **tự xác nhận** sau khi điền các phần và trả lời đúng; không phải điểm năng lực tự động chấm từ văn bản.

Các bài đầu được chia thành thao tác nhỏ. Micro:bit dùng MicroPython trong Python Editor làm môi trường chính; MakeCode được ghi rõ là biến thể riêng. Nguồn curriculum và ngân hàng câu hỏi được dựng lại cùng PDF để nội dung đồng nhất.

## Mô hình trong web

Có mô hình riêng cho 30 bài, chia thành các bộ: Arduino (mạch, nhịp, Echo, ngưỡng, hiệu chuẩn, hysteresis), micro:bit (ma trận, nút, ánh sáng, đếm, giao thức radio, kiểm thử), robot (lệnh từng bước, cảm biến, vòng lặp, điều khiển, BFS/DFS), và cơ cấu/phân loại LEGO.

Đây là mô hình quy tắc được công bố, không phải trình chạy mã tùy ý. Ví dụ nguồn 5 V và sụt áp LED 2 V là giả định của mô hình; khoảng cách từ Echo dùng vận tốc âm thanh giả định. Kết quả không thay cho số đo phần cứng. BFS/DFS ở bài thực nghiệm dùng cùng bản đồ, điểm đầu/đích, thứ tự lân cận, chi phí và giới hạn mở rộng như chương trình Python; tình huống không có đường đi vẫn là thất bại nhiệm vụ.

`mountLessonBench(host,{course,lesson,onEvidence})` trả về `destroy()`. Callback chỉ phát khi có thao tác, không phát lúc mở bài hoặc đặt lại. Nó gửi `kind`, `lessonId`, `summary`, `actions`; trang thêm bản chụp dự đoán tại thời điểm thao tác. Nếu sửa dự đoán, cần chạy lại mô hình trước khi tự xác nhận. Callback này không chứng minh code đã chạy hay lời giải đúng.

## Hồ sơ và giới hạn lưu trữ

Giữ khóa `strobot.original.course.v3` và các ghi chú/tiến độ cũ. Bản ghi mới thêm `prediction`, `observation`, `explanation`, `transfer`, `source`, `projectUrl`, `modelEvidence`, `completionSource`, `completedAt`. `source` là `local-model`, `external` hoặc `hardware`. Chỉnh các phần minh chứng hoặc làm lại kiểm tra sẽ mở lại trạng thái hoàn thành; ghi chú thêm không xóa tiến độ.

Tải hồ sơ xuất JSON phiên bản 2 theo từng khóa. Khôi phục hỗ trợ bản cũ, kiểm tra toàn bộ tệp trước khi thay dữ liệu, yêu cầu xem trước và xác nhận thay các bài có trong tệp; giữ các bài khác/khóa khác. Dữ liệu nhập đánh dấu hoàn thành được gắn `imported-self-report`; không tiếp nhận cờ chấm điểm hoặc xác minh tùy ý. Tệp tối đa 5 MiB, chỉ nhận bài thuộc khóa và đường dẫn dự án HTTPS. Đã có kiểm thử tệp lỗi, giới hạn dữ liệu và khóa có nguy cơ sửa prototype.

Hồ sơ chứa dự đoán, quan sát, ghi chú và bài làm theo nền tảng. Tệp dự án, ảnh và tài liệu được thêm ở phần Lưu bài thực hành: mọi định dạng, tối đa 25 MiB/tệp và 250 MiB/tài khoản, lưu riêng khỏi snapshot. Xem bản đã lưu mở danh sách để chọn xem hoặc tải từng tệp. Cầu nối micro:bit tự lưu toàn bộ dự án nhúng theo bài và tài khoản. PhET và mô hình trong web lưu phiếu kết quả; người học nhập lại đầu vào khi mở phiên mới. Các editor ngoài giữ cơ chế lưu và tài khoản riêng. Xem [hướng dẫn từng nền tảng](lab-account-integration.md).

Lỗi tải iframe giữ tùy chọn nền tảng, cho thử tải lại, mở riêng hoặc chuyển mô hình. Một lần tải lỗi không xóa nền tảng khỏi danh sách. Các mô hình và PDF được phục vụ cùng web nên vẫn dùng khi bên cung cấp lab gián đoạn; không cam kết chúng thực thi thay mọi dự án trên nền tảng đó.

## Agent và quyền kiểm soát

Agent đọc dữ liệu học tập của đúng chủ tài khoản trên server và nhận danh mục lab/cách lưu do website quản lý. Tệp nhị phân không được gửi sang AI. Ba nút gợi ý chỉ điền câu hỏi để người học xem rồi gửi; không tự gọi API hoặc điều khiển iframe. Editor khác miền chỉ được đọc/ghi qua giao thức chính thức đã triển khai, hiện có ở micro:bit. Cấu hình provider và luồng lập đề AI được giữ nguyên.

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

Trang học dùng `PlatformGuides.js` để chọn nhiệm vụ, các bước chuẩn bị, cách chạy, kết quả dự kiến, xử lý lỗi và mã theo khóa/bài/nền tảng. Có 78 hoạt động trên bảy công cụ. Python Editor dùng MicroPython; GearsBot dùng API ev3dev2 hoặc Python tính toán đúng theo nhãn. Wokwi mở editor đầy đủ ở tab riêng; Scratch/Arcade sample player không còn trong lựa chọn. Mô hình và mô phỏng mạch không chạy mã có hướng dẫn thao tác riêng.

Mỗi bài có giải thích nhập môn, ví von kèm giới hạn, thuật ngữ, một trường hợp làm từng bước, câu hỏi tự giải thích và ba mức đọc. Mức đọc do học sinh tự chọn và được nhớ trên trình duyệt. Các nội dung này cũng có trong PDF; chương trình, câu hỏi và đáp án cũ được giữ nguyên.

`FloatingTutor.js` quản lý nút AI và cửa sổ trò chuyện, không dành một cột cố định trong bài học. Có thể kéo bằng chuột/cảm ứng, di chuyển bằng bàn phím trên tay nắm, thu gọn, mở lại và khôi phục vị trí. Cửa sổ nằm trong vùng nhìn thấy khi đổi kích thước hoặc mở bàn phím điện thoại. Escape ưu tiên hộp thoại PDF/khôi phục đang mở.

## Ảnh lỗi và chụp màn hình

`TutorAttachments.js` nhận tệp PNG/JPEG/WebP, ảnh dán hoặc một khung hình từ tab/cửa sổ/màn hình do người học chọn qua bộ chọn của trình duyệt. Đây là thao tác người học chủ động: ảnh được xem trước, bỏ hoặc gửi cùng câu hỏi. Trình duyệt điện thoại thường không có API chia sẻ màn hình: nút Ảnh chụp màn hình mở bộ chọn ảnh của máy, để chọn ảnh chụp bằng phím hệ thống rồi cắt ngay trong web. Không dùng camera thay cho chụp màn hình. Nguồn chia sẻ trên máy tính không có âm thanh; mọi track dừng ngay sau khi lấy khung hình, trước khi mở công cụ cắt, và cũng dừng khi hủy/đóng/đổi bài hoặc gặp lỗi. Không lưu ảnh vào localStorage, hồ sơ thực hành hay lịch sử yêu cầu tiếp theo.

Sau khi chụp hoặc chọn ảnh chụp, hộp thoại cho kéo chuột/ngón tay chọn vùng, kéo góc để chỉnh kích thước, di chuyển vùng chọn hoặc nhập tọa độ theo pixel ảnh gốc. Có các lựa chọn Dùng vùng đã chọn, Dùng toàn ảnh, Chọn lại vùng và Hủy. Chỉ phần đã xác nhận được đưa vào bản nháp; chưa có ảnh nào gửi đến AI trước khi bấm Gửi. Ảnh tải/dán vẫn thêm như trước và có nút Cắt ảnh để chỉnh lại; hủy chỉnh giữ nguyên bản nháp. Đổi bài, reset hoặc đóng tutor hủy thao tác đang chờ và không để kết quả cũ ghi đè phiên mới. Bộ giải mã ảnh có đường HTMLImageElement/object URL cho trình duyệt không hỗ trợ createImageBitmap.

Tệp gốc giới hạn 8 MiB, tối đa 25 triệu pixel; ảnh chuẩn hóa JPEG, cạnh dài tối đa 1600 pixel và loại bỏ metadata. Mỗi câu hỏi tối đa hai ảnh, mỗi ảnh 1.5 MiB, tổng 3 MiB. Xem trước trước khi gửi; giới hạn này chỉ là giới hạn kỹ thuật, không phải bảo đảm AI đọc đúng mọi thông báo. Nên chụp rõ mã, lỗi và vùng kết quả có liên quan.

`/api/tutor` nhận thêm `images:[{dataUrl}]`, `platformKey` và `learningLevel`; server kiểm tra byte ảnh, kiểu dữ liệu, giới hạn request và lựa chọn nền tảng theo khóa. Ảnh nằm trong lượt hỏi hiện tại dưới dạng multimodal `image_url`. Khi thử lại hoặc chuyển model, ảnh được giữ nguyên; provider từ chối đọc ảnh trả lỗi riêng, không tự bỏ ảnh rồi trả lời như đã xem. Lượt hỏi văn bản và cấu hình provider vẫn dùng luồng có sẵn. AI được cung cấp mô tả nền tảng/mức đọc do server quản lý; mã trong giáo trình được phân biệt với mã thực tế học sinh gửi.

Kiểm tra bổ sung:

- `node tests/platform-guides.mjs` kiểm tra 234 tổ hợp bài/nền tảng/mức đọc, hướng dẫn lưu/mở lại, cú pháp Python và sáu sketch AVR chạy trong bộ kiểm thử.
- `node tests/tutor-images.mjs` kiểm tra dữ liệu ảnh, giới hạn streaming, context và payload provider bằng nhà cung cấp giả lập.
- `python3 tests/floating-tutor-smoke.py --base http://127.0.0.1:5500` kiểm tra kéo chuột/cảm ứng, bàn phím, lưu vị trí, vùng nhìn thấy và hộp thoại.
- `python3 tests/tutor-images-smoke.py --base http://127.0.0.1:5500` kiểm tra tải/dán/chụp, cắt vùng, bộ chọn ảnh điện thoại, Safari decode fallback, xem trước, gửi, giữ khi lỗi và dừng track. Nguồn chụp và phản hồi AI được giả lập, không phát sinh lượt hỏi dịch vụ thật.

- `python3 tests/image-crop-smoke.py --base http://127.0.0.1:5500` đối chiếu pixel ảnh cắt thật, tọa độ ảnh gốc, chuột/cảm ứng, kéo góc và điều khiển bàn phím. Kiểm thử điện thoại dùng giả lập viewport/cảm ứng trong Chromium; không thay cho thử nghiệm trực tiếp trên mọi máy Android/iPhone.
