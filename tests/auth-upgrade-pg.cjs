#!/usr/bin/env node
// Native mixed-password + PostgreSQL regression. Requires a compiled backend.
// node tests/auth-upgrade-pg.cjs --env-file /private/disposable-test-env.json
// The supplied NODE_ENV=test URL must be loopback. This test creates and drops
// only its own random strobot_auth_upgrade_*_test database. No provider calls.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');

const backend = path.resolve(__dirname, '../backend');
const local = name => require(path.join(backend, name));
const { Client, Pool } = local('node_modules/pg');
const bcrypt = local('node_modules/bcrypt');
const { PrismaPg } = local('node_modules/@prisma/adapter-pg');
const { PrismaClient } = local('node_modules/@prisma/client');
const { ConfigService } = local('node_modules/@nestjs/config');
const { JwtService } = local('node_modules/@nestjs/jwt');
const { AuthService } = local('dist/modules/auth/auth.service');
const { TokenService } = local('dist/modules/auth/services/token.service');
const { JwtStrategy } = local('dist/modules/auth/strategies/jwt.strategy');
const { identityInclude, profile } = local('dist/modules/auth/identity.repository');
const hashes = local('dist/shared/utils/hash.util');

let phase = 'configuration';
const checks = [], measurements = [], gates = [];
function check(condition, label) { if (!condition) throw new Error(label); }
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  gates.push(resolve);
  return { promise, resolve };
}
async function within(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Fixture phase timeout')), 10000); })]); }
  finally { clearTimeout(timer); }
}
async function denied(promise) {
  try { await promise; } catch (error) {
    check(error.message === 'Invalid email or password', 'Denial response must remain generic');
    return;
  }
  throw new Error('A stale or invalid credential was accepted');
}
const normalize = value => value instanceof Date ? value.toISOString()
  : Array.isArray(value) ? value.map(normalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)])) : value;

async function main() {
  check(process.argv.length === 4 && process.argv[2] === '--env-file', 'Pass one private fixture environment file');
  const environment = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const base = new URL(environment.DATABASE_URL);
  check(environment.NODE_ENV === 'test' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Disposable loopback NODE_ENV=test fixture required');
  const name = `strobot_auth_upgrade_${randomBytes(6).toString('hex')}_test`;
  check(/^strobot_auth_upgrade_[a-f0-9]{12}_test$/.test(name), 'Invalid owned fixture name');
  const target = new URL(base); target.pathname = '/' + name;
  const admin = new Client({ connectionString: base.href });
  await admin.connect();
  let created = false, db, pool;
  try {
    phase = 'create-owned-fixture';
    await admin.query(`CREATE DATABASE "${name}"`); created = true;
    const migration = spawnSync(process.execPath, ['scripts/apply-disposable-test-migrations.cjs'], {
      cwd: backend, env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: target.href }, encoding: 'utf8',
    });
    check(migration.status === 0, 'Unchanged disposable migrations failed');
    let statements = 0;
    pool = new Pool({ connectionString: target.href });
    // Count driver statements without retaining SQL or bind values, including
    // BEGIN/COMMIT issued by the transaction adapter rather than ORM query logs.
    pool.on('connect', client => {
      const original = client.query.bind(client);
      client.query = (...args) => { statements++; return original(...args); };
    });
    db = new PrismaClient({ adapter: new PrismaPg(pool), log: [] });
    await db.$connect();
    const queryOperations = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'create', 'update', 'upsert', 'delete']);
    // Both strategies share this one pool. Forced query reproduces the previous
    // loader for comparison; the deployed client uses the joined default.
    const queryDb = db.$extends({ query: { $allModels: { $allOperations({ operation, args, query }) {
      return query(queryOperations.has(operation) ? { ...args, relationLoadStrategy: 'query' } : args);
    } } } });
    const secret = randomBytes(32).toString('hex');
    const config = new ConfigService({ jwt: { secret, refreshSecret: randomBytes(32).toString('hex') } });
    const jwt = new JwtService();
    const tokenService = new TokenService(jwt, config);
    const auth = client => new AuthService(client, tokenService, { emit: () => false }, config);
    const joinedAuth = auth(db);
    const claims = token => jwt.verify(token, { secret });
    const strategy = client => new JwtStrategy(config, client);
    const createUser = async (hash, suffix = randomUUID()) => db.user.create({ data: {
      email: `fixture-${suffix}@auth-upgrade.example.test`, first_name: 'Fixture', last_name: 'Learner',
      password_hash: hash, auth_version: 4, role_id: student.id, is_email_verified: true, rbac_migrated: true,
      role_assignments: { create: { role_id: student.id } },
    } });
    const measure = async (loader, operation, run) => {
      statements = 0;
      const start = performance.now();
      const result = await run();
      measurements.push({ loader, operation, statements, elapsedMs: Math.round(performance.now() - start) });
      return result;
    };
    const proxyTransactions = before => new Proxy(db, { get(client, key) {
      if (key === '$transaction') return async (...args) => { await before(); return client.$transaction(...args); };
      const value = Reflect.get(client, key);
      return typeof value === 'function' ? value.bind(client) : value;
    } });

    phase = 'native-fixture-credentials';
    const student = await db.role.create({ data: { name: 'student', group: 'STUDENT', is_default: true } });
    const teacher = await db.role.create({ data: { name: 'teacher', group: 'TEACHER' } });
    const archived = await db.role.create({ data: { name: 'archived', group: 'MANAGER', status: 'ARCHIVED' } });
    const permissions = await Promise.all(['learning:read', 'learning:update', 'quizzes:grade'].map(name => db.permission.create({ data: { name, resource: name.split(':')[0], action: name.split(':')[1] } })));
    await db.rolePermission.createMany({ data: [
      ...permissions.slice(0, 2).map(permission => ({ role_id: student.id, permission_id: permission.id })),
      { role_id: teacher.id, permission_id: permissions[2].id },
      { role_id: archived.id, permission_id: permissions[2].id },
    ] });
    const password = 'Native-Fixture-' + randomUUID();
    const legacy = await bcrypt.hash(password, 12);
    const argon = await hashes.hashPassword(password);
    check(hashes.needsPasswordRehash(legacy) && hashes.isArgon2PasswordHash(argon), 'Compiled mixed-password utility is required');

    phase = 'joined-graph-and-query-counts';
    const graphUser = await createUser(argon);
    await db.userRoleAssignment.createMany({ data: [
      { user_id: graphUser.id, role_id: teacher.id, scope_type: 'COURSE', scope_id: randomUUID() },
      { user_id: graphUser.id, role_id: teacher.id, scope_type: 'COURSE', scope_id: randomUUID(), expires_at: new Date(Date.now() - 60000) },
      { user_id: graphUser.id, role_id: teacher.id, scope_type: 'COURSE', scope_id: randomUUID(), revoked_at: new Date() },
      { user_id: graphUser.id, role_id: archived.id },
    ] });
    const previous = await queryDb.user.findUnique({ where: { id: graphUser.id }, include: identityInclude });
    const joined = await db.user.findUnique({ where: { id: graphUser.id }, include: identityInclude });
    check(JSON.stringify(normalize(previous)) === JSON.stringify(normalize(joined)), 'Joined identity must equal the previous nested loader');
    check(JSON.stringify(normalize(profile(previous))) === JSON.stringify(normalize(profile(joined))) && profile(joined).roles.length === 2, 'Joined effective grants must preserve scope, expiry and revocation');
    for (let round = 0; round < 3; round++) for (const [loader, client] of [['previous-query', queryDb], ['joined', db]]) {
      const result = await measure(loader, 'argon-login', () => auth(client).login({ email: graphUser.email, password }));
      await measure(loader, 'jwt-validation', () => strategy(client).validate(claims(result.tokens.accessToken)));
    }
    const previousLoginCounts = measurements.filter(row => row.loader === 'previous-query' && row.operation === 'argon-login').map(row => row.statements);
    const joinedLoginCounts = measurements.filter(row => row.loader === 'joined' && row.operation === 'argon-login').map(row => row.statements);
    check(Math.max(...joinedLoginCounts) < Math.min(...previousLoginCounts), 'Joined login must reduce actual driver statements');
    checks.push('joined graph parity and reduced real login/JWT statements');

    phase = 'legacy-upgrade-preserves-session';
    const legacyUser = await createUser(legacy);
    const oldFamily = randomUUID();
    const oldTokens = await tokenService.generateTokenPair({ sub: legacyUser.id, sid: oldFamily, ver: legacyUser.auth_version });
    await db.refreshToken.create({ data: { user_id: legacyUser.id, family_id: oldFamily, token_hash: hashes.sha256(oldTokens.refreshToken), expires_at: tokenService.refreshExpiresAt(oldTokens) } });
    const upgraded = await joinedAuth.login({ email: legacyUser.email, password });
    const stored = await db.user.findUnique({ where: { id: legacyUser.id } });
    check(hashes.isArgon2PasswordHash(stored.password_hash) && await hashes.comparePassword(password, stored.password_hash), 'Legacy login must persist a valid Argon hash');
    check(stored.auth_version === legacyUser.auth_version && (await strategy(db).validate(claims(oldTokens.accessToken))).id === legacyUser.id, 'Algorithm migration must retain existing session versions');
    check(!Object.hasOwn(upgraded.user, 'password_hash') && !Object.hasOwn(upgraded.user, 'auth_version'), 'Public profile must not disclose credentials');
    checks.push('native bcrypt12 migration keeps auth version and existing sessions');

    phase = 'simultaneous-legacy-logins';
    const concurrentUser = await createUser(legacy);
    let transactionCalls = 0;
    const bothReady = deferred();
    const concurrentDb = proxyTransactions(async () => {
      transactionCalls++;
      if (transactionCalls <= 2) {
        if (transactionCalls === 2) bothReady.resolve();
        await within(bothReady.promise);
      }
    });
    const concurrentAuth = auth(concurrentDb);
    const results = await Promise.all([1, 2].map(() => concurrentAuth.login({ email: concurrentUser.email, password })));
    check(transactionCalls === 3, 'Exactly one losing migration login may retry once');
    check(await db.refreshToken.count({ where: { user_id: concurrentUser.id } }) === 2, 'Both legitimate logins must receive independent valid sessions');
    check(await db.auditLog.count({ where: { user_id: concurrentUser.id, action: 'auth.login_failed' } }) === 0, 'An intermediate successful upgrade race is not a failed login');
    for (const result of results) await strategy(db).validate(claims(result.tokens.accessToken));
    checks.push('two concurrent native legacy logins both succeed with one bounded retry');

    phase = 'password-reset-before-lock';
    const resetUser = await createUser(legacy);
    const entered = deferred(), release = deferred();
    const resetAuth = auth(proxyTransactions(async () => { entered.resolve(); await within(release.promise); }));
    const resetAttempt = resetAuth.login({ email: resetUser.email, password }); resetAttempt.catch(() => {});
    await within(entered.promise);
    const resetHash = await hashes.hashPassword('New-private-fixture-' + randomUUID());
    await db.user.update({ where: { id: resetUser.id }, data: { password_hash: resetHash, auth_version: { increment: 1 } } });
    release.resolve(); await denied(resetAttempt);
    check(await db.refreshToken.count({ where: { user_id: resetUser.id } }) === 0, 'Concurrent password reset must issue no stale session');
    check((await db.user.findUnique({ where: { id: resetUser.id } })).password_hash === resetHash, 'Migration must not overwrite a password reset');
    checks.push('native verification before a concurrent reset cannot authorize a stale password');

    phase = 'reset-after-retry-verification';
    const retryUser = await createUser(legacy);
    const firstEntered = deferred(), firstRelease = deferred(), secondEntered = deferred(), secondRelease = deferred();
    let retryCalls = 0;
    const retryAuth = auth(proxyTransactions(async () => {
      retryCalls++;
      if (retryCalls === 1) { firstEntered.resolve(); await within(firstRelease.promise); }
      if (retryCalls === 2) { secondEntered.resolve(); await within(secondRelease.promise); }
    }));
    const retryAttempt = retryAuth.login({ email: retryUser.email, password }); retryAttempt.catch(() => {});
    await within(firstEntered.promise);
    await db.user.update({ where: { id: retryUser.id }, data: { password_hash: argon } });
    firstRelease.resolve();
    await within(secondEntered.promise); // Re-read and native Argon verification have finished outside the next lock.
    await db.user.update({ where: { id: retryUser.id }, data: { password_hash: resetHash, auth_version: { increment: 1 } } });
    secondRelease.resolve(); await denied(retryAttempt);
    check(retryCalls === 2 && await db.refreshToken.count({ where: { user_id: retryUser.id } }) === 0, 'A reset during retry cannot be hidden by another retry');
    checks.push('reset after native retry verification is rechecked under the second lock');

    phase = 'legacy-utf8-boundary';
    const longPassword = 'đ'.repeat(37); // 74 UTF-8 bytes; still inside the unchanged public DTO character bound.
    const longHash = await bcrypt.hash(longPassword, 12);
    const longUser = await createUser(longHash);
    await joinedAuth.login({ email: longUser.email, password: longPassword });
    check((await db.user.findUnique({ where: { id: longUser.id } })).password_hash === longHash, 'A legacy candidate over 72 UTF-8 bytes must not be reinterpreted by migration');
    checks.push('long UTF-8 bcrypt candidates remain on their accepted legacy credential');

    phase = 'fresh-account-and-role-controls';
    const controlled = await createUser(argon);
    const activeLogin = await joinedAuth.login({ email: controlled.email, password });
    await db.user.update({ where: { id: controlled.id }, data: { student_approval_pending: true } });
    await denied(joinedAuth.login({ email: controlled.email, password }));
    await within(strategy(db).validate(claims(activeLogin.tokens.accessToken)).then(() => { throw new Error('Pending account accepted an existing JWT'); }, () => undefined));
    await db.user.update({ where: { id: controlled.id }, data: { student_approval_pending: false } });
    await db.userRoleAssignment.updateMany({ where: { user_id: controlled.id }, data: { expires_at: new Date(Date.now() - 60000) } });
    await denied(joinedAuth.login({ email: controlled.email, password }));
    await db.userRoleAssignment.updateMany({ where: { user_id: controlled.id }, data: { expires_at: null, revoked_at: new Date() } });
    await denied(joinedAuth.login({ email: controlled.email, password }));
    checks.push('pending, expired and revoked assignments remain fail closed with joined loading');

    phase = 'generic-denial';
    await denied(joinedAuth.login({ email: graphUser.email, password: 'Wrong-private-fixture-password' }));
    await denied(joinedAuth.login({ email: 'missing@auth-upgrade.example.test', password: 'Wrong-private-fixture-password' }));
    checks.push('native wrong-password and missing-account paths retain generic denials');

    const report = { status: 'pass', productionBenchmark: false, database: 'owned disposable loopback PostgreSQL', checks, measurements };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    for (const release of gates) release();
    if (db) await db.$disconnect();
    if (pool) await pool.end();
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
}

main().catch(error => {
  // Do not print ORM messages, SQL, fixture identities, password hashes or URLs.
  console.error(JSON.stringify({ status: 'fail', phase, errorType: error?.name || 'Error', code: typeof error?.code === 'string' ? error.code : undefined }));
  process.exitCode = 1;
});
