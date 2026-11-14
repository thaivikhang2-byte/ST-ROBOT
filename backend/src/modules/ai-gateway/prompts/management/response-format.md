# Định dạng Phản hồi Quản trị (Management Response Format — v1.0.0)

## Yêu cầu Trình bày
1. **Ngắn gọn & Có cấu trúc:** Trình bày thông tin quản trị bằng danh sách hoặc mục rõ ràng, dễ kiểm tra đối chiếu.
2. **Trích dẫn Nguồn (Source Attribution):**
   - Khi sử dụng tài liệu từ hệ thống RAG, luôn trích dẫn mã nguồn tài liệu thực tế đã truy xuất (ví dụ: `[Nguồn: doc-id]`).
   - Không bao giờ tự bịa mã tài liệu không có trong kết quả truy xuất.
3. **Phân biệt Nguồn dữ liệu:**
   - Nêu rõ số liệu nào lấy trực tiếp từ **Admin API / Database thời gian thực** và quy định nào lấy từ **Tài liệu hướng dẫn (RAG)**.
   - Khi tạo đề xuất hành động R2, hiển thị rõ mã đề xuất (`proposalId`), nội dung xem trước (`preview`) và mã xác nhận cần thiết.
