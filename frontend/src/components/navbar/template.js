import { ROUTES } from '../../constants/routes.js';
import { icon } from '../ui/icon.js';

export const NAV_ITEMS = [
    { href: ROUTES.HOME, label: 'Trang chủ' },
    { href: ROUTES.GIOI_THIEU, label: 'Giới thiệu' },
    { href: ROUTES.KIT, label: 'Bộ Kit' },
    { href: ROUTES.HOC_LIEU, label: 'Khóa học & Học liệu' },
    { href: ROUTES.COURSE_LEARNING, label: 'Tự học' },
    { href: ROUTES.QUIZ, label: 'Kiểm tra' },
];

export const getNavbarTemplate = () => `
  <a class="skip-link" href="#main">Bỏ qua điều hướng, tới nội dung chính</a>
  <nav class="navbar" aria-label="Điều hướng chính">
    <div class="container navbar-inner">
      <a class="navbar-brand" href="${ROUTES.HOME}" aria-label="ST-Robot — Trang chủ">${icon('logo')}<span>ST-Robot</span></a>
      <ul class="navbar-menu" id="mainNavbar">
        ${NAV_ITEMS.map((item) => `<li><a class="nav-link" href="${item.href}" data-path="${item.href}">${item.label}</a></li>`).join('')}
      </ul>
      <div class="navbar-actions">
        <a class="btn btn--primary btn--sm" href="${ROUTES.DANG_KY}" data-path="${ROUTES.DANG_KY}">Chọn khóa</a>
        <button id="themeToggleBtn" class="btn btn--ghost btn--icon" type="button" aria-pressed="false" aria-label="Chế độ tối">${icon('moon')}</button>
        <button id="navToggle" class="btn btn--ghost btn--icon navbar-toggle" type="button" aria-expanded="false" aria-controls="mainNavbar" aria-label="Mở menu">${icon('menu')}</button>
      </div>
    </div>
  </nav>
`;
