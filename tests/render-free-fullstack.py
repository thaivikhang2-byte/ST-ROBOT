#!/usr/bin/env python3
"""Real PostgreSQL/HTTP regression for the Render database credential vault.

Build the backend, migrate/seed a disposable local database, create its admin,
then provide two private JSON files (no credentials belong in command arguments):

  python3 tests/render-free-fullstack.py \
    --env-file /workspace/scratch/strobot-render-test-env.json \
    --fixture /tmp/strobot-render-fixture.private.json

The environment file contains NODE_ENV=test, DATABASE_URL, REDIS_URL and stable
JWT/vault keys. The fixture contains api, adminEmail and adminPassword. This test
owns/restarts its Node child, requires an unused loopback API port and a database
named strobot_render*_test, and never calls provider discovery or generation.
It retains only assertion names in its report; subprocess logs stay private.
"""

import argparse
import concurrent.futures
import json
import os
import pathlib
import re
import secrets
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def loopback_url(value):
    parsed = urllib.parse.urlsplit(value)
    require(parsed.hostname in {'localhost', '127.0.0.1', '::1'},
            'Only disposable loopback services are supported')
    return parsed


class LocalApi:
    """The same standard-envelope contract as account-fullstack-smoke.py."""

    def __init__(self, base):
        self.base = base.rstrip('/')
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def call(self, path, *, method='GET', body=None, token=None, status=200, timeout=15):
        headers = {'Accept': 'application/json'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        if body is not None:
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(self.base + path,
            data=None if body is None else json.dumps(body).encode(),
            headers=headers, method=method)
        try:
            response = self.opener.open(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            actual = response.status
            payload = json.loads(response.read())
        accepted = status if isinstance(status, tuple) else (status,)
        require(actual in accepted,
                f'{method} {path} returned HTTP {actual}, expected {accepted}')
        if actual < 400:
            require(payload.get('success') is True and 'data' in payload,
                    'API did not return the standard success envelope')
            return payload['data']
        return payload


# Input and sensitive values travel through stdin/environment, never argv. The
# helper emits hashes/booleans, never row payloads, plaintext or ciphertext.
DATABASE_HELPER = r'''
const fs = require('node:fs');
const {createHash, timingSafeEqual} = require('node:crypto');
const {PrismaClient} = require('./dist/database/client');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const target = new URL(process.env.DATABASE_URL || '');
if (process.env.NODE_ENV !== 'test' || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
    || !/^\/strobot_render(?:_[a-z0-9]+)*_test$/.test(target.pathname))
  throw new Error('Disposable Render regression database required');
const db = new PrismaClient();
const digest = value => value == null ? null : createHash('sha256').update(value).digest('hex');
const assert = condition => {if (!condition) throw new Error('Database fixture assertion failed')};
(async () => {
  const [row, providers, models, quota, audits, usage] = await Promise.all([
    db.aiProviderVault.findUnique({where:{id:'default'}}),
    db.aiProvider.findMany({orderBy:{id:'asc'}}),
    db.aiModel.findMany({orderBy:{id:'asc'}}),
    db.aiQuotaPolicy.findUniqueOrThrow({where:{id:'default'}}),
    db.auditLog.findMany({where:{action:{startsWith:'ai.'}},orderBy:{id:'asc'}}),
    db.aiUsageRecord.count(),
  ]);
  let encrypted = null;
  if (input.providerId) {
    assert(row && row.payload && typeof row.payload === 'string');
    const vault = JSON.parse(row.payload);
    const provider = vault.providers.find(p => p.id === input.providerId);
    const credential = provider?.credentials.find(c => c.id === input.credentialId);
    assert(credential?.encrypted?.algorithm === 'aes-256-gcm');
    assert(credential.encrypted.ciphertext && credential.encrypted.iv && credential.encrypted.authTag);
    assert(!row.payload.includes(input.apiKey));
    assert(!row.backup_payload || !row.backup_payload.includes(input.apiKey));
    const {masterKey, decryptCredential} = require('./dist/modules/ai-gateway/vault/credential-crypto');
    const {credentialAad} = require('./dist/modules/ai-gateway/vault/vault-schema');
    const key = masterKey(process.env.AI_CREDENTIALS_MASTER_KEY);
    const clear = decryptCredential(credential.encrypted, key,
      process.env.AI_CREDENTIALS_KEY_ID || 'master-v1',
      credentialAad(provider, credential, process.env.AI_CREDENTIALS_KEY_ID || 'master-v1'));
    const expected = Buffer.from(input.apiKey);
    try { assert(clear.length === expected.length && timingSafeEqual(clear, expected)); }
    finally { clear.fill(0); expected.fill(0); key.fill(0); }
    assert(BigInt(vault.revision) === row.revision);
    encrypted = true;
  }
  console.log(JSON.stringify({
    vault:row ? {revision:row.revision.toString(),payloadHash:digest(row.payload),
      backupHash:digest(row.backup_payload),updatedAt:row.updated_at.toISOString()} : null,
    providersHash:digest(JSON.stringify(providers)),modelsHash:digest(JSON.stringify(models)),
    quotaHash:digest(JSON.stringify(quota)),auditHash:digest(JSON.stringify(audits)),
    auditCount:audits.length,lockVersion:quota.lock_version,usageCount:usage,encrypted,
  }));
})().catch(() => {process.exitCode=1}).finally(() => db.$disconnect());
'''


class Application:
    def __init__(self, backend, env, api, directory):
        self.backend, self.env, self.api, self.directory = backend, env, api, directory
        self.process = None
        self.logs = []

    def stop(self):
        if self.process is not None:
            if self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=5)
            self.process = None

    def start(self, **overrides):
        self.stop()
        target = loopback_url(self.api.base)
        # Refuse to attach to or terminate a process this test does not own.
        with socket.socket(socket.AF_INET6 if target.hostname == '::1' else socket.AF_INET) as probe:
            probe.settimeout(0.3)
            require(probe.connect_ex((target.hostname, target.port)) != 0,
                    'API port is occupied by a process this test does not own')
        logfile = self.directory / ('node-' + str(len(self.logs)) + '.private.log')
        descriptor = os.open(logfile, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        self.logs.append(logfile)
        env = {**self.env, **overrides}
        with os.fdopen(descriptor, 'wb') as output:
            self.process = subprocess.Popen(['node', 'dist/main.js'], cwd=self.backend,
                env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            require(self.process.poll() is None,
                    'Owned backend process exited before liveness was ready')
            try:
                if self.api.call('/system/health/live', timeout=1).get('status') == 'ok':
                    return
            except (OSError, ValueError):
                pass
            time.sleep(0.15)
        raise AssertionError('Owned backend process did not become live')

    def database(self, **values):
        result = subprocess.run(['node', '-e', DATABASE_HELPER], cwd=self.backend,
            env=self.env, input=json.dumps(values),
            text=True, capture_output=True, timeout=30)
        require(result.returncode == 0, 'Private database fixture/assertion failed')
        return json.loads(result.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', required=True, type=pathlib.Path)
    parser.add_argument('--fixture', required=True, type=pathlib.Path)
    parser.add_argument('--output', type=pathlib.Path,
                        default=pathlib.Path('/tmp/strobot-render-fullstack-results.json'))
    args = parser.parse_args()
    cfg = json.loads(args.env_file.read_text())
    fixture = json.loads(args.fixture.read_text())
    require(cfg.get('NODE_ENV') == 'test', 'NODE_ENV=test is required')
    database = loopback_url(cfg.get('DATABASE_URL', ''))
    require(database.scheme in {'postgres', 'postgresql'} and
            re.fullmatch(r'/strobot_render(?:_[a-z0-9]+)*_test', database.path),
            'A disposable strobot_render*_test PostgreSQL database is required')
    if cfg.get('REDIS_URL'):
        require(loopback_url(cfg['REDIS_URL']).scheme in {'redis', 'rediss'},
                'A disposable loopback Redis service is required')
    else:
        require(cfg.get('REDIS_HOST', 'localhost') in {'localhost', '127.0.0.1', '::1'},
                'A disposable loopback Redis service is required')
    endpoint = loopback_url(fixture['api'])
    require(endpoint.scheme == 'http' and endpoint.port and endpoint.path.rstrip('/') == '/api'
            and not endpoint.username and not endpoint.password and not endpoint.query,
            'Fixture API must be an explicit loopback HTTP port with /api prefix')
    require(cfg.get('AI_CREDENTIALS_MASTER_KEY'), 'A stable fixture vault master key is required')
    backend = pathlib.Path(__file__).resolve().parents[1] / 'backend'
    require((backend / 'dist/main.js').is_file(), 'Build the backend before running this regression')
    api = LocalApi(fixture['api'])
    results = []
    run_id = secrets.token_hex(4)
    provider_id, credential_id = 'render-' + run_id, 'dummy-' + run_id
    dummy_key = 'dummy-render-never-send-' + secrets.token_urlsafe(24)
    wrong_key = secrets.token_hex(32)
    while wrong_key == cfg['AI_CREDENTIALS_MASTER_KEY']:
        wrong_key = secrets.token_hex(32)
    approved_endpoint = 'https://provider.invalid/v1'
    limits = {'requestsPerMinute': 3, 'tokensPerDay': 100, 'maxConcurrent': 1}
    provider = {'id': provider_id, 'type': 'openai-compatible', 'enabled': True,
        'accountGroup': 'render-test', 'privacyGroup': 'render-test',
        'models': ['render-explicit-model'],
        'endpoints': [{'id': 'dummy-endpoint', 'baseUrl': approved_endpoint,
                       'enabled': True, 'capabilities': ['chat']}],
        'limits': limits, 'timeoutMs': 1000, 'priority': 0,
        'selection': 'priority', 'maxRetries': 0}

    def passed(name):
        results.append({'name': name, 'status': 'passed'})
        print('PASS', name, flush=True)

    def redacted(metadata):
        require(dummy_key not in json.dumps(metadata), 'HTTP metadata exposed a plaintext credential')
        for item in metadata['providers']:
            for credential in item['credentials']:
                require(set(credential) == {'id', 'enabled', 'endpointIds', 'limits'},
                        'HTTP credential metadata exposed encryption or secret fields')

    with tempfile.TemporaryDirectory(prefix='strobot-render-regression-') as temporary:
        directory = pathlib.Path(temporary)
        # A regular file cannot serve as a parent directory. Both vault paths
        # deliberately fail filesystem writes and must be ignored by DB mode.
        blocked_parent = directory / 'not-a-directory'
        blocked_parent.write_text('database mode must not touch the filesystem')
        env = {**os.environ, **{key: str(value) for key, value in cfg.items()}}
        env.pop('APP_PORT', None)
        env.update({'PORT': str(endpoint.port), 'API_PREFIX': 'api',
            'AI_VAULT_STORAGE': 'database', 'AI_ADMIN_ALLOW_LOCAL_HTTP': 'true',
            'AI_GATEWAY_ENABLED': 'false', 'AI_FALLBACK_ENABLED': 'false',
            'AI_APPROVED_BASE_URLS': approved_endpoint, 'MAIL_PROVIDER': 'disabled',
            'MANAGED_ACCOUNTS_ENABLED': 'true',
            'AI_PROVIDERS_CONFIG_PATH': str(blocked_parent / 'vault.enc.json')})
        app = Application(backend, env, api, directory)
        failure = None
        try:
            app.start()
            require(api.call('/system/health/ready')['status'] == 'ok',
                    'PostgreSQL/Redis startup readiness failed')
            login = api.call('/v1/auth/login', method='POST', status=(200, 201),
                body={'email': fixture['adminEmail'], 'password': fixture['adminPassword']})
            token = login['tokens']['accessToken']
            require(api.call('/v1/admin/ai/settings', token=token)['gatewayEnabled'] is False,
                    'Fixture must keep the provider dispatch environment gate disabled')
            api.call('/v1/admin/ai/vault', status=401)
            passed('PORT and Redis/PostgreSQL startup compatibility; admin login')

            student_email = 'render-student-' + run_id + '@example.test'
            student_password = 'Fixture-' + secrets.token_urlsafe(18)
            student = api.call('/v1/users/students', method='POST', token=token, status=(200, 201),
                body={'email': student_email, 'password': student_password,
                      'firstName': 'Render', 'lastName': 'Student'})
            require(student['isEmailVerified'] is True and student['role']['name'] == 'student',
                    'Manager-created fixture did not receive a verified student identity')
            student_login = api.call('/v1/auth/login', method='POST', status=(200, 201),
                body={'email': student_email, 'password': student_password})
            student_token = student_login['tokens']['accessToken']
            api.call('/v1/admin/ai/vault', token=student_token, status=403)
            api.call('/v1/admin/ai/providers/' + provider_id + '/config', method='PUT',
                token=student_token, status=403, body={'expectedRevision': 0, 'provider': provider})
            passed('verified migrated student cannot read or administer vault')

            initial = api.call('/v1/admin/ai/vault', token=token)
            redacted(initial)
            configured = api.call('/v1/admin/ai/providers/' + provider_id + '/config', method='PUT',
                token=token, body={'expectedRevision': initial['revision'], 'provider': provider})
            require(configured['revision'] == initial['revision'] + 1,
                    'Provider configuration did not advance the vault revision once')
            metadata = api.call('/v1/admin/ai/providers/' + provider_id + '/credentials', method='POST',
                token=token, status=(200, 201), body={'expectedRevision': configured['revision'],
                    'id': credential_id, 'apiKey': dummy_key, 'enabled': True,
                    'endpointIds': ['dummy-endpoint'], 'limits': limits})
            require(metadata['revision'] == configured['revision'] + 1,
                    'Credential creation did not advance the vault revision once')
            redacted(metadata)
            redacted(api.call('/v1/admin/ai/vault', token=token))
            encrypted = app.database(providerId=provider_id, credentialId=credential_id, apiKey=dummy_key)
            require(encrypted['encrypted'] is True, 'Database credential encryption verification failed')
            passed('HTTP credential is encrypted in PostgreSQL and metadata is redacted')

            model = api.call('/v1/admin/ai/models', method='POST', token=token, status=(200, 201), body={
                'providerId': provider_id, 'modelId': 'render-explicit-model', 'enabled': True,
                'isDefault': False, 'premium': False, 'capabilities': ['chat'], 'allowedTools': [],
                'maxInputTokens': 128, 'maxOutputTokens': 64, 'contextTokens': 256})
            require(any(entry['id'] == model['id'] for entry in api.call('/v1/admin/ai/models', token=token)),
                    'Explicit model metadata was not stored in the registry')
            passed('explicit model registration requires no provider discovery or generation')

            before = app.database()
            stale_provider = {**provider, 'id': 'stale-' + run_id, 'enabled': False}
            api.call('/v1/admin/ai/providers/' + stale_provider['id'] + '/config', method='PUT',
                token=token, status=409, body={'expectedRevision': configured['revision'],
                                             'provider': stale_provider})
            require(app.database() == before,
                    'Stale configuration changed vault/provider/audit/quota state')
            api.call('/v1/admin/ai/providers/' + provider_id + '/credentials', method='POST',
                token=token, status=409, body={'expectedRevision': configured['revision'],
                    'id': 'stale-credential', 'apiKey': dummy_key, 'enabled': True,
                    'endpointIds': ['dummy-endpoint'], 'limits': limits})
            require(app.database() == before,
                    'Stale credential changed vault/provider/audit/quota state')
            passed('stale CAS returns 409 and rolls back provider, audit and quota lock changes')

            before = app.database()
            rendezvous = threading.Barrier(2)

            def competing_update(priority):
                rendezvous.wait(timeout=5)
                return LocalApi(api.base).call('/v1/admin/ai/providers/' + provider_id + '/config',
                    method='PUT', token=token, status=(200, 409),
                    body={'expectedRevision': metadata['revision'],
                          'provider': {**provider, 'priority': priority}})

            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                updates = list(executor.map(competing_update, [1, 2]))
            winners = [result for result in updates if 'revision' in result]
            require(len(winners) == 1, 'Concurrent HTTP updates did not produce one CAS winner and one 409')
            require(winners[0]['revision'] == metadata['revision'] + 1,
                    'Concurrent HTTP updates advanced the vault revision more than once')
            metadata = winners[0]
            redacted(metadata)
            after = app.database(providerId=provider_id, credentialId=credential_id, apiKey=dummy_key)
            require(after['auditCount'] == before['auditCount'] + 1 and
                    after['lockVersion'] == before['lockVersion'] + 1 and
                    after['modelsHash'] == before['modelsHash'] and
                    after['usageCount'] == before['usageCount'],
                    'Concurrent CAS loser did not roll back its audit/quota transaction')
            require(after['encrypted'] is True,
                    'Provider metadata CAS did not preserve authenticated credential decryption')
            passed('concurrent HTTP CAS commits one transaction and rebinds encrypted credential metadata')

            app.start(AI_PROVIDERS_CONFIG_PATH=str(directory / 'missing' / 'vault.enc.json'))
            require(api.call('/v1/admin/ai/vault', token=token) == metadata,
                    'Database vault metadata did not survive an application restart')
            require(app.database(providerId=provider_id, credentialId=credential_id,
                                 apiKey=dummy_key)['encrypted'] is True,
                    'Restarted database vault credential is not decryptable')
            require(any(entry['id'] == model['id'] for entry in api.call('/v1/admin/ai/models', token=token)),
                    'Explicit model registry did not survive application restart')
            require(not (directory / 'missing').exists(), 'Database vault created its unused filesystem path')
            passed('vault revision, credential and registry survive restart without persistent disk')

            before = app.database()
            app.start(AI_CREDENTIALS_MASTER_KEY=wrong_key)
            unavailable = api.call('/v1/admin/ai/vault', token=token, status=503)
            require(dummy_key not in json.dumps(unavailable), 'Wrong-key error exposed a credential')
            api.call('/v1/admin/ai/providers/' + provider_id + '/config', method='PUT',
                token=token, status=503, body={'expectedRevision': metadata['revision'], 'provider': provider})
            require(app.database() == before,
                    'Wrong master key changed vault/provider/audit/quota state')
            app.start()
            require(api.call('/v1/admin/ai/vault', token=token) == metadata,
                    'Restoring the original master key did not restore readable vault metadata')
            require(app.database(providerId=provider_id, credentialId=credential_id,
                                 apiKey=dummy_key)['encrypted'] is True,
                    'Restoring the original master key did not restore credential decryption')
            passed('wrong master key fails closed with 503 and no mutation; original key restores access')

            require(app.database()['usageCount'] == encrypted['usageCount'],
                    'Configuration-only regression unexpectedly created provider usage')
        except Exception as error:
            failure = str(error) if isinstance(error, AssertionError) else type(error).__name__
        finally:
            app.stop()
            # Do not print private logs even if a key was accidentally logged.
            sensitive = [dummy_key, cfg['AI_CREDENTIALS_MASTER_KEY'], wrong_key,
                         fixture['adminPassword'], student_password if 'student_password' in locals() else '']
            if any(value and value in log.read_text(errors='replace')
                   for log in app.logs for value in sensitive):
                failure = 'Private backend logs contained fixture credential material'
            report = {'status': 'failed' if failure else 'passed', 'results': results,
                      'providerGenerationOrDiscoveryEndpointsCalled': 0}
            if failure:
                report['error'] = failure
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(report, indent=2) + '\n')
        if failure:
            print('FAIL', failure, flush=True)
            return 1
    print('PASS all Render database-vault fullstack assertions', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
