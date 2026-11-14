// ═══════════════════════════════════════════
// Config — Environment Validation Schema
// Validates .env at startup using Joi
// ═══════════════════════════════════════════

import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  // App
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  APP_PORT: Joi.number().default(3000),
  PORT: Joi.number().integer().min(1).max(65535).optional(),
  APP_NAME: Joi.string().default('ST-Robot-LMS'),
  API_PREFIX: Joi.string().default('api'),
  CORS_ORIGIN: Joi.string().default('*'),

  // Database
  DATABASE_URL: Joi.string().required(),

  // Redis
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),

  // JWT
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRATION: Joi.string()
    .pattern(/^[1-9]\d*[smhd]$/)
    .default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).invalid(Joi.ref('JWT_SECRET')).required(),
  JWT_REFRESH_EXPIRATION: Joi.string()
    .pattern(/^[1-9]\d*[smhd]$/)
    .default('7d'),
  JWT_ISSUER: Joi.string().optional(),
  JWT_AUDIENCE: Joi.string().optional(),
  TRUST_PROXY: Joi.string().allow('').default(''),

  // Mail
  MAIL_PROVIDER: Joi.string().valid('smtp', 'file').default('smtp'),
  MAIL_HOST: Joi.string().allow('').default(''),
  MAIL_PORT: Joi.number().default(587),
  MAIL_USER: Joi.string().allow('').default(''),
  MAIL_PASSWORD: Joi.string().allow('').default(''),
  MAIL_FROM: Joi.string().default('noreply@st-robot.com'),
  MAIL_SECURE: Joi.boolean().default(false),

  // CDN
  CDN_PROVIDER: Joi.string().valid('minio', 'r2', 's3', 'local').default('minio'),
  CDN_BUCKET: Joi.string().default('st-robot-uploads'),
  CDN_REGION: Joi.string().default('auto'),
  CDN_ENDPOINT: Joi.string().allow('').default(''),
  CDN_ACCESS_KEY: Joi.string().allow('').default(''),
  CDN_SECRET_KEY: Joi.string().allow('').default(''),

  // AI
  AI_PROVIDER: Joi.string().default('python'),
  AI_GATEWAY_URL: Joi.string().allow('').default(''),
  AI_GATEWAY_ENABLED: Joi.boolean().default(false),
  AI_REQUEST_TIMEOUT_MS: Joi.number().integer().min(1000).max(120000).default(60000),
  AI_GLOBAL_CONCURRENCY: Joi.number().integer().min(1).max(100).default(8),
  AI_FALLBACK_ENABLED: Joi.boolean().default(false),
  AI_MAX_APPLICATION_ATTEMPTS: Joi.number().integer().min(1).max(5).default(3),
  AI_MAX_PROVIDER_SWITCHES: Joi.number().integer().min(0).max(3).default(1),
  AI_RETRY_BASE_DELAY_MS: Joi.number().integer().min(10).max(10000).default(500),
  AI_RETRY_MAX_DELAY_MS: Joi.number().integer().min(10).max(30000).default(5000),
  AI_CIRCUIT_FAILURE_THRESHOLD: Joi.number().integer().min(1).max(20).default(3),
  AI_CIRCUIT_OPEN_TTL_MS: Joi.number().integer().min(100).max(600000).default(30000),
  AI_CACHE_ENABLED: Joi.boolean().default(true),
  AI_SEMANTIC_CACHE_ENABLED: Joi.boolean().default(true),
  AI_SEMANTIC_SIMILARITY_THRESHOLD: Joi.number().min(0.75).max(0.999).default(0.88),
  AI_CACHE_TTL_SECONDS: Joi.number().integer().min(30).max(86400).default(900),
  AI_CACHE_MAX_ENTRIES: Joi.number().integer().min(10).max(10000).default(500),
  AI_CF_GATEWAY_ENABLED: Joi.boolean().default(false),
  AI_CF_GATEWAY_URL: Joi.string().uri({ scheme: ['https'] }).allow('').default(''),
  AI_USAGE_RETENTION_DAYS: Joi.number().integer().min(0).max(3650).default(0),
  AI_PROVIDERS_CONFIG_PATH: Joi.string().allow('').optional(),
  AI_CREDENTIALS_MASTER_KEY: Joi.string().allow('').optional(),
  AI_CREDENTIALS_KEY_ID: Joi.string().default('master-v1'),
  AI_APPROVED_BASE_URLS: Joi.string().allow('').optional(),
  AI_ADMIN_ALLOW_LOCAL_HTTP: Joi.boolean().default(false),
  OPENAI_API_KEY: Joi.string().allow('').optional(),
  ANTHROPIC_API_KEY: Joi.string().allow('').optional(),
  OPENROUTER_API_KEY: Joi.string().allow('').optional(),
  CLOUDFLARE_WORKERS_AI_TOKEN: Joi.string().allow('').optional(),

  // Upload
  VIDEO_PROVIDER: Joi.string().valid('self-hosted', 'cloudflare').default('self-hosted'),
  VIDEO_WORKER_ENABLED: Joi.boolean().default(true),
  VIDEO_MAX_UPLOAD_BYTES: Joi.number().integer().min(1).max(536870912).default(536870912),
  VIDEO_MAX_DURATION_SECONDS: Joi.number().integer().min(1).max(14400).default(7200),
  VIDEO_PROCESSING_TIMEOUT_SECONDS: Joi.number().integer().min(10).max(7200).default(1800),
  VIDEO_FFMPEG_PATH: Joi.string().default('ffmpeg'),
  VIDEO_FFPROBE_PATH: Joi.string().default('ffprobe'),
  VIDEO_PLAYBACK_TTL_SECONDS: Joi.number().integer().min(30).max(900).default(300),
  VIDEO_SEGMENT_TTL_SECONDS: Joi.number().integer().min(5).max(60).default(30),
  VIDEO_PUBLIC_API_URL: Joi.string()
    .uri({ scheme: ['https', 'http'] })
    .allow('')
    .default(''),
  CLOUDFLARE_STREAM_ENABLED: Joi.boolean().default(false),
  CLOUDFLARE_ACCOUNT_ID: Joi.string()
    .pattern(/^[a-f0-9]{32}$/)
    .allow('')
    .default(''),
  CLOUDFLARE_STREAM_API_TOKEN: Joi.string().allow('').default(''),
  CLOUDFLARE_STREAM_CUSTOMER_CODE: Joi.string()
    .pattern(/^[a-z0-9-]+$/)
    .allow('')
    .default(''),
  CLOUDFLARE_STREAM_WEBHOOK_SECRET: Joi.string().allow('').default(''),
  STORAGE_PROVIDER: Joi.string().valid('disabled', 'minio', 's3', 'r2').default('disabled'),
  S3_ENDPOINT: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .allow('')
    .default(''),
  S3_PUBLIC_ENDPOINT: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .allow('')
    .default(''),
  S3_REGION: Joi.string().default('us-east-1'),
  S3_BUCKET: Joi.string().allow('').default(''),
  S3_ACCESS_KEY_ID: Joi.string().allow('').default(''),
  S3_SECRET_ACCESS_KEY: Joi.string().allow('').default(''),
  S3_FORCE_PATH_STYLE: Joi.boolean().default(true),
  MEDIA_MAX_UPLOAD_BYTES: Joi.number().integer().min(1).max(104857600).default(104857600),
  MEDIA_UPLOAD_URL_TTL_SECONDS: Joi.number().integer().min(1).max(900).default(900),
  MEDIA_DOWNLOAD_URL_TTL_SECONDS: Joi.number().integer().min(1).max(300).default(300),
  MEDIA_CDN_BASE_URL: Joi.string()
    .uri({ scheme: ['https'] })
    .allow('')
    .default(''),
  UPLOAD_MAX_SIZE: Joi.number().default(52428800),
  UPLOAD_ALLOWED_TYPES: Joi.string().default(
    'image/jpeg,image/png,image/webp,application/pdf,video/mp4',
  ),

  // Feature Flags
  FEATURE_AI_ENABLED: Joi.boolean().default(false),
  FEATURE_CHAT_ENABLED: Joi.boolean().default(false),
  FEATURE_CDN_ENABLED: Joi.boolean().default(false),
  FEATURE_REGISTRATION_ENABLED: Joi.boolean().default(true),
  FEATURE_NOTIFICATION_ENABLED: Joi.boolean().default(true),

  // Swagger
  SWAGGER_ENABLED: Joi.boolean().default(true),

  // Rate Limit
  THROTTLE_TTL: Joi.number().default(60),
  THROTTLE_LIMIT: Joi.number().default(100),

  // Secrets
  SECRETS_PROVIDER: Joi.string().valid('env', 'docker-secrets', 'vault').default('env'),

  // Logging
  METRICS_SCRAPE_TOKEN: Joi.string().min(32).allow('').default(''),
  OPS_HTTP_LOG_SAMPLE_RATE: Joi.number().min(0).max(1).default(0.1),
  OPS_REQUIRE_STORAGE: Joi.boolean().default(false),
  OPS_PROBE_TIMEOUT_MS: Joi.number().integer().min(100).max(10000).default(2000),
  OPS_ALERTS_ENABLED: Joi.boolean().default(false),
  OPS_ERROR_RATE_THRESHOLD: Joi.number().min(0.01).max(1).default(0.1),
  OPS_ERROR_MIN_REQUESTS: Joi.number().integer().min(1).max(100000).default(20),
  OPS_QUEUE_BACKLOG_THRESHOLD: Joi.number().integer().min(1).max(100000).default(100),
  OPS_AI_DAILY_COST_USD: Joi.number().min(0.01).max(100000).default(5),
  BACKUP_ENABLED: Joi.boolean().default(false),
  BACKUP_DIRECTORY: Joi.string().default('/app/backups'),
  BACKUP_ENCRYPTION_KEY: Joi.string().allow('').default(''),
  BACKUP_INTERVAL_HOURS: Joi.number().integer().min(1).max(168).default(24),
  BACKUP_RETENTION_DAYS: Joi.number().integer().min(1).max(365).default(14),
  BACKUP_TIMEOUT_SECONDS: Joi.number().integer().min(10).max(3600).default(600),
  BACKUP_MAX_BYTES: Joi.number().integer().min(1048576).max(107374182400).default(2147483648),
  PG_DUMP_PATH: Joi.string().default('pg_dump'),
  PG_RESTORE_PATH: Joi.string().default('pg_restore'),
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug', 'verbose').default('debug'),
  LOG_TRANSPORT: Joi.string().default('console'),

  // Retention
  RETENTION_AUDIT_DAYS: Joi.number().default(365),
  RETENTION_ANALYTICS_DAYS: Joi.number().default(180),
  RETENTION_LOGIN_HISTORY_DAYS: Joi.number().default(90),
  RETENTION_SOFT_DELETE_DAYS: Joi.number().default(90),
  RETENTION_ORPHAN_FILES_DAYS: Joi.number().default(30),
}).custom((value: Record<string, unknown>, helpers) => {
  if (value.BACKUP_ENABLED) {
    const key = typeof value.BACKUP_ENCRYPTION_KEY === 'string' ? value.BACKUP_ENCRYPTION_KEY : '';
    if (
      !/^[A-Za-z0-9+/]{43}=$/.test(key) ||
      Buffer.from(key, 'base64').length !== 32 ||
      key === value.AI_CREDENTIALS_MASTER_KEY
    )
      return helpers.error('any.custom', {
        message: 'Backups require a separate base64 32-byte encryption key',
      });
  }
  if (value.VIDEO_PUBLIC_API_URL) {
    try {
      if (typeof value.VIDEO_PUBLIC_API_URL !== 'string') return helpers.error('any.custom');
      const url = new URL(value.VIDEO_PUBLIC_API_URL);
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (value.NODE_ENV === 'production' && url.protocol !== 'https:')
      )
        return helpers.error('any.custom', {
          message: 'Video public API must be a clean HTTPS URL in production',
        });
    } catch {
      return helpers.error('any.custom', { message: 'Invalid video public API URL' });
    }
  }
  if (
    value.NODE_ENV === 'production' &&
    (value.CORS_ORIGIN === '*' || value.MAIL_PROVIDER !== 'smtp' || !value.MAIL_HOST)
  ) {
    return helpers.error('any.custom', {
      message: 'Production requires explicit CORS origin and SMTP delivery',
    });
  }
  return value;
});
