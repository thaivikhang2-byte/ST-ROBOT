// Public configuration only. Set this to the deployed NestJS API root, including /api.
// Never put passwords, tokens or provider keys in this file.
export const BACKEND_CONFIG = Object.freeze({
    apiBaseUrl: '',
});

export function resolveBackendUrl(configured = BACKEND_CONFIG.apiBaseUrl, hostname = globalThis.location?.hostname || '') {
    const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
    if (!configured) return local ? 'http://localhost:3000/api' : '';
    try {
        const url = new URL(configured);
        const localApi = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (url.username || url.password || url.search || url.hash ||
            (url.protocol !== 'https:' && !(localApi && url.protocol === 'http:'))) return '';
        return url.href.replace(/\/+$/, '');
    } catch { return ''; }
}
