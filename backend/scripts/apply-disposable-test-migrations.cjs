// Fixture-only fallback for restricted CI: run the unchanged migration SQL with pg.
// Production MUST use `npm run db:migrate` (Prisma migration engine).
const { Client } = require('pg');
const { readdir, readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (process.env.NODE_ENV !== 'test' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !url.pathname.endsWith('_test')) throw new Error('Disposable local test database required');
  const client = new Client({ connectionString: url.href });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      id VARCHAR(36) PRIMARY KEY, checksum VARCHAR(64) NOT NULL,
      finished_at TIMESTAMPTZ, migration_name VARCHAR(255) NOT NULL, logs TEXT,
      rolled_back_at TIMESTAMPTZ, started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      applied_steps_count INTEGER NOT NULL DEFAULT 0)`);
    const root = join(__dirname, '..', 'prisma', 'migrations');
    for (const name of (await readdir(root)).filter(x => /^\d+/.test(x)).sort()) {
      const sql = await readFile(join(root, name, 'migration.sql'), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query('SELECT checksum, finished_at FROM "_prisma_migrations" WHERE migration_name=$1', [name]);
      if (existing.rows.length) {
        if (existing.rows[0].checksum !== checksum || !existing.rows[0].finished_at)
          throw new Error('Changed or incomplete fixture migration');
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO "_prisma_migrations" (id,checksum,migration_name,finished_at,applied_steps_count) VALUES ($1,$2,$3,now(),1)', [randomUUID(),checksum,name]);
        await client.query('COMMIT');
        console.log('Applied disposable fixture:', name);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally { await client.end(); }
}
main().catch(error => { console.error('Fixture migration failed:', error.message); process.exitCode=1; });
