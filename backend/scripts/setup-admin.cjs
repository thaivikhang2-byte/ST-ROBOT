// Run only inside the operator's server terminal. No shared/default credentials.
const readline = require('node:readline/promises');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function readSecret(prompt) {
  if (!process.stdin.isTTY) throw new Error('Open the server Shell to enter credentials privately.');
  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', input); process.stdout.write('\n'); };
    const input = bytes => {
      for (const char of bytes.toString()) {
        if (char === '\u0003') { cleanup(); reject(new Error('Cancelled.')); return; }
        if (char === '\r' || char === '\n') { cleanup(); resolve(value); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', input);
  });
}

function operatorEnvironment(environment, credentials) {
  return { ...environment, ALLOW_INITIAL_ADMIN_BOOTSTRAP: 'true',
    BOOTSTRAP_ADMIN_VERIFIED: 'true', BOOTSTRAP_IMPORT_CATALOG: 'true',
    BOOTSTRAP_ADMIN_EMAIL: credentials.email, BOOTSTRAP_ADMIN_PASSWORD: credentials.password,
    BOOTSTRAP_ADMIN_FIRST_NAME: 'System', BOOTSTRAP_ADMIN_LAST_NAME: 'Administrator' };
}

async function main() {
  console.log('Tạo quản trị viên đầu tiên và danh mục học. Danh tính do người vận hành server xác nhận.');
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  let email;
  try { email = await terminal.question('Email tài khoản quản trị: '); }
  finally { terminal.close(); }
  let password = await readSecret('Mật khẩu quản trị (không hiện ký tự): ');
  const env = operatorEnvironment(process.env, { email, password });
  password = '';
  const result = spawnSync(process.execPath,
    [require.resolve('ts-node/dist/bin.js'), path.join(__dirname, 'bootstrap-admin.ts')],
    { cwd: path.join(__dirname, '..'), env, stdio: 'inherit' });
  env.BOOTSTRAP_ADMIN_PASSWORD = '';
  process.exitCode = result.error ? 1 : (result.status ?? 1);
}
module.exports = { operatorEnvironment };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
