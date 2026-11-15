import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { productionFiles } = require('../scripts/setup-production.cjs');
const { deploy } = require('../scripts/deploy-production.cjs');
const root = mkdtempSync(join(tmpdir(), 'strobot-production-fixture-'));
const password = 'Fixture-only-private-12345';
try {
    const generated = productionFiles({ directory: root, apiDomain: 'api.school.example',
        adminEmail: 'operator@school.local', adminPassword: password });
    const publicProcessConfig = readFileSync(generated.environment, 'utf8');
    assert.match(publicProcessConfig, /NODE_ENV=production/);
    assert.match(publicProcessConfig, /MANAGED_ACCOUNTS_ENABLED=true/);
    assert.match(publicProcessConfig, /FEATURE_REGISTRATION_ENABLED=false/);
    assert.match(publicProcessConfig, /MAIL_PROVIDER=disabled/);
    assert.ok(!publicProcessConfig.includes(password));
    assert.ok(!publicProcessConfig.includes('BOOTSTRAP_ADMIN_PASSWORD'));
    assert.ok(!publicProcessConfig.includes('operator@school.local'));
    const secrets = [...publicProcessConfig.matchAll(/^(?:JWT_SECRET|JWT_REFRESH_SECRET|POSTGRES_PASSWORD|REDIS_PASSWORD)=(.+)$/gm)].map(x => x[1]);
    assert.equal(new Set(secrets).size, 4);
    assert.equal(statSync(generated.environment).mode & 0o777, 0o600);
    assert.equal(statSync(generated.initialAdmin).mode & 0o777, 0o600);
    assert.throws(() => productionFiles({ directory: root, apiDomain: 'api.school.example',
        adminEmail: 'operator@school.local', adminPassword: 'Another-fixture-password' }), /đã tồn tại/);
    let bootstrapEnvironment;
    const calls = [];
    const run = (command, args, options) => {
        calls.push([command, args]);
        assert.ok(!JSON.stringify(args).includes(password));
        if (args.includes('admin:bootstrap')) bootstrapEnvironment = options.env;
        else assert.ok(!('BOOTSTRAP_ADMIN_PASSWORD' in options.env));
        return { status: 0 };
    };
    deploy({ root, existingProxy: true, run, environment: {} });
    assert.equal(bootstrapEnvironment.BOOTSTRAP_ADMIN_PASSWORD, password);
    assert.equal(bootstrapEnvironment.BOOTSTRAP_ADMIN_VERIFIED, 'true');
    assert.equal(bootstrapEnvironment.BOOTSTRAP_IMPORT_CATALOG, 'true');
    assert.ok(!existsSync(generated.initialAdmin));
    assert.ok(calls.some(([, args]) => args.includes('up') && args.at(-1) === 'backend'));
    assert.ok(calls.every(([, args]) => !args.includes('down') && !args.includes('-v')));
    assert.throws(() => productionFiles({ directory: join(root, 'bad'), apiDomain: 'https://api.school.example/path',
        adminEmail: 'operator@school.local', adminPassword: password }), /tên miền/);
    const failedRoot = join(root, 'failed');
    const failed = productionFiles({ directory: failedRoot, apiDomain: 'api.school.example',
        adminEmail: 'operator@school.local', adminPassword: password });
    assert.throws(() => deploy({ root: failedRoot, run: () => ({ status: 1 }), environment: {} }), /chưa hoàn thành/);
    assert.ok(existsSync(failed.initialAdmin), 'failed deployment must retain retry material');
    console.log('PASS production setup: private bootstrap lifecycle, unique secrets, no service/argv password leak, preserve data and retry material');
} finally { rmSync(root, { recursive: true, force: true }); }
