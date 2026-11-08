export const MAX_TUTOR_IMAGES = 2;
export const MAX_TUTOR_IMAGE_BYTES = 1536 * 1024;
export const MAX_TUTOR_TOTAL_IMAGE_BYTES = MAX_TUTOR_IMAGES * MAX_TUTOR_IMAGE_BYTES;
export const TEXT_REQUEST_BYTES = 24000;
// Base64 expands by 4/3. The existing text envelope remains available beside
// the images, while the other API routes retain their original body limit.
export const TUTOR_REQUEST_BYTES = 4 * Math.ceil(MAX_TUTOR_TOTAL_IMAGE_BYTES / 3) + TEXT_REQUEST_BYTES;

export class TutorImageError extends Error {
  constructor(status = 400) {
    super(status === 413
      ? 'Ảnh vượt quá dung lượng cho phép. Hãy chọn tối đa 2 ảnh, mỗi ảnh không quá 1,5 MB.'
      : 'Hãy chọn tối đa 2 ảnh PNG, JPEG hoặc WebP hợp lệ rồi gửi lại.');
    this.name = 'TutorImageError';
    this.status = status;
    this.code = status === 413 ? 'AI_IMAGE_TOO_LARGE' : 'AI_IMAGE_INVALID';
  }
}

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function matchesImageType(bytes, type) {
  if (type === 'png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(pngSignature);
  if (type === 'jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP'
    && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16));
}

// No URLs are fetched and no image data enters conversation history. Accept
// only canonical browser data URLs and check bytes independently of their MIME.
export function validateTutorImages(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_TUTOR_IMAGES) throw new TutorImageError();
  let totalBytes = 0;
  return value.map(image => {
    if (!image || typeof image !== 'object' || Array.isArray(image)
      || Object.keys(image).length !== 1 || typeof image.dataUrl !== 'string') throw new TutorImageError();
    const prefix = /^data:image\/(png|jpeg|webp);base64,/.exec(image.dataUrl);
    if (!prefix) throw new TutorImageError();
    const encoded = image.dataUrl.slice(prefix[0].length);
    if (encoded.length > 4 * Math.ceil(MAX_TUTOR_IMAGE_BYTES / 3)) throw new TutorImageError(413);
    if (!encoded.length || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new TutorImageError();
    const bytes = Buffer.from(encoded, 'base64');
    totalBytes += bytes.length;
    if (bytes.length > MAX_TUTOR_IMAGE_BYTES || totalBytes > MAX_TUTOR_TOTAL_IMAGE_BYTES) throw new TutorImageError(413);
    if (bytes.toString('base64') !== encoded || !matchesImageType(bytes, prefix[1])) throw new TutorImageError();
    return { dataUrl: image.dataUrl };
  });
}
