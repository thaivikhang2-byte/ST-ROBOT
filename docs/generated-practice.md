# Đề luyện tập tự động

Trang Kiểm tra tự phối ngân hàng 90 câu với bộ sinh câu mới. Bộ sinh gồm 60 dạng bài cho đủ 30 bài của 5 khóa; phiên bản v1 có 23.399 tổ hợp số liệu và tình huống khác nhau. Đây là số biến thể theo mẫu, không phải 23.399 kỹ năng độc lập.

## Cách dùng

Chọn khóa, bài, mức **Dễ / Vừa / Khó**, số câu rồi bấm **Bắt đầu làm bài**. Lượt cả khóa có 6/12/18 câu chia đều sáu bài. Luyện một bài có thể chọn 3/6/9/12 câu. Không cần chọn nguồn câu hoặc bật AI.

Dễ chọn nhóm nhiệm vụ có mức thấp nhất trong từng bài; Khó chọn nhóm có mức cao nhất; Vừa luân phiên các nhóm có sẵn. Một số bài robot nâng cao bắt đầu ở vận dụng, nên mức được chọn theo từng bài để giữ đủ phạm vi. Các mức phản ánh loại nhiệm vụ đã thiết kế, chưa phải độ khó hiệu chuẩn bằng kết quả học sinh. Với câu ngân hàng, ba mức tương ứng các nhóm nền tảng, vận dụng và suy luận.

Phần lớn đề dùng biến thể từ bộ sinh. Ngân hàng bổ sung tối đa một câu mỗi bài và tối đa phần nguyên của số câu chia bốn; câu ngân hàng đã làm gần đây được bỏ qua. Mỗi lượt vẫn đủ số câu yêu cầu và chia đều nếu chọn cả khóa. Chỉ lượt hoàn thành mới được ghi vào hồ sơ; câu sai có thể mở lại chính xác qua **Ôn theo kết quả**.

Mỗi lượt tránh câu trùng và ưu tiên bỏ qua câu đã làm trong hồ sơ còn lưu. Nếu một phạm vi nhỏ đã dùng hết câu mới, hệ thống giảm dần cửa sổ lịch sử; ghi chú xoay vòng nằm trong phần dữ liệu. Các câu trong cùng lượt vẫn khác nhau; không tuyên bố sinh vô hạn. Lịch sử và công cụ tải/xóa nằm trong **Tiến độ và dữ liệu** để màn hình tạo đề gọn hơn.

## Đáp án được kiểm tra thế nào?

Mẫu quy định rõ dữ kiện, miền tham số, đơn vị và mô hình. Chương trình dựng câu, tính đáp án và phương án nhiễu, xử lý làm tròn, loại phương án trùng. Ví dụ LED dùng công thức với Vf cố định; bài chuyển động nêu giả định lý tưởng; bài cảm biến phân biệt số đo hợp lệ với timeout.

Các kiểm thử duyệt toàn bộ 23.399 biến thể, xác nhận không trùng câu trong tập phát hành, đối chiếu nhiều công thức/logic bằng bộ tính độc lập và kiểm tra các biên. Điều này xác nhận tính nhất quán trong phạm vi mẫu và giả định. Độ rõ nghĩa với học sinh, độ khó thực tế và hiệu quả học tập vẫn cần dữ liệu sử dụng; không suy ra ưu thế so với giáo viên chỉ từ số câu hoặc số kiểm thử.

ID `gen:v1:<mẫu>:<số-biến-thể>` tái tạo đúng câu, thứ tự lựa chọn và đáp án, nên hồ sơ chỉ cần lưu ID cùng lựa chọn. Sau phát hành, giữ nguyên định nghĩa v1, định dạng số và thứ tự phương án của v1. Khi sửa ý nghĩa của mẫu, tạo phiên bản hoặc ID mới và duy trì bộ đọc cũ; tránh diễn giải lại câu trả lời đã lưu bằng một đáp án khác.

## Vai trò của AI

Khi bắt đầu, trình duyệt tự gửi khóa, bài, mức, số câu và ID các bài có câu trả lời gần nhất còn sai đến `/api/practice-plan`. API lọc danh sách mẫu theo đúng mức và phạm vi, gửi mục tiêu bài học cùng danh sách mẫu cho mô hình, nhận lại ID mẫu. Không gửi tên học sinh, hội thoại, nhật ký, đề trước–sau hay đáp án trắc nghiệm cho tác vụ này. Với mức Vừa, mẫu AI ưu tiên của mỗi bài quyết định nhóm nhiệm vụ của câu sinh đầu tiên, sau đó luân phiên các nhóm; Dễ và Khó giữ nhóm đã quy định theo bài. Đề cả khóa vẫn chia đều sáu bài.

AI lựa chọn dạng bài; chương trình vẫn dựng và tính câu hỏi. Phản hồi AI cần đúng cấu trúc, không trùng ID và nằm trong phạm vi, mức độ. Dữ liệu lạ, mất kết nối, hết hạn mức hoặc chờ quá 4 giây sẽ chuyển sang bộ chọn tại chỗ. Sau lỗi, trình duyệt dùng bộ chọn tại chỗ trong 60 giây để tránh gọi liên tục. Kế hoạch hợp lệ được giữ tối đa 5 phút theo khóa/bài/mức/số câu/nhóm bài cần ôn; mỗi đề vẫn có biến thể mới. Có thể hủy trong lúc chuẩn bị đề; đổi lựa chọn sẽ bỏ phản hồi cũ. Nguồn xử lý lưu trong trạng thái kỹ thuật, không thêm nhãn nguồn hoặc cam kết AI lên màn hình làm bài.

API dùng cấu hình `WOKU_API_KEY`, `AI_MODEL` và `ALLOWED_ORIGIN` đang có của AI server. Hạn mức ngày, tốc độ và số yêu cầu đồng thời dùng chung với chat/tutor. Các hạn mức này ở trong tiến trình hiện tại; khi triển khai nhiều bản sao máy chủ cần bộ đếm dùng chung và xác thực phù hợp.

Sau khi cập nhật GitHub, AI server cũng cần chạy phiên bản có `/api/practice-plan`. Nếu máy chủ đang dùng mã cũ hoặc chưa có khóa, chức năng sinh tại chỗ vẫn dùng được. Khóa API luôn nằm ở máy chủ. Kiểm thử API dùng HTTP thật với mô hình giả lập, không thay cho đánh giá chất lượng lựa chọn của mô hình đang triển khai.

## Dữ liệu và đánh giá trước–sau

Ngân hàng 90 câu và 24 câu A/B giữ nguyên. Bộ sinh không dùng hai đề A/B làm đầu vào. Đề đánh giá vẫn cố định theo phiên bản trong mỗi đợt khảo sát.

Lượt đề tự động nằm trong hồ sơ ôn. Điểm hiển thị trong lịch sử được tính lại từ câu hỏi chuẩn và lựa chọn đã lưu, lọc đúng phạm vi; lịch sử quiz cũ vẫn được hiển thị và không bị ghi đè. Điểm các lượt luyện giúp xem lại kết quả, không dùng thay báo cáo đánh giá trước–sau. Xuất JSON và xóa theo khóa bao gồm các lượt tự động. Nhật ký học và dữ liệu đánh giá trước–sau giữ vùng lưu trữ riêng. Hồ sơ hiện thuộc trình duyệt, nên khi đổi học sinh trên máy chung cần xuất và đặt lại dữ liệu phù hợp.

## Nguồn và bản dựng máy chủ

`frontend/src/modules/quiz/generation` là nguồn chính. `DifficultyPolicy.js` dùng chung chính sách mức độ; `AutomaticPractice.js` phối câu và cân bằng đề ở trình duyệt. `scripts/build-practice-engine.mjs` tạo bản sao bộ sinh và chính sách cho máy chủ trong `ai-server/generation`, kèm danh mục khóa/bài; bộ AI server có thể triển khai độc lập với thư mục gốc là `ai-server`. Tránh sửa trực tiếp bản sinh.

Sau khi sửa nguồn:

```sh
node scripts/build-practice-engine.mjs
node scripts/build-practice-engine.mjs --check
node tests/generated-question-engine.mjs
node tests/automatic-practice.mjs
node tests/generated-creative.mjs
node tests/generated-robotics.mjs
node tests/generated-review.mjs
node tests/practice-plan.mjs
```

Khởi động `node start-web.cjs` rồi chạy `python3 tests/generated-practice-smoke.py --base http://127.0.0.1:5500`. Bộ kiểm tra dùng generator thật cho câu hỏi; chỉ giả lập kết nối AI để kiểm tra các nhánh thành công, lỗi, hủy và timeout. Kết quả ghi ngoài thư mục dự án.
