export const LAB_FILE_LIMITS = Object.freeze({ count: 4, fileBytes: 256 * 1024, totalBytes: 256 * 1024, name: 120, encodedLength: 349528 });

export const LAB_FILE_EXTENSIONS = Object.freeze({
    circuit: ['.txt'],
    avr: ['.ino', '.cpp', '.c', '.h', '.txt', '.zip'],
    wokwi: ['.ino', '.cpp', '.c', '.h', '.json', '.txt', '.zip'],
    python: ['.py', '.hex', '.json', '.zip'],
    gears: ['.py', '.xml', '.json', '.zip'],
    phet: [], local: [],
    scratch: ['.sb3', '.json', '.txt', '.zip'],
    arcade: ['.png', '.ts', '.js', '.py', '.json', '.hex', '.zip'],
});

const knownExtensions = new Set(Object.values(LAB_FILE_EXTENSIONS).flat());
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export function safeLabFileName(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= LAB_FILE_LIMITS.name
        && !/[\/\\\u0000-\u001f\u007f]/.test(value) && !value.includes('..')
        && !['__proto__', 'prototype', 'constructor'].includes(value);
}

export const labFileExtension = name => typeof name === 'string' ? (name.match(/\.[a-z0-9]+$/i)?.[0] || '').toLowerCase() : '';

export function decodeLabFile(dataBase64) {
    if (typeof dataBase64 !== 'string' || dataBase64.length > LAB_FILE_LIMITS.encodedLength
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(dataBase64))
        throw new Error('Tệp bài làm không đúng định dạng.');
    let binary;
    try { binary = atob(dataBase64); } catch { throw new Error('Tệp bài làm không đúng định dạng.'); }
    if (binary.length > LAB_FILE_LIMITS.fileBytes || btoa(binary) !== dataBase64)
        throw new Error('Mỗi tệp bài làm cần nhỏ hơn hoặc bằng 256 KiB.');
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export function encodeLabFile(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > LAB_FILE_LIMITS.fileBytes)
        throw new Error('Mỗi tệp bài làm cần nhỏ hơn hoặc bằng 256 KiB.');
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(binary);
}

export function normalizeLabFiles(value, platformKey) {
    if (!Array.isArray(value) || value.length > LAB_FILE_LIMITS.count)
        throw new Error('Mỗi bài lưu tối đa 4 tệp.');
    const allowed = platformKey === undefined ? knownExtensions : new Set(LAB_FILE_EXTENSIONS[platformKey] || []);
    const names = new Set();
    let total = 0;
    return value.map(file => {
        if (!plain(file) || Object.keys(file).length !== 2 || !Object.hasOwn(file, 'name')
            || !Object.hasOwn(file, 'dataBase64') || !safeLabFileName(file.name)
            || !allowed.has(labFileExtension(file.name))) throw new Error('Tệp không phù hợp với nền tảng đang chọn.');
        const name = file.name.toLowerCase();
        if (names.has(name)) throw new Error('Các tệp trong một bài cần có tên khác nhau.');
        names.add(name);
        total += decodeLabFile(file.dataBase64).byteLength;
        if (total > LAB_FILE_LIMITS.totalBytes) throw new Error('Tổng tệp của một bài không được vượt 256 KiB.');
        return { name: file.name, dataBase64: file.dataBase64 };
    });
}
