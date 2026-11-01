import { ROUTES } from '../../constants/routes.js';
import { NAV_ITEMS } from '../navbar/template.js';

export const getFooterTemplate = () => `
  <footer class="footer">
    <div class="container">
      <div class="footer-grid">
        <section aria-labelledby="footer-about">
          <h2 id="footer-about">ST-Robot</h2>
          <p>Nền tảng học STEM &amp; Robotics với lộ trình bài học, bài kiểm tra, phòng lab và trợ lý AI.</p>
        </section>
        <nav aria-labelledby="footer-nav">
          <h2 id="footer-nav">Điều hướng</h2>
          <ul>
            ${NAV_ITEMS.map((item) => `<li><a href="${item.href}">${item.label}</a></li>`).join('')}
            <li><a href="${ROUTES.DANG_KY}">Đăng ký lớp học</a></li>
          </ul>
        </nav>
        <section aria-labelledby="footer-contact">
          <h2 id="footer-contact">Kết nối</h2>
          <ul>
            <li><a href="https://www.facebook.com/share/1Cks4cJt2F/" rel="noopener noreferrer">Fanpage Facebook</a></li>
          </ul>
        </section>
      </div>
      <p class="footer-bottom">© 2026 STEM Robotics Lab. Nội dung học tập phục vụ mục đích giáo dục.</p>
    </div>
  </footer>
`;
