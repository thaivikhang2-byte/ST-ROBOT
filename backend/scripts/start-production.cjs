const { spawnSync, spawn } = require('node:child_process');
const path = require('node:path');

function clearBootstrapEnvironment(environment) {
  for (const key of Object.keys(environment)) {
    if (key.startsWith('INITIAL_ADMIN_') || key.startsWith('BOOTSTRAP_ADMIN_'))
      delete environment[key];
  }
}

function runStep(run, args, environment, failure) {
  let result;
  try {
    result = run(process.execPath, args, {
      cwd: path.join(__dirname, '..'), env: environment, stdio: 'inherit',
    });
  } catch { throw new Error(failure); }
  if (!result || result.error || result.status !== 0) throw new Error(failure);
}

function initialize({ run = spawnSync, environment = process.env } = {}) {
  const initial = {
    INITIAL_ADMIN_ENABLED: environment.INITIAL_ADMIN_ENABLED,
    INITIAL_ADMIN_EMAIL: environment.INITIAL_ADMIN_EMAIL,
    INITIAL_ADMIN_PASSWORD: environment.INITIAL_ADMIN_PASSWORD,
    INITIAL_ADMIN_CATALOG_RETRY_ID: environment.INITIAL_ADMIN_CATALOG_RETRY_ID,
  };
  // Scrub before running any other child, including migrations and failures.
  clearBootstrapEnvironment(environment);
  let adminEnvironment;
  try {
    const enabled = initial.INITIAL_ADMIN_ENABLED;
    if (enabled !== undefined && enabled !== 'true' && enabled !== 'false')
      throw new Error('Initial administrator configuration is invalid; API was not started.');
    const retryId = initial.INITIAL_ADMIN_CATALOG_RETRY_ID;
    if (retryId !== undefined && (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(retryId) || enabled === 'true'))
      throw new Error('Initial administrator catalog retry configuration is invalid; API was not started.');
    if (enabled === 'true' && (!initial.INITIAL_ADMIN_EMAIL?.trim() || !initial.INITIAL_ADMIN_PASSWORD))
      throw new Error('Initial administrator email and password are required; API was not started.');
    if (environment.RUN_MIGRATIONS_ON_START === 'false') {
      if (enabled === 'true' || retryId)
        throw new Error('Initial administrator setup requires migrations and seed; API was not started.');
      return;
    }
    const commands = [
      [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
      [require.resolve('ts-node/dist/bin.js'), path.join(__dirname, '..', 'prisma', 'seed.ts')],
    ];
    for (const args of commands) {
      runStep(run, args, environment,
        'Database initialization failed; API was not started. Check migration/seed logs without sharing credentials.');
    }
    if (enabled === 'true' || retryId) {
      adminEnvironment = { ...environment, INITIAL_ADMIN_ENABLED: enabled || 'false' };
      if (retryId) adminEnvironment.INITIAL_ADMIN_CATALOG_RETRY_ID = retryId;
      else {
        adminEnvironment.INITIAL_ADMIN_EMAIL = initial.INITIAL_ADMIN_EMAIL;
        adminEnvironment.INITIAL_ADMIN_PASSWORD = initial.INITIAL_ADMIN_PASSWORD;
      }
      runStep(run,
        [require.resolve('ts-node/dist/bin.js'), path.join(__dirname, 'initialize-admin.ts')],
        adminEnvironment, 'Initial administrator setup failed; API was not started. Check the safe setup message above.');
    }
  } finally {
    clearBootstrapEnvironment(initial);
    if (adminEnvironment) clearBootstrapEnvironment(adminEnvironment);
    clearBootstrapEnvironment(environment);
  }
}

function main({ run = spawnSync, launch = spawn, environment = process.env } = {}) {
  initialize({ run, environment });
  let child;
  try {
    child = launch(process.execPath, [path.join(__dirname, '..', 'dist', 'main.js')], {
      cwd: path.join(__dirname, '..'), env: environment, stdio: 'inherit',
    });
  } catch { throw new Error('API process could not start.'); }
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
  child.once('error', () => { console.error('API process could not start.'); process.exitCode = 1; });
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGTERM' ? 0 : 1); });
  return child;
}
module.exports = { initialize, main };
if (require.main === module) {
  try { main(); } catch { console.error('Production initialization failed; API was not started. Check the safe setup logs above without sharing credentials.'); process.exitCode = 1; }
}
