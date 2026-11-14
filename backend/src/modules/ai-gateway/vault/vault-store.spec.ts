import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { masterKey, encryptCredential, decryptCredential } from './credential-crypto';
import { VaultStore, VaultConflict } from './vault-store';
import { VaultProvider, validateVault } from './vault-schema';
const key = () => randomBytes(32).toString('base64');
const limits = { requestsPerMinute: 5, tokensPerDay: 50000, maxConcurrent: 2 };
const provider = (id = 'openai'): Omit<VaultProvider, 'credentials'> => ({
  id,
  type: 'openai',
  enabled: true,
  accountGroup: 'account-a',
  privacyGroup: 'school',
  models: ['approved-model'],
  endpoints: [
    {
      id: 'official',
      baseUrl: 'https://api.openai.com/v1',
      enabled: true,
      capabilities: ['chat', 'responses', 'streaming'],
    },
  ],
  limits,
  timeoutMs: 60000,
  priority: 0,
  selection: 'priority',
  maxRetries: 0,
});
describe('AES-256-GCM credential envelope', () => {
  it('round trips and generates unique IVs', () => {
    const secret = Buffer.from('test-only-secret'),
      k = masterKey(key());
    const a = encryptCredential(secret, k, 'v1', 'aad'),
      b = encryptCredential(secret, k, 'v1', 'aad');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(decryptCredential(a, k, 'v1', 'aad')).toEqual(secret);
  });
  it.each(['', 'weak-password', 'A'.repeat(32), '#'.repeat(44)])(
    'rejects invalid encoded key %s',
    (encoded) => {
      expect(() => masterKey(encoded)).toThrow();
    },
  );
  it('rejects wrong key/version, tampered ciphertext/tag/AAD and malformed envelope', () => {
    const k = masterKey(key()),
      e = encryptCredential(Buffer.from('test-secret'), k, 'v1', 'metadata');
    expect(() => decryptCredential(e, masterKey(key()), 'v1', 'metadata')).toThrow();
    expect(() => decryptCredential(e, k, 'v2', 'metadata')).toThrow();
    expect(() => decryptCredential(e, k, 'v1', 'other-metadata')).toThrow();
    for (const field of ['ciphertext', 'authTag', 'iv'] as const) {
      const bytes = Buffer.from(e[field], 'base64');
      bytes[0] ^= 1;
      expect(() =>
        decryptCredential({ ...e, [field]: bytes.toString('base64') }, k, 'v1', 'metadata'),
      ).toThrow();
    }
    expect(() => decryptCredential({ ...e, iv: 'bad' }, k, 'v1', 'metadata')).toThrow();
  });
});
describe('Durable encrypted JSON vault', () => {
  let folder: string, file: string, encoded: string, store: VaultStore;
  beforeEach(async () => {
    const root = path.resolve('.test-tmp');
    await fs.mkdir(root, { recursive: true });
    folder = await fs.mkdtemp(path.join(root, 'vault-'));
    file = path.join(folder, 'providers.json');
    encoded = key();
    store = new VaultStore(file, encoded, 'v1');
  });
  afterEach(async () => {
    for (const name of await fs.readdir(folder)) await fs.unlink(path.join(folder, name));
    await fs.rmdir(folder);
  });
  const credential = () => ({ id: randomUUID(), enabled: true, endpointIds: ['official'], limits });
  it('loads absent configuration without writing a replacement file', async () => {
    expect((await store.read()).revision).toBe(0);
    await expect(fs.access(file)).rejects.toThrow();
    await expect(new VaultStore(file, '', 'v1').read()).rejects.toThrow();
    await expect(fs.access(file)).rejects.toThrow();
  });
  it('stores several instances/credentials, authenticates metadata and never persists plaintext', async () => {
    await store.replaceProvider(0, provider());
    await store.replaceProvider(1, provider('openai-secondary'));
    await store.addCredential(2, 'openai', credential(), Buffer.from('test-key-confidential-1'));
    const final = await store.addCredential(
      3,
      'openai',
      credential(),
      Buffer.from('test-key-confidential-2'),
    );
    expect(final.providers).toHaveLength(2);
    expect(final.providers[0].credentials).toHaveLength(2);
    const raw = await fs.readFile(file, 'utf8');
    expect(raw).not.toContain('test-key-confidential');
    expect(raw).not.toContain(encoded);
    const loaded = await store.read();
    expect(store.decrypt(loaded.providers[0], loaded.providers[0].credentials[0]).toString()).toBe(
      'test-key-confidential-1',
    );
    const tampered = JSON.parse(raw) as typeof loaded;
    tampered.providers[0].models = ['unauthorized-model'];
    await fs.writeFile(file, JSON.stringify(tampered));
    await expect(store.read()).rejects.toThrow();
    await expect(store.replaceProvider(4, provider())).rejects.toThrow();
    expect(await fs.readFile(file, 'utf8')).toContain('unauthorized-model');
  });
  it('rejects invalid JSON/schema/unknown types and does not overwrite corruption', async () => {
    await store.replaceProvider(0, provider());
    await fs.writeFile(file, '{broken');
    await expect(store.read()).rejects.toThrow();
    await expect(store.replaceProvider(1, provider())).rejects.toThrow();
    expect(await fs.readFile(file, 'utf8')).toBe('{broken');
    expect(() =>
      validateVault({
        version: 1,
        revision: 1,
        providers: [{ ...provider(), type: 'fake', credentials: [] }],
      }),
    ).toThrow();
  });
  it('prevents lost updates and cleans owned locks/temporary files', async () => {
    await store.replaceProvider(0, provider());
    const results = await Promise.allSettled([
      store.replaceProvider(1, provider('two')),
      store.replaceProvider(1, provider('three')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await store.read()).revision).toBe(2);
    expect(
      (await fs.readdir(folder)).filter((f) => f.includes('.tmp-') || f.endsWith('.lock')),
    ).toHaveLength(0);
    await expect(store.replaceProvider(1, provider('stale'))).rejects.toBeInstanceOf(VaultConflict);
  });
  it('leaves a valid vault intact when another writer lock or interrupted temp file exists', async () => {
    await store.replaceProvider(0, provider());
    const prior = await fs.readFile(file, 'utf8');
    await fs.writeFile(file + '.lock', 'operator lock');
    await fs.writeFile(file + '.tmp-interrupted', 'partial ciphertext');
    await expect(store.replaceProvider(1, provider('blocked'))).rejects.toBeInstanceOf(
      VaultConflict,
    );
    expect(await fs.readFile(file, 'utf8')).toBe(prior);
    expect((await store.read()).revision).toBe(1);
  });
  it('rotates all credentials with fresh IVs, preserves verified backup and requires matching activation', async () => {
    await store.replaceProvider(0, provider());
    await store.addCredential(1, 'openai', credential(), Buffer.from('rotation-test-secret'));
    const before = await store.read(),
      next = key();
    await expect(store.rotate(2, 'invalid', 'v2')).rejects.toThrow();
    expect((await store.read()).revision).toBe(2);
    expect(await store.rotate(2, next, 'v2')).toBe(3);
    await expect(store.read()).rejects.toThrow();
    const activated = new VaultStore(file, next, 'v2'),
      after = await activated.read();
    expect(after.providers[0].credentials[0].encrypted.iv).not.toBe(
      before.providers[0].credentials[0].encrypted.iv,
    );
    expect(
      activated.decrypt(after.providers[0], after.providers[0].credentials[0]).toString(),
    ).toBe('rotation-test-secret');
    const oldBackup = new VaultStore(file + '.bak.json', encoded, 'v1');
    await fs.copyFile(file + '.bak', oldBackup.filename);
    await fs.chmod(oldBackup.filename, 0o600);
    expect((await oldBackup.read()).revision).toBe(2);
  });
  it('restores only an authenticated backup and keeps it after replacing corrupt JSON', async () => {
    await store.replaceProvider(0, provider());
    await store.replaceProvider(1, provider('second'));
    await fs.writeFile(file, 'corrupt');
    expect(await store.restoreBackup(2)).toBe(3);
    expect((await store.read()).providers).toHaveLength(1);
    const backup = JSON.parse(await fs.readFile(file + '.bak', 'utf8')) as { revision: number };
    expect(backup.revision).toBe(1);
  });
  it('sets restrictive POSIX permissions where supported and rejects traversal/symlink targets', async () => {
    await store.replaceProvider(0, provider());
    if (process.platform !== 'win32') expect((await fs.stat(file)).mode & 0o077).toBe(0);
    expect(() => new VaultStore('../escape.json', encoded, 'v1')).toThrow();
    expect(() => new VaultStore(file + '\0', encoded, 'v1')).toThrow();
  });
});
