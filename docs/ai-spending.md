# Tiết kiệm credit AI đến ngày thi 12/12

Shop báo 7.000đ đổi 1 USD credit, hạn dùng ba tháng. Đây là credit tính theo lượt/token và giá model, không xác định được số câu hỏi chỉ từ số tiền nạp. Danh sách API key trống ở đúng tài khoản chưa đủ để xác định hết tiền; shop cần đối soát khóa, số dư và nhật ký trừ credit.

## Khôi phục quyền dùng API

Trước khi nạp tiếp, nhờ shop xác nhận ba điểm:

1. Tài khoản/đơn hàng nào sở hữu credit đã mua, vì sao danh sách khóa trống, khóa cũ còn hiệu lực hay đã bị thu hồi.
2. Credit đã cấp, số dư hiện tại và các lượt trừ gần nhất (thời điểm, model, token, tiền).
3. Model giá thấp có hỗ trợ gọi công cụ; giá đầu vào và đầu ra theo USD/1 triệu token. Tên model hoặc việc tra được `/models` không xác nhận giá/quyền gọi thực tế.

Nếu cần thay khóa, admin nhập khóa tại cấu hình AI trong tài khoản ST-Robot. Không gửi khóa vào hội thoại hỗ trợ công khai. Không cần xóa database hoặc tạo lại tài khoản học sinh.

## Thay đổi tiết kiệm tự động

Sau khi backend mới Live, chế độ tiết kiệm mặc định được bật:

- Mỗi câu hỏi agent có tối đa hai lượt gọi provider, mỗi lượt chỉ một lần dispatch, không tự thử lại lỗi hoặc tự chuyển provider. Lượt cuối dùng kết quả công cụ đã có để trả lời; các giới hạn và quyền quản trị cũ vẫn áp dụng.
- Giới hạn đầu ra 700 token/lượt. Câu trả lời vẫn giữ mã hoặc các bước cần thiết, hạn chế giải thích dài không cần thiết.
- Chỉ gửi tối đa hai lượt hội thoại cũ trong 10.000 byte, giữ nguyên nhóm gọi công cụ/kết quả và chữ ký provider. Không cắt giữa JSON hoặc chữ ký. Ghi chú/mã của bài đang chọn vẫn được giữ; lịch sử chi tiết đọc qua công cụ có quyền khi cần.
- Rút gọn phần tổng quan tài khoản, giảm tài liệu RAG gửi kèm. Giá model xét cả đầu vào lẫn đầu ra đã xác nhận; ưu tiên model phù hợp trong cùng provider đã cấu hình. Không đoán giá từ tên model.
- Cache vẫn tách theo người học, quyền, model và ngữ cảnh. Không dùng câu trả lời cá nhân của người khác để tiết kiệm tiền.

Chế độ tiết kiệm không tự mua/nạp credit và không thay khóa đã lưu. Không thể bảo đảm 1 USD dùng đến ngày thi khi chưa có bảng giá và mức dùng thực tế.

## Đặt trần chi phí dùng chung

Admin mở **Tài khoản → Cấu hình AI → Chi phí và hạn mức AI**. Mở bảng này chỉ đọc metadata; không gửi câu hỏi thử hoặc gọi model tính phí.

Gợi ý cho lần nạp mới đủ 1 USD:

| Mục | Giá trị |
| --- | --- |
| Ngân sách cả kỳ | 1,00 USD credit |
| Hạn mức trước ngày thi | 0,03 USD/ngày |
| Credit dành cho ngày thi | 0,40 USD |
| Bắt đầu tính | Thời điểm bắt đầu dùng lần nạp mới |
| Bắt đầu dùng phần dành riêng | 00:00 ngày 12/12, giờ Việt Nam |
| Kết thúc | 00:00 ngày 13/12, giờ Việt Nam |

Nếu số dư thực tế nhỏ hơn 1 USD, dùng số dư đã được shop xác nhận thay cho 1 USD. Tổng là ngân sách cho toàn website và tất cả tài khoản, không phải mỗi học sinh một ví riêng. Trước 12/12, hệ thống giữ lại 0,40 USD; trong ngày thi, hạn mức ngày được nâng ít nhất bằng khoản này, tổng cả kỳ vẫn là trần cuối.

Chọn đúng model, điền giá đầu vào/đầu ra do Woku cung cấp và tích xác nhận bảng giá. Bật **Chặn lượt gọi mới khi đạt ngân sách** rồi bấm lưu. Không có giá đã xác nhận thì không bật chặn USD; không coi giá chưa rõ là miễn phí. Có thể dùng chế độ tiết kiệm riêng trong khi chờ shop trả lời.

Trần này tính theo giá admin đã nhập và usage provider báo, không đọc được ví Woku và không thay thế hóa đơn shop. Hệ thống giữ trước chi phí thận trọng bằng giới hạn token nhân mức giá cao hơn, dưới khóa DB dùng chung; các lượt đang chạy cũng được tính. Khi có usage thật sẽ đối soát. Mất usage hoặc hết hạn reservation không tự coi lượt có thể đã tính phí là miễn phí. Giá hoặc cách quy đổi sai vẫn có thể làm dự toán khác hóa đơn; cần đối chiếu nhật ký shop.

## Đường gọi cũ và ảnh

AI có tài khoản dùng backend quản lý ngân sách. Khách được yêu cầu đăng nhập. Các API sinh nội dung cũ ở `ai-server` mặc định tắt, kể cả đang có khóa trong environment. Chỉ người vận hành chủ động đặt `LEGACY_AI_GENERATION_ENABLED=true` mới mở lại; kênh đó nằm ngoài trần USD của backend và không nên bật khi dùng chung 1 USD credit.

Trong chế độ tiết kiệm hoặc đang bật chặn ngân sách, ảnh không được chuyển sang dịch vụ cũ. Website báo rõ ảnh chưa gửi và đề nghị nhập nội dung lỗi bằng chữ. Không tự bỏ ảnh rồi trả lời như đã xem. Muốn khôi phục kênh ảnh cũ cần chủ động tắt hai hạn chế và bật legacy riêng; việc này không còn được bảo vệ bởi ngân sách chung.

Tài liệu, mô hình lab, lưu bài, tiến độ và bài kiểm tra thường vẫn dùng khi AI tạm dừng vì quota. Trước ngày thi nên thử vài câu ngắn cần trình diễn, xem bảng chi phí rồi giữ phần credit còn lại; không có job tự hỏi AI để giữ máy chủ thức.

## Kiểm chứng và triển khai

Migration `20261126000000_ai_spend_policy` chỉ thêm chính sách và cột giữ chỗ, không sửa khóa hoặc usage cũ. Backend startup tự áp dụng khi deploy. Frontend có cache version mới. Nếu Render không tự cập nhật, chọn **strobot-backend → Manual Deploy → Deploy latest commit**, chờ Live rồi tải lại website.

Kiểm thử dùng provider giả lập và database riêng: kiểm tra số dispatch, lịch sử/chữ ký, quota dùng chung, USD đang giữ chỗ, dự phòng ngày thi, quyền admin, TLS, CAS, unknown cost và đường legacy. Không gọi Woku tính phí hoặc xác nhận khóa thật trong môi trường này.
