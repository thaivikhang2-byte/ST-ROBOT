import { ROUTES } from '../../constants/routes.js';

export const getNavbarTemplate = () => `
  <nav class="navbar navbar-expand-lg navbar-dark bg-dark sticky-top">
    <div class="container">
      <a class="navbar-brand" href="${ROUTES.HOME}">STEM ROBOTICS COURSE</a>
      <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#mainNavbar">
        <span class="navbar-toggler-icon"></span>
      </button>
      <div class="collapse navbar-collapse" id="mainNavbar">
        <ul class="navbar-nav ms-auto">
          <li class="nav-item"><a class="nav-link" href="${ROUTES.HOME}" data-path="${ROUTES.HOME}">Trang chủ</a></li>
          <li class="nav-item"><a class="nav-link" href="${ROUTES.GIOI_THIEU}" data-path="${ROUTES.GIOI_THIEU}">Giới thiệu</a></li>
          <li class="nav-item"><a class="nav-link" href="${ROUTES.KIT}" data-path="${ROUTES.KIT}">Kit & Khóa học</a></li>
          <li class="nav-item"><a class="nav-link" href="${ROUTES.QUIZ}" data-path="${ROUTES.QUIZ}">Quiz</a></li>
          <li class="nav-item"><a class="nav-link" href="${ROUTES.DANG_KY}" data-path="${ROUTES.DANG_KY}">Đăng ký</a></li>
        </ul>
        <button id="themeToggleBtn" class="btn btn-outline-info ms-lg-3">Dark Mode</button>
      </div>
    </div>
  </nav>
`;
