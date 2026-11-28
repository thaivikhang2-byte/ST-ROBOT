#!/usr/bin/env node
// Monetary admission against real PostgreSQL. No HTTP server or provider calls.
// node tests/ai-spending-pg.cjs --env-file /private/disposable-test-env.json
// Creates/drops only its own random strobot_spending_*_test database.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');

const backend = path.resolve(__dirname, '../backend');
const local = name => require(path.join(backend, name));
let phase = 'configuration';
const checks = [];
function check(condition, label) { if (!condition) throw new Error(label); }
async function denied(promise) {
  try { await promise; } catch (error) {
    check(error?.code === 'AI_QUOTA_EXCEEDED', 'Monetary admission must use its bounded quota error');
    return;
  }
  throw new Error('Monetary admission unexpectedly accepted a blocked request');
}

async function main() {
  check(process.argv.length === 4 && process.argv[2] === '--env-file', 'Pass one private fixture environment file');
  const environment = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const base = new URL(environment.DATABASE_URL);
  check(environment.NODE_ENV === 'test' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
    && ['postgresql:', 'postgres:'].includes(base.protocol) && base.pathname.endsWith('_test'),
  'Only a disposable loopback NODE_ENV=test database is allowed');
  const name = `strobot_spending_${randomBytes(8).toString('hex')}_test`;
  check(/^strobot_spending_[a-f0-9]{16}_test$/.test(name), 'Invalid owned fixture name');
  const target = new URL(base); target.pathname = '/' + name;
  const { Client, Pool } = local('node_modules/pg');
  const { PrismaPg } = local('node_modules/@prisma/adapter-pg');
  const { PrismaClient, Prisma } = local('node_modules/@prisma/client');
  const { AiSpendingService } = local('dist/modules/ai-gateway/spending/ai-spending.service');
  const D = value => new Prisma.Decimal(value);
  const admin = new Client({ connectionString: base.href, connectionTimeoutMillis: 5000, query_timeout: 10000 });
  await admin.connect();
  let created = false, db, pool, releaseBarrier;
  try {
    phase = 'create-owned-fixture';
    await admin.query(`CREATE DATABASE "${name}"`); created = true;
    phase = 'migrate-owned-fixture';
    // Match the existing auth/product fixtures: apply unchanged migration SQL
    // through pg when the restricted environment cannot run Prisma's engine.
    // Production continues to use Prisma migrate deploy during startup.
    const migration = spawnSync(process.execPath, ['scripts/apply-disposable-test-migrations.cjs'], {
      cwd: backend, env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: target.href },
      encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024,
    });
    check(migration.status === 0, 'Unchanged disposable migrations failed');
    pool = new Pool({ connectionString: target.href, connectionTimeoutMillis: 5000, query_timeout: 10000, max: 5 });
    db = new PrismaClient({ adapter: new PrismaPg(pool), log: [], transactionOptions: { maxWait: 10000, timeout: 15000 } });
    await db.$connect();

    phase = 'minimum-native-fixture';
    const role = await db.role.create({ data: { name: 'spending-fixture', group: 'STUDENT' } });
    const users = await Promise.all(['first', 'second', 'existing'].map(label => db.user.create({ data: {
      email: `${label}@spending-fixture.example.test`, first_name: 'Fixture', last_name: 'Learner',
      password_hash: 'fixture-never-used-for-authentication', role_id: role.id, is_email_verified: true,
    } })));
    await db.aiQuotaPolicy.create({ data: { id: 'default' } });
    await db.aiProvider.create({ data: { id: 'spending-fixture', enabled: true, type: 'openai' } });
    const model = await db.aiModel.create({ data: {
      provider_id: 'spending-fixture', model_id: 'never-dispatched', enabled: true,
      capabilities: ['chat'], allowed_tools: [], max_input_tokens: 100000,
      max_output_tokens: 2000, context_tokens: 102000,
      input_price: D('1'), output_price: D('1'), pricing_version: 'operator-confirmed:pg-fixture',
    } });
    // Authentication/authorization is covered by HTTP/unit regressions. This
    // fixture isolates real SQL aggregation and durable monetary serialization.
    const service = new AiSpendingService(db, { actor: async () => ({
      grants: [{ group: 'MANAGER', scopeType: 'SYSTEM', permissions: ['ai:manage'] }],
    }) });
    const actor = { id: users[0].id };
    const now = new Date();
    const day = 86400000;
    const vietnamStart = new Date(Math.floor((now.getTime() + 7 * 3600000) / day) * day - 7 * 3600000);
    const reserveFrom = new Date(vietnamStart.getTime() + 2 * day);
    const policyData = {
      enabled: true, economy_enabled: true, total_budget_usd: D('0.1'), daily_budget_usd: D('0.1'), reserve_usd: D('0'),
      starts_at: new Date(vietnamStart.getTime() - 3 * day), reserve_from: reserveFrom,
      ends_at: new Date(vietnamStart.getTime() + 3 * day), revision: 1,
    };
    await db.aiSpendPolicy.create({ data: { id: 'default', ...policyData } });
    const usage = (user, changes = {}) => ({
      user_id: user.id, provider_id: model.provider_id, model_id: model.model_id, endpoint: 'chat',
      reserved_tokens: 40000, charged_tokens: 40000, reserved_cost_usd: D('0.04'),
      input_price: model.input_price, output_price: model.output_price, pricing_version: model.pricing_version,
      started_at: now, deadline_at: new Date(now.getTime() + 60000), ...changes,
    });
    // Mirror the transaction ordering in AiQuotaService: lock default quota,
    // then inspect the shared policy and insert its reservation before commit.
    const admit = (user, tokens, at = now, selectedModel = model, beforeLock) => db.$transaction(async tx => {
      await beforeLock?.(tx);
      await tx.aiQuotaPolicy.update({ where: { id: 'default' }, data: { lock_version: { increment: 1 } } });
      const reserved = await service.reserve(tx, selectedModel, tokens, at);
      return tx.aiUsageRecord.create({ data: usage(user, {
        status: 'reserved', reserved_tokens: tokens, charged_tokens: tokens, reserved_cost_usd: reserved,
        started_at: at, deadline_at: new Date(at.getTime() + 60000),
      }) });
    });
    const configure = changes => db.aiSpendPolicy.update({ where: { id: 'default' }, data: changes });
    const clearUsage = () => db.aiUsageRecord.deleteMany({});

    phase = 'cross-owner-shared-admission-race';
    await db.aiUsageRecord.create({ data: usage(users[2], { status: 'completed', estimated_cost: D('0.04') }) });
    let entered = 0, barrierTimer;
    const sessions = new Set();
    const barrier = new Promise((resolve, reject) => {
      releaseBarrier = resolve;
      barrierTimer = setTimeout(() => reject(new Error('Concurrent transaction rendezvous timed out')), 5000);
    });
    const meet = async tx => {
      const [row] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      sessions.add(row.pid);
      if (++entered === 2) releaseBarrier();
      await barrier;
    };
    let admissions;
    try { admissions = await Promise.allSettled([admit(users[0], 40000, now, model, meet), admit(users[1], 40000, now, model, meet)]); }
    finally { clearTimeout(barrierTimer); }
    check(sessions.size === 2, 'Concurrent admissions must use two actual PostgreSQL connections');
    check(admissions.filter(result => result.status === 'fulfilled').length === 1, 'Exactly one competing owner may reserve the remaining allowance');
    const rejected = admissions.find(result => result.status === 'rejected');
    check(rejected?.reason?.code === 'AI_QUOTA_EXCEEDED', 'The losing transaction must see the committed shared reservation');
    check(await db.aiUsageRecord.count() === 2, 'A denied admission must create no usage reservation');
    await admit(users[0], 20000); // 0.04 spent + 0.04 held + 0.02 held = 0.10 exactly.
    await denied(admit(users[1], 1));
    const status = await service.status(actor);
    check(status.usage.spentUsd === '0.04' && status.usage.reservedUsd === '0.06'
      && status.usage.remainingUsd === '0' && status.usage.costUnknown === false,
    'SQL numeric totals must map to exact Decimal metadata without floating point drift');
    checks.push('two real PostgreSQL sessions serialize cross-owner reservations at the exact shared dollar cap');

    phase = 'expired-and-unknown-usage-keeps-allowance';
    await clearUsage();
    await configure({ total_budget_usd: D('0.05'), daily_budget_usd: D('0.05') });
    const held = await db.aiUsageRecord.create({ data: usage(users[2], {
      status: 'reserved', started_at: new Date(now.getTime() - 2 * day), deadline_at: new Date(now.getTime() - day),
    }) });
    await denied(admit(users[0], 20000));
    await db.aiUsageRecord.update({ where: { id: held.id }, data: { status: 'failed', estimated_cost: null } });
    await denied(admit(users[1], 20000));
    const heldStatus = await service.status(actor);
    check(heldStatus.usage.spentUsd === '0.04' && heldStatus.usage.remainingUsd === '0.01',
      'Expired or failed dispatches without provider usage must retain their monetary bound');
    checks.push('expired reservations and failed dispatches remain charged when provider usage is unknown');

    phase = 'unpriced-history-count-and-admission';
    await clearUsage();
    await db.aiUsageRecord.create({ data: usage(users[2], {
      status: 'interrupted', reserved_cost_usd: null, input_price: null, output_price: null, pricing_version: null,
    }) });
    const storedPolicy = await db.aiSpendPolicy.findUnique({ where: { id: 'default' } });
    const aggregate = await service.totals(db, storedPolicy, now);
    check(typeof aggregate.unknown === 'bigint' && aggregate.unknown === 1n,
      'Raw PostgreSQL COUNT must remain a bigint and report unpriced historical usage');
    check(typeof aggregate.spent.add === 'function' && aggregate.spent.eq(0), 'Raw SQL numeric must remain Decimal');
    await denied(admit(users[0], 1));
    check((await service.status(actor)).usage.costUnknown === true, 'Unpriced dispatches must appear in safe operator metadata');
    checks.push('actual SQL bigint counts and Decimal totals keep unpriced history fail closed');

    phase = 'exam-reserve-boundary';
    await clearUsage();
    await configure({ total_budget_usd: D('0.1'), daily_budget_usd: D('0.03'), reserve_usd: D('0.04') });
    await db.aiUsageRecord.create({ data: usage(users[2], {
      status: 'completed', reserved_cost_usd: D('0.06'), estimated_cost: D('0.06'), started_at: new Date(now.getTime() - day),
    }) });
    //0.02 is below the normal daily0.03 cap: only the protected total blocks it.
    await denied(admit(users[0], 20000, new Date(reserveFrom.getTime() - 1)));
    await admit(users[1], 40000, reserveFrom); // The protected0.04 is released exactly at reserveFrom.
    await denied(admit(users[0], 1, reserveFrom));
    checks.push('the protected exam allowance opens exactly at reserveFrom while the total cap stays strict');

    phase = 'unconfirmed-price-stops-before-reservation';
    await clearUsage();
    const unconfirmed = { ...model, pricing_version: 'unverified-operator-price' };
    await denied(admit(users[0], 40000, now, unconfirmed));
    check(await db.aiUsageRecord.count() === 0, 'An unconfirmed model price must stop before any dispatch reservation');
    checks.push('unconfirmed model pricing never creates an admitted provider request');

    phase = 'daily-budget-and-policy-window';
    await configure({ total_budget_usd: D('0.1'), daily_budget_usd: D('0.03'), reserve_usd: D('0') });
    await db.aiUsageRecord.create({ data: usage(users[2], {
      status: 'completed', estimated_cost: D('0.02'), reserved_cost_usd: D('0.02'),
    }) });
    await admit(users[0], 10000); // 0.02 + 0.01 reaches today's0.03 cap exactly.
    await denied(admit(users[1], 1));
    await denied(admit(users[1], 1, new Date(policyData.starts_at.getTime() - 1)));
    await denied(admit(users[1], 1, policyData.ends_at));
    checks.push('shared Vietnam-day allowance and configured policy dates stop further reservations');

    console.log(JSON.stringify({ status: 'pass', providerRequests: 0,
      database: 'owned disposable loopback PostgreSQL', checks }, null, 2));
  } finally {
    releaseBarrier?.();
    if (db) await db.$disconnect();
    if (pool && !pool.ended) await pool.end();
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
}

main().catch(error => {
  // Never print ORM messages, SQL, fixture identities or connection strings.
  console.error(JSON.stringify({ status: 'fail', phase, errorType: error?.name || 'Error',
    ...(typeof error?.code === 'string' ? { code: error.code } : {}) }));
  process.exitCode = 1;
});
