// No native runtime download is needed to generate the PostgreSQL JS client.
// `migrate deploy` via this helper is reserved for isolated disposable tests;
// npm run db:migrate uses the production migration engine instead.
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), ...process.argv.slice(2)], {
  stdio: 'inherit', env: {
    ...process.env,
    ...(process.argv[2] === 'generate' && !process.env.DATABASE_URL
      ? { DATABASE_URL: 'postgresql://build:build@localhost:5432/build' } : {}),
    PRISMA_PORTABLE_CLI: 'true',
  },
});
if (result.error) console.error('Prisma CLI could not start');
process.exitCode = result.status ?? 1;
