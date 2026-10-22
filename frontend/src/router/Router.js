export class Router {
    constructor(routes) {
        this.routes = routes;
    }

    init() {
        let currentPath = window.location.pathname;
        
        // Chuẩn hóa trailing slash để khớp URL chính xác hơn (ví dụ /frontend/public/ -> /frontend/public/index.html)
        if (currentPath.endsWith('/') && currentPath.length > 1) {
            // Khi ở thư mục gốc của public, tự động map vào index.html
            currentPath = currentPath + 'index.html';
        }

        let matchedRoute = this.routes.find(r => r.path === currentPath);
        
        // Cố gắng fallback nếu path bị thiếu index.html 
        // (Trong trường hợp server chặn trailing slash mà vẫn serve index.html)
        if (!matchedRoute && !currentPath.endsWith('.html')) {
             matchedRoute = this.routes.find(r => r.path === currentPath + '/index.html' || r.path === currentPath + 'index.html');
        }

        // Mặc định về trang chủ nếu không tìm thấy
        if (!matchedRoute) {
            matchedRoute = this.routes.find(r => r.path.endsWith('index.html'));
        }

        if (matchedRoute && matchedRoute.controller) {
            const controller = new matchedRoute.controller();
            controller.init();
        }
    }
}
