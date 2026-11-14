// ═══════════════════════════════════════════
// Storage SDK — MIME Types Constants
// ═══════════════════════════════════════════

export const MIME_TYPES = {
  // Images
  JPEG: 'image/jpeg',
  PNG: 'image/png',
  WEBP: 'image/webp',
  GIF: 'image/gif',
  SVG: 'image/svg+xml',

  // Documents
  PDF: 'application/pdf',

  // Video
  MP4: 'video/mp4',
  WEBM: 'video/webm',

  // Audio
  MP3: 'audio/mpeg',

  // Archives
  ZIP: 'application/zip',
} as const;

export const IMAGE_MIME_TYPES = [
  MIME_TYPES.JPEG,
  MIME_TYPES.PNG,
  MIME_TYPES.WEBP,
  MIME_TYPES.GIF,
] as const;

export const VIDEO_MIME_TYPES = [
  MIME_TYPES.MP4,
  MIME_TYPES.WEBM,
] as const;

export const DOCUMENT_MIME_TYPES = [
  MIME_TYPES.PDF,
] as const;

export const ALLOWED_UPLOAD_TYPES = [
  ...IMAGE_MIME_TYPES,
  ...VIDEO_MIME_TYPES,
  ...DOCUMENT_MIME_TYPES,
] as const;
