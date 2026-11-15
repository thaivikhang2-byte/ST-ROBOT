import { randomBytes } from 'node:crypto';
import { DatabaseVaultStore, VaultDatabaseClient } from './database-vault-store';
import { VaultConflict } from './vault-store';
import { VaultProvider } from './vault-schema';
import { AiVaultService } from './ai-vault.service';
import { PrismaService } from '../../../database/prisma.service';
import { VaultAdminService } from './vault-admin.service';
import { ProviderConfigurationDto } from './vault.dto';

const limits = { requestsPerMinute: 5, tokensPerDay: 50000, maxConcurrent: 2 };
const provider = (id = 'openai'): Omit<VaultProvider, 'credentials'> => ({
  id, type: 'openai', enabled: true, accountGroup: 'account-a', privacyGroup: 'school',
  models: ['approved-model'],
  endpoints: [{ id: 'official', baseUrl: 'https://api.openai.com/v1', enabled: true, capabilities: ['chat'] }],
  limits, timeoutMs: 60000, priority: 0, selection: 'priority', maxRetries: 0,
});
const credential = { id: 'key-one', enabled: true, endpointIds: ['official'], limits };
type Row = { id: string; revision: bigint; payload: string; backup_payload: string | null; updated_at: Date };

/** Affected-row CAS semantics, including the unique first insert, match PostgreSQL. */
function database() {
  let row: Row | null = null;
  const delegate = {
    findUnique: jest.fn(async () => row ? { ...row } : null),
    createMany: jest.fn(async ({ data }: { data: Row[] }) => {
      if (row) return { count: 0 };
      row = { ...data[0], backup_payload: null, updated_at: new Date() };
      return { count: 1 };
    }),
    updateMany: jest.fn(async ({ where, data }: { where: { revision: bigint }; data: Partial<Row> }) => {
      if (!row || row.revision !== where.revision) return { count: 0 };
      row = { ...row, ...data, updated_at: new Date() };
      return { count: 1 };
    }),
  };
  return {
    client: { aiProviderVault: delegate } as unknown as VaultDatabaseClient,
    delegate,
    raw: () => row,
    seed: (next: Row | null) => { row = next ? { ...next } : null; },
    corrupt: (change: (current: Row) => void) => { if (row) change(row); },
  };
}

describe('PostgreSQL encrypted deployment vault', () => {
  let db: ReturnType<typeof database>, encoded: string, store: DatabaseVaultStore;
  beforeEach(() => {
    db = database();
    encoded = randomBytes(32).toString('base64');
    store = new DatabaseVaultStore(db.client, encoded, 'v1');
  });

  it('reads absent configuration without creating a row and rejects missing master keys', async () => {
    expect(await store.read()).toEqual({ version: 1, revision: 0, providers: [] });
    expect(db.delegate.createMany).not.toHaveBeenCalled();
    await expect(new DatabaseVaultStore(db.client, '', 'v1').read()).rejects.toThrow();
  });

  it('persists ciphertext and decrypts after a new store/service instance without touching a vault path', async () => {
    await store.replaceProvider(0, provider());
    await store.addCredential(1, 'openai', credential, Buffer.from('database-test-secret'));
    const raw = db.raw()!;
    expect(raw.payload).not.toContain('database-test-secret');
    expect(raw.payload).not.toContain(encoded);
    expect(JSON.parse(raw.backup_payload!).revision).toBe(1);
    const restarted = new AiVaultService({
      storage: 'database', path: '\0invalid-file-path', masterKey: encoded, keyId: 'v1',
      allowedEndpoints: ['https://api.openai.com/v1'], allowLocalAdminHttp: false,
    }, db.client as PrismaService);
    const loaded = await restarted.read();
    const secret = restarted.secret(loaded.providers[0], loaded.providers[0].credentials[0]);
    expect(secret.toString()).toBe('database-test-secret');
    secret.fill(0);
    const metadata = await restarted.metadata();
    expect(metadata.providers[0].credentials[0]).toEqual(credential);
    expect(JSON.stringify(metadata)).not.toMatch(/ciphertext|authTag|encrypted|database-test-secret/);
  });

  it.each([0, 1])('admits only one concurrent writer at revision %i', async (revision) => {
    if (revision) await store.replaceProvider(0, provider());
    const other = new DatabaseVaultStore(db.client, encoded, 'v1');
    const outcomes = await Promise.allSettled([
      store.replaceProvider(revision, provider('two')),
      other.replaceProvider(revision, provider('three')),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(VaultConflict);
    expect((await store.read()).revision).toBe(revision + 1);
    await expect(store.replaceProvider(revision, provider('stale'))).rejects.toBeInstanceOf(VaultConflict);
  });

  it('rejects wrong keys, altered metadata and column/payload revision mismatch without overwriting', async () => {
    await store.replaceProvider(0, provider());
    await store.addCredential(1, 'openai', credential, Buffer.from('tamper-test-secret'));
    await expect(new DatabaseVaultStore(db.client, randomBytes(32).toString('base64'), 'v1').read()).rejects.toThrow();
    const snapshot = { ...db.raw()! };
    db.corrupt((row) => {
      const payload = JSON.parse(row.payload);
      payload.providers[0].models = ['changed-model'];
      row.payload = JSON.stringify(payload);
    });
    const corrupt = db.raw()!.payload;
    await expect(store.read()).rejects.toThrow();
    await expect(store.replaceProvider(2, provider())).rejects.toThrow();
    expect(db.raw()!.payload).toBe(corrupt);
    db.corrupt((row) => { Object.assign(row, snapshot); row.revision = 3n; });
    await expect(store.read()).rejects.toThrow('Invalid AI vault revision');
  });

  it('authenticates changed candidates before CAS and re-encrypts credentials when metadata changes', async () => {
    await store.replaceProvider(0, provider());
    await store.addCredential(1, 'openai', credential, Buffer.from('aad-test-secret'));
    const snapshot = { ...db.raw()! };
    await expect(store.update(2, (vault) => { vault.providers[0].priority = 1; })).rejects.toThrow();
    expect(db.raw()).toEqual(snapshot);
    const changed = await store.replaceProvider(2, { ...provider(), priority: 1 });
    const secret = store.decrypt(changed.providers[0], changed.providers[0].credentials[0]);
    expect(secret.toString()).toBe('aad-test-secret');
    secret.fill(0);
  });

  it('uses the outer admin transaction for encrypted writes, metadata, provider state and audit rollback', async () => {
    await store.replaceProvider(0, provider());
    await store.addCredential(1, 'openai', credential, Buffer.from('transaction-test-secret'));
    let failAudit = true, committedLocks = 0, committedAudits = 0, committedEnabled = true;
    const prisma = {
      ...db.client,
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => {
        const staged = database();
        staged.seed(db.raw());
        let locks = committedLocks, audits = committedAudits, enabled = committedEnabled;
        const result = await operation({
          ...staged.client,
          aiQuotaPolicy: { update: async () => { locks++; } },
          aiProvider: {
            findUnique: async () => ({ type: 'openai', enabled }),
            upsert: async ({ update }: { update: { enabled: boolean } }) => { enabled = update.enabled; },
          },
          auditLog: { create: async () => { if (failAudit) throw new Error('Audit unavailable'); audits++; } },
        });
        db.seed(staged.raw());
        committedLocks = locks; committedAudits = audits; committedEnabled = enabled;
        return result;
      },
    } as unknown as PrismaService;
    const service = new AiVaultService({ storage: 'database', path: 'unused.json', masterKey: encoded, keyId: 'v1', allowedEndpoints: ['https://api.openai.com/v1'], allowLocalAdminHttp: false }, prisma);
    const admin = new VaultAdminService(service, prisma);
    const dto = { expectedRevision: 2, provider: { ...provider(), enabled: false } } as ProviderConfigurationDto;
    const before = { ...db.raw()! };
    await expect(admin.configure('openai', dto, 'test-actor')).rejects.toThrow('Audit unavailable');
    expect(db.raw()).toEqual(before);
    expect([committedLocks, committedAudits, committedEnabled]).toEqual([0, 0, true]);
    failAudit = false;
    const result = await admin.configure('openai', dto, 'test-actor');
    expect(result.revision).toBe(3);
    expect(result.providers[0].enabled).toBe(false);
    expect([committedLocks, committedAudits, committedEnabled]).toEqual([1, 1, false]);
    const committed = { ...db.raw()! };
    await expect(admin.configure('openai', dto, 'test-actor')).rejects.toThrow('AI vault revision changed');
    expect(db.raw()).toEqual(committed);
    expect([committedLocks, committedAudits, committedEnabled]).toEqual([1, 1, false]);
  });

  it('fails closed when database mode has no client and rejects file maintenance operations', async () => {
    const service = new AiVaultService({ storage: 'database', path: 'unused.json', masterKey: encoded, keyId: 'v1', allowedEndpoints: [], allowLocalAdminHttp: false });
    await expect(service.read()).rejects.toThrow('Encrypted AI configuration unavailable');
    await expect(store.rotate(0, encoded, 'v2')).rejects.toThrow('database maintenance');
    await expect(store.restoreBackup(0)).rejects.toThrow('PostgreSQL backup');
    expect(db.raw()).toBeNull();
  });
});
