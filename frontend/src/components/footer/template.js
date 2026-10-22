import { ROUTES } from '../../constants/routes.js';

export const getFooterTemplate = () => `
  <footer>
    <div class="container">
      <div class="row g-4">
        <div class="col-md-5">
          <h4 class="fw-bold">STEM Robotics Course</h4>
          <p>Hệ thống giới thiệu chương trình học phát triển tư duy sáng tạo kỹ thuật và lập trình điều khiển tự động.</p>
        </div>
        <div class="col-md-3">
          <h5 class="fw-bold">Danh mục</h5>
          <ul class="list-unstyled">
            <li><a href="${ROUTES.HOME}" class="footer-link">Trang chủ</a></li>
            <li><a href="${ROUTES.GIOI_THIEU}" class="footer-link">Giới thiệu khóa học</a></li>
            <li><a href="${ROUTES.KIT}" class="footer-link">Kit & khóa học</a></li>
            <li><a href="${ROUTES.QUIZ}" class="footer-link">Quiz</a></li>
            <li><a href="${ROUTES.DANG_KY}" class="footer-link">Đăng ký</a></li>
          </ul>
        </div>
        <div class="col-md-4">
          <h5 class="fw-bold">Định hướng</h5>
          <p>Học tập chủ động qua trải nghiệm thực tế, phát triển toàn diện tư duy logic thế hệ mới.</p>
        </div>
      </div>
      <hr style="border-color: #334155;">
      <div class="text-center mb-3">
        <a href="https://www.facebook.com/share/1Cks4cJt2F/" target="_blank" rel="noopener noreferrer" class="btn btn-primary rounded-circle d-inline-flex align-items-center justify-content-center" style="width: 48px; height: 48px; font-size: 24px; font-weight: 900; text-decoration: none;">f</a>
      </div>
      <p class="text-center mb-0 text-secondary">© 2026 STEM Robotics Lab - Đơn vị đào tạo phát triển giải pháp công nghệ</p>
    </div>
  </footer>
`;
