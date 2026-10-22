export const requestInterceptor = (options) => {
    // Add default headers like Authorization
    const headers = new Headers(options.headers || {});
    headers.set('Content-Type', 'application/json');
    
    // Example: headers.set('Authorization', `Bearer ${getToken()}`);
    
    return {
        ...options,
        headers
    };
};

export const responseInterceptor = async (response) => {
    if (!response.ok) {
        // Handle global errors here (e.g. 401 Unauthorized)
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Something went wrong');
    }
    
    // Return parsed JSON data
    return await response.json();
};
