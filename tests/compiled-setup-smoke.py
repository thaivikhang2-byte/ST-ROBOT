#!/usr/bin/env python3
"""Check precompiled initialization against a fresh disposable PostgreSQL DB.

Build backend first, then pass a private JSON environment file with NODE_ENV=test
and a loopback DATABASE_URL whose database name ends in _test. The test creates
and drops only its own randomly named database. All initialization CLIs run with
a 128 MiB V8 heap; passwords, connection URLs and raw database records are never
printed. No AI provider requests are made.
"""
import argparse
import json
import os
import pathlib
import re
import secrets
import subprocess
import tempfile
import time
import urllib.parse


def require(condition, message):
    if not condition:
        raise AssertionError(message)


DATABASE_HELPER = r'''
const fs = require('node:fs');
const {Client} = require('pg');
const {createHash} = require('node:crypto');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const target = new URL(process.env.DATABASE_URL || '');
if (process.env.NODE_ENV !== 'test' || !['localhost','127.0.0.1','[::1]'].includes(target.hostname)
    || !target.pathname.endsWith('_test')) throw new Error('Disposable local test database required');
const assert = value => {if (!value) throw new Error('Compiled setup fixture assertion failed')};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
(async()=>{
  if (input.operation === 'create' || input.operation === 'drop') {
    assert(/^strobot_setup_[a-f0-9]{16}_test$/.test(input.database));
    const client = new Client({connectionString:target.href});
    try {
      await client.connect();
      await client.query(input.operation === 'create'
        ? `CREATE DATABASE "${input.database}"`
        : `DROP DATABASE "${input.database}" WITH (FORCE)`);
      console.log('{}');
    } finally {await client.end();}
    return;
  }
  assert(/^\/strobot_setup_[a-f0-9]{16}_test$/.test(target.pathname));
  const {PrismaClient} = require('./dist/setup/src/database/client');
  const db = new PrismaClient();
  try {
    const user = await db.user.findUniqueOrThrow({where:{email:input.email},include:{role:true}});
    if (input.operation === 'revokeGrant') {
      const grant = await db.rolePermission.findFirstOrThrow({where:{role_id:user.role_id}});
      await db.rolePermission.delete({where:{id:grant.id}});
    }
    const [assignments,grants,courses,lessons,bootstrapAudits] = await Promise.all([
      db.userRoleAssignment.findMany({where:{user_id:user.id},orderBy:{id:'asc'}}),
      db.rolePermission.findMany({where:{role_id:user.role_id},orderBy:{id:'asc'}}),
      db.course.count(),db.lesson.count(),
      db.auditLog.count({where:{user_id:user.id,action:'user.bootstrap'}}),
    ]);
    assert(user.is_email_verified && user.is_active && user.role.name === 'superadmin');
    assert(assignments.some(a=>a.scope_type==='SYSTEM' && !a.revoked_at));
    assert(courses === 5 && lessons === 30 && bootstrapAudits === 1);
    console.log(JSON.stringify({id:user.id,identityHash:hash(user),assignmentsHash:hash(assignments),
      grantsHash:hash(grants),courses,lessons,bootstrapAudits}));
  } finally {await db.$disconnect();}
})().catch(()=>{console.error('Disposable database assertion failed');process.exitCode=1;});
'''

RUNTIME_GUARD = r'''
process.once('exit',()=>{
  const loaded = Object.keys(require.cache).some(file=>/[/\\]node_modules[/\\](ts-node|typescript)[/\\]/.test(file));
  if (loaded) process.exitCode = 1;
  console.error('COMPILED_SETUP_RESULT '+JSON.stringify({runtimeCompilerLoaded:loaded,
    maxRSSMiB:Math.ceil(process.resourceUsage().maxRSS/1024),node:process.version}));
});
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', required=True, type=pathlib.Path)
    parser.add_argument('--output', type=pathlib.Path)
    args = parser.parse_args()
    backend = pathlib.Path(__file__).resolve().parents[1] / 'backend'
    cfg = json.loads(args.env_file.read_text())
    target = urllib.parse.urlsplit(cfg.get('DATABASE_URL', ''))
    require(cfg.get('NODE_ENV') == 'test', 'NODE_ENV=test is required')
    require(target.scheme in {'postgres','postgresql'} and target.hostname in {'localhost','127.0.0.1','::1'}
            and target.path.endswith('_test'), 'A disposable loopback PostgreSQL database is required')
    for entry in ['dist/setup/prisma/seed.js','dist/setup/scripts/initialize-admin.js']:
        require((backend / entry).is_file(), 'Build both backend and setup before running this test')
    database = 'strobot_setup_' + secrets.token_hex(8) + '_test'
    url = urllib.parse.urlunsplit(target._replace(path='/' + database))
    env = dict(os.environ)
    env.update({str(key):str(value) for key,value in cfg.items()})
    for name in list(env):
        if name.startswith(('INITIAL_ADMIN_','BOOTSTRAP_ADMIN_')):
            env.pop(name)
    env.pop('NODE_OPTIONS', None)
    owned_env = {**env, 'DATABASE_URL':url}
    email = 'compiled-' + secrets.token_hex(8) + '@school.local'
    password = secrets.token_urlsafe(30)
    measurements = []
    started = time.monotonic()

    def run(command, environment, *, input_data=None):
        result = subprocess.run(command, cwd=backend, env=environment,
            input=None if input_data is None else json.dumps(input_data),
            capture_output=True, text=True, timeout=90)
        require(result.returncode == 0, 'Compiled setup subprocess failed; no private output displayed')
        return result

    def helper(operation, environment=owned_env):
        return json.loads(run(['node','--max-old-space-size=128','-e',DATABASE_HELPER],
            environment, input_data={'operation':operation,'database':database,'email':email}).stdout)

    created = False
    with tempfile.TemporaryDirectory(prefix='strobot-compiled-setup-') as directory:
        guard = pathlib.Path(directory) / 'runtime-guard.cjs'
        guard.write_text(RUNTIME_GUARD)

        def initialize(entry, environment):
            result = run(['node','--max-old-space-size=128','--require',str(guard),entry], environment)
            records = [json.loads(line.removeprefix('COMPILED_SETUP_RESULT '))
                for line in result.stderr.splitlines() if line.startswith('COMPILED_SETUP_RESULT ')]
            require(len(records) == 1 and not records[0]['runtimeCompilerLoaded'],
                    'Initialization loaded a runtime compiler or emitted no measurement')
            measurements.append({'entry':entry,**records[0]})

        try:
            helper('create', env)
            created = True
            run(['node','scripts/apply-disposable-test-migrations.cjs'], owned_env)
            initialize('dist/setup/prisma/seed.js', owned_env)
            first = {**owned_env,'INITIAL_ADMIN_ENABLED':'true',
                     'INITIAL_ADMIN_EMAIL':email,'INITIAL_ADMIN_PASSWORD':password}
            initialize('dist/setup/scripts/initialize-admin.js', first)
            snapshot = helper('snapshot')
            print('PASS precompiled seed/admin create a verified administrator and 5 courses/30 lessons', flush=True)

            baseline = helper('revokeGrant')
            initialize('dist/setup/prisma/seed.js', owned_env)
            initialize('dist/setup/scripts/initialize-admin.js',
                {**first,'INITIAL_ADMIN_PASSWORD':secrets.token_urlsafe(30)})
            require(helper('snapshot') == baseline,
                    'Repeat initialization changed administrator credentials, assignments or revoked grants')
            print('PASS repeated setup preserves administrator identity and revoked permissions', flush=True)

            initialize('dist/setup/scripts/initialize-admin.js',
                {**owned_env,'INITIAL_ADMIN_ENABLED':'false','INITIAL_ADMIN_CATALOG_RETRY_ID':snapshot['id']})
            require(helper('snapshot') == baseline, 'Catalog-only retry changed identity or catalog counts')
            print('PASS content-only retry works without creating or resetting an account', flush=True)
        finally:
            if created:
                helper('drop', env)

    report = {'status':'passed','heapLimitMiB':128,
              'elapsedSeconds':round(time.monotonic()-started,2),'measurements':measurements}
    if args.output:
        args.output.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report),flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never echo connection strings, input environment, raw subprocess logs or credentials.
        print('FAIL compiled setup regression: '+(str(error) if isinstance(error,AssertionError)
              else type(error).__name__),flush=True)
        raise SystemExit(1)
