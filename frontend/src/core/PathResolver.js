import { AppConfig } from '../config/app.config.js';

export const PathResolver = {
    /**
     * Resolve đường dẫn tĩnh (ảnh, icon...) bằng new URL()
     * Relative to src/core/ => ../assets/
     */
    asset: (relativePath) => {
        return new URL('../assets/' + relativePath, import.meta.url).href;
    },

    /**
     * Resolve đường dẫn trang HTML trong public/
     */
    page: (pageName) => {
        const base = AppConfig.BASE_PATH.endsWith('/') ? AppConfig.BASE_PATH : AppConfig.BASE_PATH + '/';
        const normalized = pageName.startsWith('/') ? pageName.slice(1) : pageName;
        return base + normalized;
    },

    /**
     * Resolve đường dẫn gọi API Backend
     */
    api: (endpoint) => {
        const base = AppConfig.API_URL.endsWith('/') ? AppConfig.API_URL : AppConfig.API_URL + '/';
        const normalized = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
        return base + normalized;
    }
};
