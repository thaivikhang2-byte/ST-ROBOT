export const AppConfig = {
    // Cấu hình linh hoạt cho Live Server mặc định. 
    // Thay đổi giá trị này thành '' hoặc '/sub-dir' nếu deploy sang môi trường khác.
BASE_PATH: new URL('../../public/', import.meta.url).pathname.replace(/\/$/, ''),    API_URL: 'http://localhost:3000/api',
    CDN_URL: ''
};

