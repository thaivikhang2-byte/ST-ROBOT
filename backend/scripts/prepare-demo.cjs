// Local operator setup. Secrets stay in ignored files; no provider calls or DB writes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '../..');
const target = path.join(root, '.env.demo.local');
if (fs.existsSync(target)) throw new Error('Private demo environment already exists; edit it explicitly, never overwrite keys');
const read = name => dotenv.parse(fs.readFileSync(path.join(root, name)));
const prior = { ...read('.env.docker'), ...read('.env.media.local') };
const env = {};
for (const k of ['DATABASE_USER', 'DATABASE_NAME', 'DATABASE_PASSWORD', 'MAIL_PROVIDER', 'MAIL_HOST', 'MAIL_PORT', 'MAIL_USER', 'MAIL_PASSWORD', 'MAIL_FROM', 'MAIL_SECURE', 'MINIO_ROOT_USER', 'MINIO_ROOT_PASSWORD', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) if (prior[k] !== undefined) env[k] = prior[k];
if (!env.DATABASE_PASSWORD || !env.MAIL_HOST || !env.MINIO_ROOT_PASSWORD) throw new Error('Existing DB, SMTP and media settings are required');
Object.assign(env, {
  NODE_ENV: 'production', DEMO_PORT: '8080', DEMO_STORAGE_PORT: '19010',
  DEMO_DATABASE_URL: `postgresql://${encodeURIComponent(env.DATABASE_USER || 'st_robot_user')}:${encodeURIComponent(env.DATABASE_PASSWORD)}@postgres:5432/${encodeURIComponent(env.DATABASE_NAME || 'st_robot')}`,
  CORS_ORIGIN: 'http://localhost:8080,http://127.0.0.1:8080',
  JWT_SECRET: crypto.randomBytes(48).toString('hex'), JWT_REFRESH_SECRET: crypto.randomBytes(48).toString('hex'),
  JWT_EXPIRATION: '15m', JWT_REFRESH_EXPIRATION: '7d', JWT_ISSUER: 'st-robot-demo', JWT_AUDIENCE: 'st-robot-web',
  REDIS_PASSWORD: '', STORAGE_PROVIDER: 'minio', S3_FORCE_PATH_STYLE: 'true', S3_PUBLIC_ENDPOINT: 'http://localhost:19010',
  VIDEO_PROVIDER: 'self-hosted', VIDEO_WORKER_ENABLED: 'true', CLOUDFLARE_STREAM_ENABLED: 'false',
  AI_PROVIDER: 'gemini', AI_GATEWAY_ENABLED: 'false', FEATURE_AI_ENABLED: 'false', FEATURE_CHAT_ENABLED: 'false', AI_FALLBACK_ENABLED: 'false',
  AI_CREDENTIALS_MASTER_KEY: crypto.randomBytes(32).toString('base64'), AI_CREDENTIALS_KEY_ID: 'demo-v1', AI_APPROVED_BASE_URLS: 'https://generativelanguage.googleapis.com',
  FEATURE_REGISTRATION_ENABLED: 'true', SWAGGER_ENABLED: 'false', LOG_LEVEL: 'warn',
  DEMO_POSTGRES_VOLUME: 'st-robot-demo-postgres-20261026', DEMO_MINIO_VOLUME: 'st-robot-demo-minio-20261026',
});
const encode = value => JSON.stringify(String(value)).replace(/\$/g, '$$$$');
fs.writeFileSync(target, Object.entries(env).map(([k, v]) => `${k}=${encode(v)}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
const secrets = path.join(root, 'demo_production/secrets');
fs.mkdirSync(path.join(secrets, 'vault'), { recursive: true, mode: 0o700 });
for (const name of ['gemini-api-key.txt', 'cloudflare-tunnel-token.txt']) fs.writeFileSync(path.join(secrets, name), '', { mode: 0o600, flag: 'wx' });
fs.mkdirSync(path.join(root, '.ai-secrets/demo'), { recursive: true, mode: 0o700 });
console.log('Private demo environment generated; SMTP/media reused, new isolated JWT/vault keys, AI/Tunnel disabled. No secrets printed.');
