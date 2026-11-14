const { spawnSync } = require('node:child_process');
require('../test/setup-env.cjs');
const args = process.argv.slice(2);
const command = args.shift();
const map = {
  migrate: ['prisma', 'migrate', 'deploy'],
  status: ['prisma', 'migrate', 'status'],
  validate: ['prisma', 'validate'],
  seed: ['ts-node', 'prisma/seed.ts'],
  openapi: ['ts-node', 'scripts/export-openapi.ts'],
  e2e: ['jest', '--config', 'jest-e2e.config.ts', '--runInBand'],
  unit: ['jest', '--config', 'jest.config.ts', '--runInBand'],
  typecheck: ['tsc', '--noEmit'],
};
if (!map[command]) throw new Error('Use migrate/status/validate/seed/openapi/e2e/unit/typecheck');
const result = spawnSync(process.execPath, [require.resolve(map[command][0] === 'prisma' ? 'prisma/build/index.js' : map[command][0] === 'ts-node' ? 'ts-node/dist/bin.js' : map[command][0] === 'tsc' ? 'typescript/bin/tsc' : 'jest/bin/jest'), ...map[command].slice(1), ...args], { stdio: 'inherit', env: process.env });
process.exitCode = result.status ?? 1;
