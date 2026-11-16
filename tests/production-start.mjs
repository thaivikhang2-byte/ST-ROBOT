import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { initialize, main } = require('../backend/scripts/start-production.cjs');
const { operatorEnvironment } = require('../backend/scripts/setup-admin.cjs');

const email = 'fixture-initial-admin@school.local';
const password = 'Fixture-only-initial-password-1234';
const legacyPassword = 'Fixture-only-legacy-password';
const isInitialVariable = key => /^(INITIAL_ADMIN_|BOOTSTRAP_ADMIN_)/.test(key);
const assertScrubbed = environment => assert.deepEqual(Object.keys(environment).filter(isInitialVariable), []);
const freshEnvironment = (overrides = {}) => ({
    NODE_ENV: 'production', JWT_SECRET: 'fixture-jwt-value',
    INITIAL_ADMIN_ENABLED: 'true', INITIAL_ADMIN_EMAIL: email, INITIAL_ADMIN_PASSWORD: password,
    INITIAL_ADMIN_FUTURE_SECRET: 'fixture-unrecognized-secret',
    BOOTSTRAP_ADMIN_EMAIL: 'fixture-legacy@school.local', BOOTSTRAP_ADMIN_PASSWORD: legacyPassword,
    BOOTSTRAP_ADMIN_VERIFIED: 'true', ALLOW_INITIAL_ADMIN_BOOTSTRAP: 'true', ALLOW_ADMIN_RECOVERY: 'true',
    ...overrides,
});
function recorder(result = { status: 0 }) {
    const commands = [];
    return {
        commands,
        run(command, args, options) {
            assert.equal(command, process.execPath, 'startup steps must launch plain Node');
            assert.ok(args.every(arg => !/(?:^|[/\\])(?:ts-node|typescript|tsx)(?:[/\\]|$)|\.(?:ts|tsx)$|^(?:-r|--require|--loader|--import)$/.test(arg)),
                'production startup must not load a runtime TypeScript compiler');
            // Keep both a snapshot and the passed object: credentials must be removed
            // from the latter as soon as the one-off child completes.
            commands.push({ command, args, options, environment: { ...options.env } });
            return typeof result === 'function' ? result(commands.length) : result;
        },
    };
}
function assertCompiledSetup(command, relativePath) {
    assert.equal(command.args.length, 1, 'compiled setup steps execute one JavaScript entrypoint');
    const normalized = command.args[0].replaceAll('\\', '/');
    assert.ok(normalized.endsWith('/dist/setup/' + relativePath), 'setup must run the precompiled build artifact');
}
function assertNoArgumentSecrets(commands) {
    const argumentsText = JSON.stringify(commands.map(({ command, args }) => ({ command, args })));
    for (const value of [email, password, legacyPassword, 'fixture-unrecognized-secret'])
        assert.ok(!argumentsText.includes(value), 'operator credentials must never be command arguments');
}

{
    const calls = recorder();
    const environment = { NODE_ENV: 'production' };
    initialize({ environment, run: calls.run });
    assert.equal(calls.commands.length, 2);
    assert.deepEqual(calls.commands[0].args.slice(1), ['migrate', 'deploy']);
    assertCompiledSetup(calls.commands[1], 'prisma/seed.js');
    assert.equal(calls.commands[0].environment.NODE_ENV, 'production');
}
for (const enabled of [undefined, 'false']) {
    const environment = freshEnvironment();
    if (enabled === undefined) delete environment.INITIAL_ADMIN_ENABLED;
    else environment.INITIAL_ADMIN_ENABLED = enabled;
    const calls = recorder();
    initialize({ environment, run: calls.run });
    assert.equal(calls.commands.length, 2, 'credentials and legacy opt-ins cannot enable startup bootstrap');
    calls.commands.forEach(({ environment: env }) => assertScrubbed(env));
    assertScrubbed(environment);
    assertNoArgumentSecrets(calls.commands);
}
{
    const environment = freshEnvironment();
    const calls = recorder();
    initialize({ environment, run: calls.run });
    assert.equal(calls.commands.length, 3);
    assert.deepEqual(calls.commands[0].args.slice(1), ['migrate', 'deploy']);
    assertCompiledSetup(calls.commands[1], 'prisma/seed.js');
    assertCompiledSetup(calls.commands[2], 'scripts/initialize-admin.js');
    calls.commands.slice(0, 2).forEach(({ environment: env }) => assertScrubbed(env));
    const helperEnvironment = calls.commands[2].environment;
    assert.equal(helperEnvironment.INITIAL_ADMIN_ENABLED, 'true');
    assert.equal(helperEnvironment.INITIAL_ADMIN_EMAIL, email);
    assert.equal(helperEnvironment.INITIAL_ADMIN_PASSWORD, password);
    assert.deepEqual(Object.keys(helperEnvironment).filter(isInitialVariable).sort(),
        ['INITIAL_ADMIN_EMAIL', 'INITIAL_ADMIN_ENABLED', 'INITIAL_ADMIN_PASSWORD']);
    assert.equal(helperEnvironment.JWT_SECRET, 'fixture-jwt-value');
    assertScrubbed(environment);
    assertScrubbed(calls.commands[2].options.env);
    assertNoArgumentSecrets(calls.commands);
}
for (const overrides of [
    { INITIAL_ADMIN_ENABLED: 'yes' },
    { INITIAL_ADMIN_ENABLED: '' },
    { INITIAL_ADMIN_EMAIL: '' },
    { INITIAL_ADMIN_EMAIL: undefined },
    { INITIAL_ADMIN_PASSWORD: '' },
    { INITIAL_ADMIN_PASSWORD: undefined },
    { RUN_MIGRATIONS_ON_START: 'false' },
]) {
    const environment = freshEnvironment(overrides);
    const calls = recorder();
    assert.throws(() => initialize({ environment, run: calls.run }), error => {
        assert.ok(!error.message.includes(password));
        assert.ok(!error.message.includes(email));
        return true;
    }, 'invalid startup opt-in/credentials must fail closed');
    assert.ok(!calls.commands.some(({ args }) => args.some(arg => /initialize-admin\.(?:ts|js)$/.test(arg))));
    assertScrubbed(environment);
}
const retryId = '7e6321c9-32a3-4da3-9d37-ad038ba2fbea';
for (const enabled of [undefined, 'false']) {
    const environment = freshEnvironment({ INITIAL_ADMIN_CATALOG_RETRY_ID: retryId });
    if (enabled === undefined) delete environment.INITIAL_ADMIN_ENABLED;
    else environment.INITIAL_ADMIN_ENABLED = enabled;
    const calls = recorder();
    initialize({ environment, run: calls.run });
    assert.equal(calls.commands.length, 3, 'content-only retry runs after migrations and seed');
    assert.deepEqual(calls.commands[0].args.slice(1), ['migrate', 'deploy']);
    assertCompiledSetup(calls.commands[1], 'prisma/seed.js');
    assertCompiledSetup(calls.commands[2], 'scripts/initialize-admin.js');
    calls.commands.slice(0, 2).forEach(({ environment: env }) => assertScrubbed(env));
    const helperEnvironment = calls.commands[2].environment;
    assert.equal(helperEnvironment.INITIAL_ADMIN_ENABLED, 'false');
    assert.equal(helperEnvironment.INITIAL_ADMIN_CATALOG_RETRY_ID, retryId);
    assert.deepEqual(Object.keys(helperEnvironment).filter(isInitialVariable).sort(),
        ['INITIAL_ADMIN_CATALOG_RETRY_ID', 'INITIAL_ADMIN_ENABLED']);
    assertScrubbed(environment);
    calls.commands.forEach(({ options }) => assertScrubbed(options.env));
    assertNoArgumentSecrets(calls.commands);
}
for (const overrides of [
    { INITIAL_ADMIN_CATALOG_RETRY_ID: '' },
    { INITIAL_ADMIN_CATALOG_RETRY_ID: 'invalid-id' },
    { INITIAL_ADMIN_CATALOG_RETRY_ID: retryId, INITIAL_ADMIN_ENABLED: 'true' },
    { INITIAL_ADMIN_CATALOG_RETRY_ID: retryId, INITIAL_ADMIN_ENABLED: 'false', RUN_MIGRATIONS_ON_START: 'false' },
]) {
    const environment = freshEnvironment({ INITIAL_ADMIN_ENABLED: 'false', ...overrides });
    const calls = recorder();
    assert.throws(() => initialize({ environment, run: calls.run }));
    assert.equal(calls.commands.length, 0, 'invalid retry configuration fails before all child processes');
    assertScrubbed(environment);
}
for (const failureAt of [1, 2, 3]) {
    for (const failure of [
        () => ({ status: 1 }),
        () => ({ status: null, error: new Error(password) }),
        () => { throw new Error(password); },
    ]) {
        const environment = freshEnvironment();
        const calls = recorder(count => count === failureAt ? failure() : { status: 0 });
        assert.throws(() => initialize({ environment, run: calls.run }), error => {
            assert.ok(!error.message.includes(password), 'spawn errors cannot expose operator credentials');
            assert.ok(!error.message.includes(email));
            return true;
        });
        assert.equal(calls.commands.length, failureAt, 'failed initialization must stop every following step');
        assertScrubbed(environment);
        calls.commands.forEach(({ options }) => assertScrubbed(options.env));
        assertNoArgumentSecrets(calls.commands);
    }
}
initialize({ environment: { RUN_MIGRATIONS_ON_START: 'false' }, run: () => { throw new Error('should not run'); } });
for (const failureAt of [1, 2, 3]) {
    const environment = freshEnvironment();
    let launches = 0;
    const calls = recorder(count => ({ status: count === failureAt ? 1 : 0 }));
    assert.throws(() => main({ environment, run: calls.run, launch: () => { launches++; } }));
    assert.equal(launches, 0, 'API must not start after migration, seed or administrator/catalog failure');
    assertScrubbed(environment);
}
{
    const environment = freshEnvironment();
    const calls = recorder();
    const launches = [];
    const child = new EventEmitter();
    child.kill = () => true;
    const priorSignalListeners = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, process.listeners(signal)]));
    try {
        assert.equal(main({ environment, run: calls.run, launch(command, args, options) {
            launches.push({ command, args, options, environment: { ...options.env } });
            return child;
        } }), child);
        assert.equal(launches.length, 1);
        assert.equal(launches[0].command, process.execPath);
        assert.equal(launches[0].args.length, 1, 'API also starts as plain compiled JavaScript');
        assert.match(launches[0].args[0], /dist[/\\]main\.js$/);
        assertScrubbed(launches[0].environment);
        assertScrubbed(environment);
        assertNoArgumentSecrets([...calls.commands, ...launches]);
    } finally {
        for (const [signal, previous] of priorSignalListeners)
            for (const listener of process.listeners(signal))
                if (!previous.includes(listener)) process.removeListener(signal, listener);
    }
}

const original = { NODE_ENV: 'production', JWT_SECRET: 'fixture-only' };
const result = operatorEnvironment(original, { email: 'fixture@school.local', password: 'Fixture-only-password' });
assert.equal(result.BOOTSTRAP_ADMIN_VERIFIED, 'true');
assert.equal(result.BOOTSTRAP_IMPORT_CATALOG, 'true');
assert.ok(!('BOOTSTRAP_ADMIN_PASSWORD' in original));
assert.equal(result.JWT_SECRET, original.JWT_SECRET);
console.log('PASS compiled production startup without runtime TypeScript, ordering, initial administrator opt-in, secret isolation and failure handling');
