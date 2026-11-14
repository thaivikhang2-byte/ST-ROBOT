// Uses new schemas inside the pinned disposable test database; never drops existing schemas/data.
require('../test/setup-env.cjs');
const { PrismaClient } = require('../dist/database/client');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { mkdirSync, readFileSync, writeFileSync, cpSync } = require('node:fs');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');
const prismaCli = require.resolve('prisma/build/index.js');
function run(args, url) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error('Migration verification command failed: ' + args.join(' ') + '\n' + result.stdout + '\n' + result.stderr);
}
async function verify() {
  const schema = 'phase3_upgrade_' + randomUUID().replaceAll('-', '');
  const url = new URL(process.env.DATABASE_URL); url.searchParams.set('schema', schema);
  const legacy = resolve('.test-tmp/legacy-' + schema);
  mkdirSync(legacy, { recursive: true });
  cpSync('prisma/schema.prisma', resolve(legacy, 'schema.prisma'));
  cpSync('prisma/migrations/20261022000000_baseline', resolve(legacy, 'migrations/20261022000000_baseline'), { recursive: true });
  writeFileSync(resolve(legacy, 'migrations/migration_lock.toml'), 'provider = "postgresql"\n');
  run(['migrate','deploy','--schema',resolve(legacy, 'schema.prisma')], url.toString());
  const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const roleId = randomUUID(), userId = randomUUID();
  try {
    // Current generated client includes new columns, so parameterized SQL is necessary for legacy fixtures.
    await prisma.$executeRaw`INSERT INTO roles (id,name,updated_at) VALUES (${roleId}::uuid,'legacy-role',now())`;
    await prisma.$executeRaw`INSERT INTO users (id,email,password_hash,first_name,last_name,role_id,updated_at)
      VALUES (${userId}::uuid,' Legacy@Example.com ','legacy-hash-preserved','Legacy','User',${roleId}::uuid,now())`;
    run(['migrate','deploy'], url.toString());
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assert.equal(user.email, 'legacy@example.com');
    assert.equal(user.password_hash, 'legacy-hash-preserved');
    assert.equal(user.role_id, roleId);
    assert.equal(user.auth_version, 0);
    assert.equal(await prisma.user.count(), 1);
    console.log('PASS: versioned migrations preserve legacy user ID, password hash and role; email normalized; auth_version added.');
  } finally { await prisma.$disconnect(); }
}
verify().catch(error => { console.error(error.message); process.exitCode = 1; });
