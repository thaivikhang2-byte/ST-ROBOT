const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function deploy({ root = path.resolve(__dirname, '..'), existingProxy = false, skipAdmin = false,
    run = spawnSync, environment = process.env } = {}) {
  const file = path.join(root, '.env.production.local');
  if (!fs.existsSync(file)) throw new Error('Chưa có cấu hình riêng. Chạy node scripts/setup-production.cjs trước.');
  const compose = ['compose', '--env-file', file, '-f', 'docker-compose.yml', '-f', 'docker-compose.production.yml'];
  const execute = (args, env = environment) => {
    const result = run('docker', args, { cwd: root, stdio: 'inherit', env });
    if (result.error || result.status !== 0) throw new Error('Lệnh Docker chưa hoàn thành. Cấu hình và dữ liệu riêng vẫn được giữ để kiểm tra/thử lại.');
  };
  execute([...compose, 'config', '--quiet']);
  execute([...compose, 'up', '--build', '-d', ...(existingProxy ? ['backend'] : [])]);
  const initial = path.join(root, '.private', 'initial-admin.json');
  if (!skipAdmin && fs.existsSync(initial)) {
    const admin = JSON.parse(fs.readFileSync(initial, 'utf8'));
    const env = { ...environment, ALLOW_INITIAL_ADMIN_BOOTSTRAP: 'true',
      BOOTSTRAP_ADMIN_VERIFIED: 'true', BOOTSTRAP_IMPORT_CATALOG: 'true',
      BOOTSTRAP_ADMIN_EMAIL: admin.email, BOOTSTRAP_ADMIN_PASSWORD: admin.password,
      BOOTSTRAP_ADMIN_FIRST_NAME: admin.firstName, BOOTSTRAP_ADMIN_LAST_NAME: admin.lastName };
    const keys = ['ALLOW_INITIAL_ADMIN_BOOTSTRAP', 'BOOTSTRAP_ADMIN_VERIFIED', 'BOOTSTRAP_IMPORT_CATALOG',
      'BOOTSTRAP_ADMIN_EMAIL', 'BOOTSTRAP_ADMIN_PASSWORD', 'BOOTSTRAP_ADMIN_FIRST_NAME', 'BOOTSTRAP_ADMIN_LAST_NAME'];
    execute([...compose, 'run', '--rm', '--no-deps', ...keys.flatMap(key => ['-e', key]), 'backend', 'npm', 'run', 'admin:bootstrap'], env);
    fs.unlinkSync(initial);
    console.log('Quản trị viên và danh mục đã được tạo. Đã xóa hồ sơ mật khẩu dùng một lần.');
  }
  console.log('Đã chạy lệnh triển khai. Kiểm tra HTTPS /api/system/health, đăng nhập quản trị rồi cấu hình AI trước khi kết nối GitHub Pages.');
}
module.exports = { deploy };
if (require.main === module) {
  try { deploy({ existingProxy: process.argv.includes('--existing-proxy'), skipAdmin: process.argv.includes('--skip-admin') }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
