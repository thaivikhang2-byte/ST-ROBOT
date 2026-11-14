// ═══════════════════════════════════════════
// Config — Configuration Namespaces
// Typed config getters for each section
// ═══════════════════════════════════════════

import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.APP_PORT || process.env.PORT || '3000', 10),
  name: process.env.APP_NAME || 'ST-Robot-LMS',
  apiPrefix: process.env.API_PREFIX || 'api',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  trustProxy: process.env.TRUST_PROXY || '',
  swaggerEnabled: process.env.SWAGGER_ENABLED === 'true',
}));

export const loggingConfig = registerAs('logging', () => ({
  level: process.env.LOG_LEVEL || 'info',
  httpSampleRate: Number(process.env.OPS_HTTP_LOG_SAMPLE_RATE || '0.1'),
  secrets: [
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'MAIL_PASSWORD',
    'S3_SECRET_ACCESS_KEY',
    'AI_CREDENTIALS_MASTER_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'METRICS_SCRAPE_TOKEN',
    'BACKUP_ENCRYPTION_KEY',
    'CLOUDFLARE_STREAM_API_TOKEN',
  ]
    .map((key) => process.env[key] || '')
    .filter(Boolean),
}));

export const operationsConfig = registerAs('operations', () => ({
  metricsToken: process.env.METRICS_SCRAPE_TOKEN || '',
  requireStorage: process.env.OPS_REQUIRE_STORAGE === 'true',
  probeTimeoutMs: Number(process.env.OPS_PROBE_TIMEOUT_MS || '2000'),
  alertsEnabled: process.env.OPS_ALERTS_ENABLED === 'true',
  errorRate: Number(process.env.OPS_ERROR_RATE_THRESHOLD || '0.1'),
  minRequests: Number(process.env.OPS_ERROR_MIN_REQUESTS || '20'),
  queueBacklog: Number(process.env.OPS_QUEUE_BACKLOG_THRESHOLD || '100'),
  aiDailyCost: Number(process.env.OPS_AI_DAILY_COST_USD || '5'),
  backupEnabled: process.env.BACKUP_ENABLED === 'true',
  backupDirectory: process.env.BACKUP_DIRECTORY || '/app/backups',
  backupKey: process.env.BACKUP_ENCRYPTION_KEY || '',
  backupIntervalHours: Number(process.env.BACKUP_INTERVAL_HOURS || '24'),
  backupRetentionDays: Number(process.env.BACKUP_RETENTION_DAYS || '14'),
  backupTimeoutSeconds: Number(process.env.BACKUP_TIMEOUT_SECONDS || '600'),
  backupMaxBytes: Number(process.env.BACKUP_MAX_BYTES || '2147483648'),
  pgDump: process.env.PG_DUMP_PATH || 'pg_dump',
  pgRestore: process.env.PG_RESTORE_PATH || 'pg_restore',
  childEnvironment: {
    PATH: process.env.PATH || '',
    ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot || '' } : {}),
  },
}));

export const databaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL,
}));

export const redisConfig = registerAs('redis', () => ({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
}));

export const jwtConfig = registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET,
  expiration: process.env.JWT_EXPIRATION || '15m',
  refreshSecret: process.env.JWT_REFRESH_SECRET,
  refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
  issuer: process.env.JWT_ISSUER || undefined,
  audience: process.env.JWT_AUDIENCE || undefined,
}));

export const mailConfig = registerAs('mail', () => ({
  provider: process.env.MAIL_PROVIDER || 'smtp',
  host: process.env.MAIL_HOST,
  port: parseInt(process.env.MAIL_PORT || '587', 10),
  user: process.env.MAIL_USER,
  password: process.env.MAIL_PASSWORD,
  from: process.env.MAIL_FROM || 'noreply@st-robot.com',
  secure: process.env.MAIL_SECURE === 'true',
  outbox: process.env.MAIL_OUTBOX || '.mail-outbox',
}));

export const cdnConfig = registerAs('cdn', () => ({
  provider: process.env.CDN_PROVIDER || 'minio',
  bucket: process.env.CDN_BUCKET || 'st-robot-uploads',
  region: process.env.CDN_REGION || 'auto',
  endpoint: process.env.CDN_ENDPOINT,
  accessKey: process.env.CDN_ACCESS_KEY,
  secretKey: process.env.CDN_SECRET_KEY,
}));

export const aiConfig = registerAs('ai', () => ({
  provider: process.env.AI_PROVIDER || 'python',
  gatewayUrl: process.env.AI_GATEWAY_URL,
  enabled: process.env.AI_GATEWAY_ENABLED === 'true',
}));

export const aiVaultConfig = registerAs('aiVault', () => ({
  path: process.env.AI_PROVIDERS_CONFIG_PATH || 'config/ai-providers.enc.json',
  masterKey: process.env.AI_CREDENTIALS_MASTER_KEY || '',
  keyId: process.env.AI_CREDENTIALS_KEY_ID || 'master-v1',
  allowedEndpoints: (
    process.env.AI_APPROVED_BASE_URLS ||
    'https://api.openai.com/v1,https://api.anthropic.com,https://generativelanguage.googleapis.com,https://openrouter.ai/api/v1,https://api.cloudflare.com/client/v4,https://gateway.ai.cloudflare.com/v1'
  )
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean),
  allowLocalAdminHttp:
    process.env.AI_ADMIN_ALLOW_LOCAL_HTTP === 'true' && process.env.NODE_ENV !== 'production',
}));

export const uploadConfig = registerAs('upload', () => ({
  maxSize: parseInt(process.env.UPLOAD_MAX_SIZE || '52428800', 10),
  allowedTypes: (process.env.UPLOAD_ALLOWED_TYPES || '').split(',').filter(Boolean),
}));

export const storageConfig = registerAs('storage', () => ({
  provider: process.env.STORAGE_PROVIDER || 'disabled',
  endpoint: process.env.S3_ENDPOINT || '',
  publicEndpoint: process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT || '',
  region: process.env.S3_REGION || 'us-east-1',
  bucket: process.env.S3_BUCKET || '',
  accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  maxBytes: parseInt(process.env.MEDIA_MAX_UPLOAD_BYTES || '104857600', 10),
  uploadTtl: parseInt(process.env.MEDIA_UPLOAD_URL_TTL_SECONDS || '900', 10),
  downloadTtl: parseInt(process.env.MEDIA_DOWNLOAD_URL_TTL_SECONDS || '300', 10),
  cdnBaseUrl: process.env.MEDIA_CDN_BASE_URL || '',
}));

export const videoConfig = registerAs('video', () => ({
  provider: process.env.VIDEO_PROVIDER || 'self-hosted',
  workerEnabled: process.env.VIDEO_WORKER_ENABLED !== 'false',
  maxBytes: Number(process.env.VIDEO_MAX_UPLOAD_BYTES || 536870912),
  maxDuration: Number(process.env.VIDEO_MAX_DURATION_SECONDS || 7200),
  timeout: Number(process.env.VIDEO_PROCESSING_TIMEOUT_SECONDS || 1800),
  ffmpeg: process.env.VIDEO_FFMPEG_PATH || 'ffmpeg',
  ffprobe: process.env.VIDEO_FFPROBE_PATH || 'ffprobe',
  playbackTtl: Number(process.env.VIDEO_PLAYBACK_TTL_SECONDS || 300),
  segmentTtl: Number(process.env.VIDEO_SEGMENT_TTL_SECONDS || 30),
  publicApi: (process.env.VIDEO_PUBLIC_API_URL || '').replace(/\/$/, ''),
  cloudEnabled: process.env.CLOUDFLARE_STREAM_ENABLED === 'true',
  cloudAccount: process.env.CLOUDFLARE_ACCOUNT_ID || '',
  cloudToken: process.env.CLOUDFLARE_STREAM_API_TOKEN || '',
  cloudCustomer: process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE || '',
  webhookSecret: process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET || '',
}));

export const featureConfig = registerAs('feature', () => ({
  aiEnabled: process.env.FEATURE_AI_ENABLED === 'true',
  chatEnabled: process.env.FEATURE_CHAT_ENABLED === 'true',
  cdnEnabled: process.env.FEATURE_CDN_ENABLED === 'true',
  registrationEnabled: process.env.FEATURE_REGISTRATION_ENABLED !== 'false',
  notificationEnabled: process.env.FEATURE_NOTIFICATION_ENABLED !== 'false',
}));

export const throttleConfig = registerAs('throttle', () => ({
  ttl: parseInt(process.env.THROTTLE_TTL || '60', 10),
  limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
}));

export const retentionConfig = registerAs('retention', () => ({
  auditDays: parseInt(process.env.RETENTION_AUDIT_DAYS || '365', 10),
  analyticsDays: parseInt(process.env.RETENTION_ANALYTICS_DAYS || '180', 10),
  loginHistoryDays: parseInt(process.env.RETENTION_LOGIN_HISTORY_DAYS || '90', 10),
  softDeleteDays: parseInt(process.env.RETENTION_SOFT_DELETE_DAYS || '90', 10),
  orphanFilesDays: parseInt(process.env.RETENTION_ORPHAN_FILES_DAYS || '30', 10),
}));
