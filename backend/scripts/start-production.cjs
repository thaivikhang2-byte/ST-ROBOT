const { spawnSync, spawn } = require('node:child_process');
const path = require('node:path');

function initialize({ run = spawnSync, environment = process.env } = {}) {
  if (environment.RUN_MIGRATIONS_ON_START === 'false') return;
  const commands = [
    [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
    [require.resolve('ts-node/dist/bin.js'), path.join(__dirname, '..', 'prisma', 'seed.ts')],
  ];
  for (const args of commands) {
    const result = run(process.execPath, args, {
      cwd: path.join(__dirname, '..'), env: environment, stdio: 'inherit',
    });
    if (result.error || result.status !== 0)
      throw new Error('Database initialization failed; API was not started. Check migration/seed logs without sharing credentials.');
  }
}

function main() {
  initialize();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'dist', 'main.js')], {
    cwd: path.join(__dirname, '..'), env: process.env, stdio: 'inherit',
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
  child.once('error', () => { console.error('API process could not start.'); process.exitCode = 1; });
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGTERM' ? 0 : 1); });
}
module.exports = { initialize };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
