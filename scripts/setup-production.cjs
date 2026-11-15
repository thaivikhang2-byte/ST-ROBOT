const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');

const DEFAULT_ORIGIN = 'https://thaivikhang2-byte.github.io';

function productionFiles({ directory, apiDomain, frontendOrigin = DEFAULT_ORIGIN, adminEmail,
    adminPassword, firstName = 'System', lastName = 'Administrator' }) {
  const host = String(apiDomain || '').trim().toLowerCase();
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
      || host.endsWith('.local') || host === 'localhost')
    throw new Error('Nhập tên miền công khai của backend, ví dụ api.tenmiencuaban.vn; không thêm https:// hoặc đường dẫn.');
  let origin;
  try { origin = new URL(frontendOrigin); } catch { throw new Error('Địa chỉ frontend không hợp lệ.'); }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/')
    throw new Error('Frontend cần một HTTPS origin, ví dụ https://thaivikhang2-byte.github.io.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail || '')) throw new Error('Email quản trị không hợp lệ.');
  if (typeof adminPassword !== 'string' || adminPassword.length < 12 || Buffer.byteLength(adminPassword) > 72 || adminPassword.includes('\0'))
    throw new Error('Mật khẩu quản trị cần ít nhất 12 ký tự, tối đa 72 byte.');
  const environment = path.join(directory, '.env.production.local');
  const privateDirectory = path.join(directory, '.private');
  const initialAdmin = path.join(privateDirectory, 'initial-admin.json');
  if (fs.existsSync(environment) || fs.existsSync(initialAdmin))
    throw new Error('Cấu hình riêng đã tồn tại. Giữ nguyên để cập nhật; công cụ không ghi đè dữ liệu hoặc mật khẩu.');
  const secret = () => randomBytes(32).toString('hex');
  const content = [
    '# Private production configuration. Never commit or share.',
    'STROBOT_ENV_FILE=.env.production.local', 'NODE_ENV=production',
    `API_DOMAIN=${host}`, `CORS_ORIGIN=${origin.origin}`,
    'POSTGRES_DB=strobot', 'POSTGRES_USER=strobot',
    `POSTGRES_PASSWORD=${secret()}`, `REDIS_PASSWORD=${secret()}`,
    `JWT_SECRET=${secret()}`, `JWT_REFRESH_SECRET=${secret()}`,
    'MANAGED_ACCOUNTS_ENABLED=true', 'FEATURE_REGISTRATION_ENABLED=false',
    'MAIL_PROVIDER=disabled',
    'AI_GATEWAY_ENABLED=true', 'FEATURE_AI_ENABLED=true',
    `AI_CREDENTIALS_MASTER_KEY=${randomBytes(32).toString('base64')}`,
    'AI_CREDENTIALS_KEY_ID=master-v1',
    'AI_PROVIDERS_CONFIG_PATH=/app/.ai-secrets/providers.enc.json',
    'AI_APPROVED_BASE_URLS=https://generativelanguage.googleapis.com,https://llm.wokushop.com/v1,https://api.openai.com/v1,https://api.anthropic.com,https://openrouter.ai/api/v1',
    'VIDEO_WORKER_ENABLED=false', 'BACKUP_ENABLED=false', 'SWAGGER_ENABLED=false',
    'LOG_LEVEL=info', ''
  ].join('\n');
  fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(privateDirectory, 0o700);
  fs.writeFileSync(environment, content, { flag: 'wx', mode: 0o600 });
  try {
    fs.writeFileSync(initialAdmin, JSON.stringify({ email: adminEmail.trim().toLowerCase(),
      password: adminPassword, firstName, lastName }), { flag: 'wx', mode: 0o600 });
  } catch (error) { fs.unlinkSync(environment); throw error; }
  return { environment, initialAdmin, apiUrl: `https://${host}/api` };
}

async function hiddenPassword(prompt) {
  if (!process.stdin.isTTY) throw new Error('Nhập mật khẩu trong terminal riêng hoặc cung cấp biến BOOTSTRAP_ADMIN_PASSWORD.');
  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', input); process.stdout.write('\n'); };
    const input = chunk => {
      for (const char of chunk.toString()) {
        if (char === '\u0003') { cleanup(); reject(new Error('Đã hủy.')); return; }
        if (char === '\r' || char === '\n') { cleanup(); resolve(value); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', input);
  });
}

async function main() {
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  let apiDomain, adminEmail;
  try {
    apiDomain = process.env.STROBOT_API_DOMAIN || await terminal.question('Tên miền backend (ví dụ api.tenmiencuaban.vn): ');
    adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || await terminal.question('Email quản trị bạn muốn tạo: ');
  } finally { terminal.close(); }
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || await hiddenPassword('Mật khẩu quản trị (không hiện ký tự): ');
  const result = productionFiles({ directory: path.resolve(__dirname, '..'), apiDomain, adminEmail, adminPassword,
    frontendOrigin: process.env.STROBOT_FRONTEND_ORIGIN || DEFAULT_ORIGIN });
  console.log('Đã tạo cấu hình riêng và hồ sơ quản trị dùng một lần. Chưa khởi động dịch vụ hay tạo tài khoản trên server.');
  console.log('API dự kiến:', result.apiUrl);
  console.log('Sau khi DNS trỏ tới server, chạy: node scripts/deploy-production.cjs');
}
module.exports = { productionFiles };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
