import { ProviderLeases, type ProviderLease } from './provider-leases';
import { AiError } from './ai.error';
import { ErrorCode } from '../../shared/sdk/errors/error-codes.enum';
import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import type { VaultProvider } from './vault/vault-schema';

function providerFixture(id: string, credentialIds = ['bad', 'good']): VaultProvider {
  const limits = { requestsPerMinute: 100, tokensPerDay: 10000, maxConcurrent: 10 };
  return {
    id, type: 'openai-compatible', enabled: true, accountGroup: id, privacyGroup: id,
    selection: 'priority', timeoutMs: 1000, maxRetries: 0, priority: 1,
    models: ['fixture-model'], limits,
    endpoints: [{ id: 'official', baseUrl: 'https://provider.fixture.invalid/v1', enabled: true,
      capabilities: ['chat'] }],
    credentials: credentialIds.map(key => ({ id: key, enabled: true, endpointIds: ['official'], limits,
      encrypted: { version: 1, algorithm: 'aes-256-gcm', keyId: 'fixture', iv: '', authTag: '', ciphertext: '' } })),
  };
}

function vaultFixture(provider: VaultProvider) {
  return { read: async () => ({ version: 1, revision: 2, providers: [provider] }),
    config: { allowedEndpoints: ['https://provider.fixture.invalid/v1'] } };
}

describe('Provider credential authentication cooldown', () => {
  const lease = { id: 'fixture-lease', provider: { id: 'fixture-provider' }, reserved: 0,
    keys: ['account-minute', 'account-day', 'account-active', 'credential-minute', 'credential-day',
      'credential-active', 'account-cooldown', 'credential-cooldown', 'endpoint-cooldown', 'lease-key'],
  } as unknown as ProviderLease;

  function setup() {
    const client = { eval: jest.fn().mockResolvedValue(1), set: jest.fn().mockResolvedValue('OK') };
    return { client, service: new ProviderLeases({} as never,
      { getClient: () => client } as never) };
  }

  it.each([
    { status: 401 }, { status: 403 },
    new AiError(ErrorCode.AI_PROVIDER_AUTH_FAILED, 503, 'Credentials rejected', undefined,
      { retryable: false, upstreamStatus: 400 }),
  ])('temporarily cools only the rejected credential while preserving release accounting', async (error) => {
    const { client, service } = setup();
    await service.finish(lease, null, error);
    expect(client.eval).toHaveBeenCalledWith(expect.any(String), lease.keys.length,
      ...lease.keys, lease.id, 0);
    expect(client.set).toHaveBeenCalledTimes(1);
    expect(client.set).toHaveBeenCalledWith('credential-cooldown', 'auth', 'EX', 300);
  });

  it('does not cool down a credential for an ordinary model-options 400', async () => {
    const { client, service } = setup();
    await service.finish(lease, null, { status: 400 });
    expect(client.eval).toHaveBeenCalledTimes(1);
    expect(client.set).not.toHaveBeenCalled();
  });

  it.each([[429, 'account-cooldown', 60], [503, 'endpoint-cooldown', 30]] as const)
  ('retains the existing upstream %i cooldown scope', async (status, key, seconds) => {
    const { client, service } = setup();
    await service.finish(lease, null, { status });
    expect(client.set).toHaveBeenCalledTimes(1);
    expect(client.set).toHaveBeenCalledWith(key, '1', 'EX', seconds);
  });
});

describe('Provider credential admission failure classification', () => {
  function setup(results: number[], ids = ['bad', 'good']) {
    const provider = providerFixture('fixture-provider', ids);
    const client = { eval: jest.fn(), set: jest.fn().mockResolvedValue('OK') };
    for (const result of results) client.eval.mockResolvedValueOnce(result);
    return { client, service: new ProviderLeases(vaultFixture(provider) as never,
      { getClient: () => client } as never) };
  }

  it('preserves rejected authentication when every eligible credential is cooling down', async () => {
    const { service, client } = setup([-2, -2]);
    await expect(service.acquire('fixture-provider', 'fixture-model', 'chat', 10))
      .rejects.toMatchObject({ code: ErrorCode.AI_PROVIDER_AUTH_FAILED, retryable: false });
    expect(client.eval).toHaveBeenCalledTimes(2);
    expect(client.set).not.toHaveBeenCalled();
  });

  it('keeps mixed authentication and other admission failures generic', async () => {
    const { service } = setup([-2, 0]);
    await expect(service.acquire('fixture-provider', 'fixture-model', 'chat', 10))
      .rejects.toMatchObject({ code: ErrorCode.AI_PROVIDER_UNAVAILABLE });
  });

  it('admits a different configured credential without retrying a rejected credential', async () => {
    const { service, client } = setup([-2, 1]);
    const admitted = await service.acquire('fixture-provider', 'fixture-model', 'chat', 10);
    expect(admitted.credential.id).toBe('good');
    expect(client.eval).toHaveBeenCalledTimes(2);
  });

  it('keeps the shared account quota authoritative', async () => {
    const { service } = setup([-2, -1]);
    await expect(service.acquire('fixture-provider', 'fixture-model', 'chat', 10))
      .rejects.toMatchObject({ code: ErrorCode.AI_QUOTA_EXCEEDED });
  });

  it('does not label absent eligible pairs or Redis failures as rejected authentication', async () => {
    const absent = setup([], []);
    await expect(absent.service.acquire('fixture-provider', 'fixture-model', 'chat', 10))
      .rejects.toMatchObject({ code: ErrorCode.AI_PROVIDER_UNAVAILABLE });
    expect(absent.client.eval).not.toHaveBeenCalled();
    const broken = setup([]);
    broken.client.eval.mockRejectedValue(new Error('Fixture Redis unavailable'));
    await expect(broken.service.acquire('fixture-provider', 'fixture-model', 'chat', 10))
      .rejects.toMatchObject({ code: ErrorCode.AI_PROVIDER_UNAVAILABLE });
  });
});

// Opt-in real Lua regression. Only an explicitly selected loopback test Redis
// may be used; each test owns a random key namespace and never flushes a DB.
const redisTestUrl = process.env.STROBOT_TEST_REDIS_URL;
(redisTestUrl ? describe : describe.skip)('Provider credential admission against disposable Redis', () => {
  let client: Redis;
  let provider: VaultProvider;
  let service: ProviderLeases;
  let leases: ProviderLease[];

  beforeAll(async () => {
    let target: URL;
    try { target = new URL(redisTestUrl!); }
    catch { throw new Error('Disposable loopback Redis URL required'); }
    if (!['redis:', 'rediss:'].includes(target.protocol) ||
        !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))
      throw new Error('Disposable loopback Redis URL required');
    client = new Redis(target.href, { lazyConnect: true, connectTimeout: 2000,
      maxRetriesPerRequest: 1, retryStrategy: () => null });
    await client.connect();
  });

  beforeEach(() => {
    provider = providerFixture('lease-fixture-' + randomBytes(12).toString('hex'));
    service = new ProviderLeases(vaultFixture(provider) as never, { getClient: () => client } as never);
    leases = [];
  });

  afterEach(async () => {
    if (!client || !provider) return;
    const owned = new Set(leases.flatMap(lease => lease.keys));
    for (const pattern of [`ai-account:${provider.id}:*`, `ai-credential:${provider.id}:*`,
      `ai-cooldown:account:${provider.id}`, `ai-cooldown:credential:${provider.id}:*`,
      `ai-cooldown:endpoint:${provider.id}:*`, `ai-last-success:${provider.id}`]) {
      let cursor = '0';
      do {
        const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = next;
        keys.forEach(key => owned.add(key));
      } while (cursor !== '0');
    }
    if (owned.size) await client.del(...owned);
  });

  afterAll(async () => { if (client) await client.quit(); });

  async function acquire() {
    const lease = await service.acquire(provider.id, 'fixture-model', 'chat', 10);
    leases.push(lease);
    return lease;
  }
  const cooldown = (id: string) => `ai-cooldown:credential:${provider.id}:${id}`;
  const accountDay = () => `ai-account:${provider.id}:d:${new Date().toISOString().slice(0, 10)}`;

  it('keeps the cause after a real authentication rejection and does not reserve another attempt', async () => {
    provider.credentials = provider.credentials.slice(0, 1);
    const first = await acquire();
    await service.finish(first, null, { status: 401 });
    expect(await client.get(cooldown('bad'))).toBe('auth');
    expect(await client.ttl(cooldown('bad'))).toBeGreaterThan(0);
    expect(await client.ttl(cooldown('bad'))).toBeLessThanOrEqual(300);
    const dayBefore = await client.get(accountDay());
    await expect(acquire()).rejects.toMatchObject({ code: ErrorCode.AI_PROVIDER_AUTH_FAILED });
    expect(await client.get(accountDay())).toBe(dayBefore);
    expect(await client.get(first.keys[0])).toBe('1');
    expect(await client.zcard(first.keys[2])).toBe(0);
  });

  it('skips a rejected key and admits another configured key with shared accounting', async () => {
    const first = await acquire();
    expect(first.credential.id).toBe('bad');
    await service.finish(first, null, { status: 403 });
    const second = await acquire();
    expect(second.credential.id).toBe('good');
    expect(await client.get(first.keys[0])).toBe('2');
    expect(await client.get(accountDay())).toBe('20');
    await service.finish(second, { inputTokens: 5, outputTokens: 5, totalTokens: 10 });
  });

  it.each(['auth', '1'])('recognizes %s authentication markers when all keys are blocked', async marker => {
    await client.set(cooldown('bad'), marker, 'EX', 300);
    await client.set(cooldown('good'), marker, 'EX', 300);
    await expect(acquire()).rejects.toMatchObject({ code: ErrorCode.AI_PROVIDER_AUTH_FAILED });
    expect(await client.get(accountDay())).toBeNull();
  });

  it('preserves account budget and account cooldown precedence over rejected authentication', async () => {
    await client.set(cooldown('bad'), 'auth', 'EX', 300);
    await client.set(cooldown('good'), 'auth', 'EX', 300);
    await client.set(accountDay(), String(provider.limits.tokensPerDay), 'EX', 300);
    await expect(acquire()).rejects.toMatchObject({ code: ErrorCode.AI_QUOTA_EXCEEDED });
    await client.del(accountDay());
    await client.set(`ai-cooldown:account:${provider.id}`, '1', 'EX', 60);
    await expect(acquire()).rejects.toMatchObject({ code: ErrorCode.AI_QUOTA_EXCEEDED });
  });

  it('does not label endpoint blocks, unknown cooldowns or mixed key limits as authentication', async () => {
    await client.set(cooldown('bad'), 'auth', 'EX', 300);
    await client.set(cooldown('good'), 'future-throttle', 'EX', 300);
    await expect(acquire()).rejects.toMatchObject({ code: ErrorCode.AI_PROVIDER_UNAVAILABLE });
    await client.set(cooldown('good'), 'auth', 'EX', 300);
    await client.set(`ai-cooldown:endpoint:${provider.id}:official`, '1', 'EX', 30);
    await expect(acquire()).rejects.toMatchObject({ code: ErrorCode.AI_PROVIDER_UNAVAILABLE });
    await client.del(`ai-cooldown:endpoint:${provider.id}:official`, cooldown('good'));
    const minute = Math.floor(Date.now() / 60000);
    await client.set(`ai-credential:${provider.id}:good:m:${minute}`,
      String(provider.credentials[1].limits.requestsPerMinute), 'EX', 120);
    await expect(acquire()).rejects.toMatchObject({ code: ErrorCode.AI_PROVIDER_UNAVAILABLE });
  });
});
