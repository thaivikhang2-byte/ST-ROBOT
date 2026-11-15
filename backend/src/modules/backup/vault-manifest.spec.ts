import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { encryptStream } from './backup-crypto';
import { readManifest } from './restore-disposable';
import type { BackupManifest, BackupPart } from './backup.service';

const part = (file: string): BackupPart => ({ file, sha256: 'a'.repeat(64), plainSha256: 'b'.repeat(64), bytes: 10, encryptedBytes: 45 });
async function read(value: BackupManifest) {
  const directory = await mkdtemp(join(tmpdir(), 'strobot-vault-manifest-'));
  const key = randomBytes(32);
  try {
    await encryptStream(Readable.from(JSON.stringify(value)), join(directory, 'manifest.enc'), key, 100000);
    return await readManifest(directory, key);
  } finally { key.fill(0); await rm(directory, { recursive: true, force: true }); }
}
const manifest = (): BackupManifest => ({ version: 1, id: 'fixture', snapshotAt: new Date().toISOString(),
  migrations: [], parts: [part('database.enc')], bucket: null, vault: false, requiredKeys: [], limitations: [] });

describe('Encrypted vault backup storage provenance', () => {
  it('accepts the vault within the database dump without inventing a filesystem artifact', async () => {
    const value = { ...manifest(), vault: true, vaultStorage: 'database' as const };
    expect(await read(value)).toEqual(value);
  });
  it('keeps prior valid file-vault archives compatible', async () => {
    const value = { ...manifest(), vault: true, parts: [part('database.enc'), part('vault.enc')] };
    expect(await read(value)).toEqual(value);
  });
  it('rejects ambiguous database and separate-file vault sources', async () => {
    await expect(read({ ...manifest(), vault: true, vaultStorage: 'database',
      parts: [part('database.enc'), part('vault.enc')] })).rejects.toThrow('Database vault');
  });
  it('rejects missing or unclaimed file-vault parts', async () => {
    await expect(read({ ...manifest(), vault: true })).rejects.toThrow('Vault archive metadata');
    await expect(read({ ...manifest(), parts: [part('database.enc'), part('vault.enc')] })).rejects.toThrow('Vault archive metadata');
  });
});
