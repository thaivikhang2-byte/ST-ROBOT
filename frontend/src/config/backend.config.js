// Public configuration only. Set this to the deployed NestJS API root, including /api.
// Never put passwords, tokens or provider keys in this file.
export const BACKEND_CONFIG = Object.freeze({
    apiBaseUrl: 'https://strobot-backend.onrender.com/api',
});

export function resolveBackendUrl(configured, hostname = globalThis.location?.hostname || '') {
    const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
    // Local development keeps its own database unless a caller explicitly selects another API.
    if (configured === undefined) configured = local ? '' : BACKEND_CONFIG.apiBaseUrl;
    if (!configured) return local ? 'http://localhost:3000/api' : '';
    try {
        const url = new URL(configured);
        const localApi = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (url.username || url.password || url.search || url.hash ||
            (url.protocol !== 'https:' && !(localApi && url.protocol === 'http:'))) return '';
        return url.href.replace(/\/+$/, '');
    } catch { return ''; }
}
