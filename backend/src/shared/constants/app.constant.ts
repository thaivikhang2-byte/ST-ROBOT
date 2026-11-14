// ═══════════════════════════════════════════
// Shared Constants — App
// ═══════════════════════════════════════════

export const APP_CONSTANTS = {
  API_PREFIX: 'api',
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  SIGNED_URL_EXPIRY_SECONDS: 3600, // 1 hour
  VIDEO_SESSION_TTL_SECONDS: 7200, // 2 hours
  VIDEO_HEARTBEAT_INTERVAL_SECONDS: 30,
  MAX_UPLOAD_SIZE_BYTES: 52428800, // 50MB
  IDEMPOTENCY_TTL_SECONDS: 86400, // 24 hours
  REFRESH_TOKEN_FAMILY_LIMIT: 5,
} as const;
