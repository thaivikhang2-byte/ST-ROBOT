// Local-only credentials. Never print them or replace an existing environment file.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const target = path.resolve(__dirname, '../../.env.media.local');
if (!fs.existsSync(target)) {
  const access = 'strobot' + crypto.randomBytes(10).toString('hex');
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(target, [
    'STORAGE_PROVIDER=minio', 'S3_REGION=us-east-1', 'S3_ENDPOINT=http://127.0.0.1:19000',
    'S3_PUBLIC_ENDPOINT=http://localhost:19000', 'S3_BUCKET=st-robot-media-local',
    `MINIO_ROOT_USER=${access}`, `MINIO_ROOT_PASSWORD=${secret}`,
    `S3_ACCESS_KEY_ID=${access}`, `S3_SECRET_ACCESS_KEY=${secret}`, 'S3_FORCE_PATH_STYLE=true',
    'MEDIA_MAX_UPLOAD_BYTES=104857600', 'MEDIA_UPLOAD_URL_TTL_SECONDS=900', 'MEDIA_DOWNLOAD_URL_TTL_SECONDS=300',
    'MEDIA_CDN_BASE_URL=', 'MEDIA_LOCAL_CORS_ORIGINS=http://localhost,http://127.0.0.1:*', '',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
}
console.log('Local media environment ready; credentials were not printed.');
