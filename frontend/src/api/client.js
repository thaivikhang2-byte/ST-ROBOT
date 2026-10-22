import { API_CONFIG } from '../config/api.config.js';
import { requestInterceptor, responseInterceptor } from './interceptor.js';

class ApiClient {
    constructor(baseURL) {
        this.baseURL = baseURL;
    }

    async request(endpoint, options = {}) {
        let url = `${this.baseURL}${endpoint}`;
        
        // Apply request interceptor
        options = requestInterceptor(options);

        try {
            const response = await fetch(url, options);
            
            // Apply response interceptor
            const data = await responseInterceptor(response);
            return data;
        } catch (error) {
            console.error('API Request failed:', error);
            throw error;
        }
    }

    get(endpoint, options = {}) {
        return this.request(endpoint, { ...options, method: 'GET' });
    }

    post(endpoint, body, options = {}) {
        return this.request(endpoint, {
            ...options,
            method: 'POST',
            body: JSON.stringify(body)
        });
    }
}

export const api = new ApiClient(API_CONFIG.BASE_URL);
