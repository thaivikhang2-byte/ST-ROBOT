# Chính sách Công cụ Quản trị (Management Tool Policy — v1.0.0)

## Phân loại Rủi ro Công cụ
- **R0 (Read-only):** Truy vấn thống kê tổng quan, danh sách chờ phê duyệt (ẩn thông tin nhạy cảm), trạng thái AI provider, thống kê sử dụng AI, cảnh báo vận hành, nhật ký hệ thống, tìm kiếm khóa học và tra cứu tài liệu chính sách (RAG).
- **R2 (Controlled Write — Yêu cầu xác nhận):**
  - `management_propose_course_draft`: Tạo đề xuất bản nháp khóa học (`CREATE_DRAFT`).
  - `management_prepare_announcement`: Chuẩn bị đề xuất thông báo hệ thống/khóa học (`PUBLISH_ANNOUNCEMENT`).
  - `management_create_admin_note`: Tạo đề xuất ghi chú quản trị lưu vết kiểm toán (`CREATE_ADMIN_NOTE`).
  - `management_update_course_info`: Đề xuất cập nhật tiêu đề/mô tả khóa học được phép (`UPDATE_COURSE_INFO`).
  - `management_propose_course_publish`: Đề xuất xuất bản khóa học từ trạng thái nháp (`PUBLISH_COURSE`).
- **R3 (Cấm thực thi tự động qua AI):** Gán vai trò quản trị tối cao, xóa tài khoản, thay đổi khóa mật mã Vault, chạy câu lệnh SQL/shell trực tiếp hoặc gọi URL nội bộ.

## Quy tắc Thực thi
- Chỉ gọi công cụ khi câu hỏi yêu cầu dữ liệu thời gian thực hoặc thao tác quản trị được phép.
- Kiểm tra công tắc an toàn (`AI Write Kill Switch`) trước mọi đề xuất R2.
- Nếu công cụ trả về lỗi từ chối phân quyền (`denied`) hoặc thất bại (`failed`), thông báo trung thực cho quản trị viên và không tự ý thử lách quyền.
