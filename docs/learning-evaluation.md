# Ôn tập theo lỗi và đánh giá trước–sau

Hai chức năng phục vụ hai việc khác nhau: giúp người học chọn phần cần ôn và thu kết quả của một đợt dùng thử. Chúng chạy trên website tĩnh, không phụ thuộc phản hồi AI hoặc tài khoản máy chủ.

## Người học bắt đầu ở đâu?

Mở **Kiểm tra**, chọn một khóa và hoàn thành một lượt làm bài. Sau đó chọn **Ôn theo lỗi của tôi**. Hệ thống chọn câu trong đúng khóa, kèm lý do chọn để người học biết mình đang ôn phần nào.

Một lượt đang làm dở không được tính thành kết quả. Chọn lại nội dung hoặc rời trang trước khi hoàn thành sẽ không thêm bằng chứng ôn tập. Lịch sử tổng điểm cũ vẫn được giữ, nhưng không được suy diễn thành lỗi từng câu khi dữ liệu cũ không có thông tin đó.

### Quy tắc chọn câu

1. Ưu tiên câu có đáp án sai ở lần làm gần nhất.
2. Sau đó chọn câu chưa làm thuộc bài đang có lỗi, để kiểm tra thêm cùng nội dung.
3. Cuối cùng chọn câu đã làm đúng và đã đến ngày ôn lại.

Đây là quy tắc lập lịch minh bạch, không phải mô hình AI được huấn luyện để dự đoán năng lực. Số câu đã làm và kết quả từng câu là bằng chứng để chọn nội dung tiếp theo. Trả lời đúng một vài câu không đủ để kết luận đã thành thạo thực hành robot.

Phần ôn dùng ngân hàng 90 câu hiện có của 5 khóa. Những câu đánh giá trước–sau nằm trong ngân hàng riêng và không được chọn vào lượt ôn này.

## Tổ chức một đợt đánh giá

Mở **Đánh giá trước–sau** từ trang Kiểm tra. Phiên bản hiện tại tập trung vào sáu bài Arduino, với hai đề A/B, mỗi đề 12 câu, hai câu cho mỗi bài.

Hai đề được xây dựng cùng phạm vi nội dung và số câu. Chúng **chưa được hiệu chuẩn trên học sinh để xác nhận độ khó tương đương**. Đây là công cụ thử nghiệm ban đầu, không phải bài kiểm tra chuẩn hóa.

### Trước khi cho học sinh sử dụng

- Viết câu hỏi cần kiểm chứng, ví dụ: “Với cùng thời lượng học, gợi ý ôn theo lỗi có liên quan đến mức cải thiện kết quả cao hơn cách học theo thứ tự cố định không?”
- Xác định trước đối tượng, thời lượng học, nội dung, cách phân nhóm và cách chấm. Hai nhóm cần có điều kiện học và mức hỗ trợ tương tự.
- Gán mã như `HS001`; không nhập họ tên, số điện thoại, email hoặc thông tin liên hệ vào web. Nếu cần đối chiếu mã với danh sách lớp, giáo viên giữ bảng đối chiếu riêng.
- Chọn nhóm theo kế hoạch đã định. Nhãn nhóm trên web chỉ ghi lại cách phân nhóm; phần mềm không tự tổ chức một thí nghiệm ngẫu nhiên.
- Phân bố cả thứ tự A→B và B→A trong từng nhóm để giảm ảnh hưởng của thứ tự đề. Không đổi nhóm hoặc thứ tự đề sau khi đã thấy điểm đầu vào.

### Trong buổi dùng thử

1. Tạo hồ sơ theo mã, nhóm và thứ tự đề đã được gán.
2. Cho học sinh làm bài trước học độc lập. Phần đánh giá không hiện đáp án hoặc lời giải khi chưa hoàn thành cả hai giai đoạn.
3. Trên máy dùng chung, xuất dữ liệu cần giữ và xóa hồ sơ ôn của khóa Arduino trước khi đổi học sinh. Tổ chức hoạt động học theo đúng nhóm và thời lượng đã thống nhất. Nhóm học theo thứ tự dùng trình tự cố định; nhóm ôn theo lỗi dùng gợi ý của trang Kiểm tra. Ghi lại những lần được người hướng dẫn hỗ trợ.
4. Trở lại đúng mã để làm bài sau học. Không tạo mã mới để làm lại và chọn kết quả cao hơn.
5. Xuất CSV và bản sao JSON sau buổi học. Đối chiếu số học sinh tham gia, số hoàn thành và số thiếu một giai đoạn trước khi tính kết quả.

Khi tải lại trang, bài đang làm được khôi phục. Thời gian ghi nhận là khoảng thời gian từ lúc bắt đầu đến khi nộp, bao gồm cả thời gian nghỉ hoặc đóng trang; không coi đây là thời gian tập trung học. Khoảng thời gian bất thường không được dùng để kết luận học nhanh hơn.

Website tĩnh không bảo vệ đề như một hệ thống thi có giám sát. Người có kiến thức lập trình có thể đọc mã nguồn và ngân hàng câu hỏi. Với đợt khảo sát chính thức, giáo viên nên giám sát, giữ điều kiện làm bài giống nhau và không cho xem mã nguồn hoặc đề sau học trước thời điểm quy định.

## Đọc kết quả

Chỉ những mã có đủ bài trước và sau mới có chênh lệch theo cặp. Những mã chưa hoàn thành vẫn cần được báo cáo, không âm thầm loại khỏi mô tả số người tham gia.

Mức thay đổi tính bằng **điểm phần trăm**: trước 50%, sau 75% là tăng 25 điểm phần trăm. Báo cáo số cặp, điểm trước, điểm sau và mức thay đổi trung bình của từng nhóm. Lưu kết quả gốc để có thể tính lại và kiểm tra trường hợp ngoại lệ.

Điểm tăng không tự chứng minh chức năng gây ra cải thiện. Khác biệt nền tảng, độ khó đề, mức hỗ trợ, việc nhớ câu hỏi và số người bỏ dở đều có thể ảnh hưởng. Nếu mẫu nhỏ, gọi đó là kết quả dùng thử; không suy rộng cho mọi học sinh hoặc tự ghi “có ý nghĩa thống kê”.

Trắc nghiệm đo một phần kiến thức trong sáu bài Arduino. Muốn kết luận về thực hành, cần bổ sung nhiệm vụ thực hành có tiêu chí chấm và người đối chiếu; không lấy dấu hoàn thành bài trên web làm điểm kỹ năng thực hành.

## Dữ liệu trên thiết bị

Ôn theo lỗi và đánh giá trước–sau dùng vùng lưu trữ riêng trong trình duyệt. Kết quả đánh giá không làm thay đổi lịch ôn, và xóa dữ liệu một chức năng không được xóa nhật ký học hoặc dữ liệu khác của website.

- Ôn theo lỗi gắn với người đang dùng trình duyệt, không phải tài khoản đã đăng nhập. Trước khi đổi người trên máy dùng chung, xuất dữ liệu nếu cần và dùng chức năng xóa dữ liệu ôn của khóa đó.
- Phần đánh giá phân biệt người tham gia bằng mã. Tạo đúng mã trước khi giao máy cho học sinh tiếp theo.
- Dữ liệu không tự đồng bộ giữa máy, trình duyệt hoặc tên miền khác nhau. Dùng CSV để tổng hợp từ nhiều thiết bị và kiểm tra mã không bị trùng.
- Xóa dữ liệu trình duyệt hoặc dùng chế độ riêng tư có thể làm mất kết quả. Khi website báo không lưu được, không coi lượt đó đã được lưu; xuất dữ liệu hoặc khắc phục trước khi khảo sát tiếp.
- Tệp JSON là bản sao để lưu giữ và kiểm tra; không phải lời hứa đã có đồng bộ hoặc khôi phục tự động.

## Nội dung nên trình bày khi bảo vệ đề tài

Giải thích vấn đề người học gặp, vì sao chọn ba quy tắc ôn tập, hệ thống lưu những gì và cách kiểm tra lựa chọn câu. Chạy một lượt có lỗi, xem gợi ý thay đổi rồi xuất kết quả thật. Sau đó trình bày cách tổ chức khảo sát, dữ liệu gốc, kết quả và những giới hạn còn lại.

Phân biệt phần thuật toán và giao diện tự thiết kế với thư viện, nền tảng mô phỏng và dịch vụ AI được sử dụng. Không tạo số liệu người học, lời nhận xét hoặc mức tăng điểm để minh họa như kết quả đã khảo sát.

## Kiểm tra kỹ thuật

Tại thư mục dự án:

```sh
node tests/quiz-service.mjs
node tests/adaptive-review.mjs
node tests/assessment-service.mjs
python3 tests/content-validation.py
```

Khởi động `node start-web.cjs`, rồi chạy kiểm tra trình duyệt:

```sh
python3 tests/ui-smoke.py --base http://127.0.0.1:5500 --chromium /usr/bin/chromium
python3 tests/learning-evidence-smoke.py --base http://127.0.0.1:5500 --chromium /usr/bin/chromium
```

Các kiểm thử dùng dữ liệu riêng và chặn dịch vụ bên ngoài. Kết quả kiểm thử phần mềm không thay thế khảo sát hiệu quả học tập.
