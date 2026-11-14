// Generate a NEW local setup; never overwrite uploaded/existing secrets.
const { randomBytes } = require('node:crypto');
const { writeFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const target = resolve(__dirname, '..', '.env');
if (existsSync(target)) {
  console.error('.env đã tồn tại; giữ nguyên. Xem .env.example để bổ sung biến còn thiếu.');
  process.exitCode = 1;
} else {
  const secret = () => randomBytes(32).toString('hex');
  writeFileSync(target, [
    '# Local development only. Never commit this file.',
    'NODE_ENV=development', 'POSTGRES_DB=strobot', 'POSTGRES_USER=strobot',
    `POSTGRES_PASSWORD=${secret()}`, `REDIS_PASSWORD=${secret()}`,
    `JWT_SECRET=${secret()}`, `JWT_REFRESH_SECRET=${secret()}`,
    'CORS_ORIGIN=http://localhost:5500,http://127.0.0.1:5500',
    'MAIL_PROVIDER=file', 'MAIL_OUTBOX=/app/.mail-outbox',
    'AI_GATEWAY_ENABLED=false', 'FEATURE_AI_ENABLED=false',
    'VIDEO_WORKER_ENABLED=false', 'BACKUP_ENABLED=false', 'SWAGGER_ENABLED=false',
    ''
  ].join('\n'), { flag: 'wx', mode: 0o600 });
  console.log('Đã tạo .env riêng cho bản local; không có mật khẩu mặc định được chia sẻ.');
}
