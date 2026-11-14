import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AiVault,
  VaultProvider,
  VaultCredential,
  validateVault,
  credentialAad,
} from './vault-schema';
import { masterKey, encryptCredential, decryptCredential } from './credential-crypto';

export class VaultConflict extends Error {}
const isFsCode = (error: unknown, code: string) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === code;
export class VaultStore {
  readonly filename: string;
  constructor(
    filename: string,
    private readonly encodedKey: string,
    readonly keyId: string,
  ) {
    if (
      !filename ||
      filename.includes('\0') ||
      filename.split(/[/\\]/).includes('..') ||
      path.extname(filename) !== '.json'
    )
      throw new Error('Invalid deployment vault path');
    this.filename = path.resolve(filename);
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(keyId)) throw new Error('Invalid AI vault key version');
  }
  private key() {
    return masterKey(this.encodedKey);
  }
  private async directory() {
    const parent = path.dirname(this.filename);
    await fs.mkdir(parent, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe AI vault directory');
  }
  private async parse(filename: string, key: Buffer, keyId = this.keyId): Promise<AiVault> {
    const stat = await fs.lstat(filename);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 1048576 ||
      (process.platform !== 'win32' &&
        ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))
    )
      throw new Error('Unsafe AI vault file');
    const vault = validateVault(JSON.parse(await fs.readFile(filename, 'utf8')) as unknown);
    for (const provider of vault.providers)
      for (const credential of provider.credentials) {
        const plaintext = decryptCredential(
          credential.encrypted,
          key,
          keyId,
          credentialAad(provider, credential, keyId),
        );
        plaintext.fill(0);
      }
    return vault;
  }
  async read(): Promise<AiVault> {
    const key = this.key();
    try {
      return await this.parse(this.filename, key);
    } catch (error) {
      if (isFsCode(error, 'ENOENT')) return { version: 1, revision: 0, providers: [] };
      throw error;
    } finally {
      key.fill(0);
    }
  }
  decrypt(provider: VaultProvider, credential: VaultCredential): Buffer {
    const key = this.key();
    try {
      return decryptCredential(
        credential.encrypted,
        key,
        this.keyId,
        credentialAad(provider, credential, this.keyId),
      );
    } finally {
      key.fill(0);
    }
  }
  private async atomic(vault: AiVault, key: Buffer, keyId: string, backup = true) {
    const temp = `${this.filename}.tmp-${randomUUID()}`;
    const backupTemp = `${this.filename}.bak.tmp-${randomUUID()}`;
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(temp, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(vault, null, 2) + '\n');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.parse(temp, key, keyId);
      if (backup)
        try {
          await fs.copyFile(this.filename, backupTemp, constants.COPYFILE_EXCL);
          await fs.chmod(backupTemp, 0o600);
          const handle = await fs.open(backupTemp, 'r+');
          try {
            await handle.sync();
          } finally {
            await handle.close();
          }
          await fs.rename(backupTemp, `${this.filename}.bak`);
        } catch (error) {
          if (!isFsCode(error, 'ENOENT')) throw error;
        }
      await fs.rename(temp, this.filename);
      if (process.platform !== 'win32') {
        const dir = await fs.open(path.dirname(this.filename), 'r');
        try {
          await dir.sync();
        } finally {
          await dir.close();
        }
      }
    } finally {
      await handle?.close();
      await fs.unlink(temp).catch(() => undefined);
      await fs.unlink(backupTemp).catch(() => undefined);
    }
  }
  private async locked<T>(operation: () => Promise<T>) {
    await this.directory();
    let lock: Awaited<ReturnType<typeof fs.open>>;
    try {
      lock = await fs.open(`${this.filename}.lock`, 'wx', 0o600);
    } catch (error) {
      if (isFsCode(error, 'EEXIST')) throw new VaultConflict('AI vault is being modified');
      throw error;
    }
    try {
      await lock.writeFile(
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
      );
      await lock.sync();
      return await operation();
    } finally {
      await lock.close();
      await fs.unlink(`${this.filename}.lock`);
    }
  }
  async update(
    expectedRevision: number,
    change: (vault: AiVault, key: Buffer) => void,
  ): Promise<AiVault> {
    return this.locked(async () => {
      const key = this.key();
      try {
        let current: AiVault;
        try {
          current = await this.parse(this.filename, key);
        } catch (error) {
          if (isFsCode(error, 'ENOENT')) current = { version: 1, revision: 0, providers: [] };
          else throw error;
        }
        if (current.revision !== expectedRevision)
          throw new VaultConflict('AI vault revision changed');
        change(current, key);
        current.revision++;
        validateVault(current);
        await this.atomic(current, key, this.keyId);
        return current;
      } finally {
        key.fill(0);
      }
    });
  }
  async replaceProvider(expectedRevision: number, provider: Omit<VaultProvider, 'credentials'>) {
    return this.update(expectedRevision, (vault, key) => {
      const index = vault.providers.findIndex((p) => p.id === provider.id),
        prior = vault.providers[index];
      const next: VaultProvider = { ...provider, credentials: [] };
      for (const credential of prior?.credentials ?? []) {
        const plaintext = decryptCredential(
          credential.encrypted,
          key,
          this.keyId,
          credentialAad(prior, credential, this.keyId),
        );
        try {
          next.credentials.push({
            ...credential,
            encrypted: encryptCredential(
              plaintext,
              key,
              this.keyId,
              credentialAad(next, credential, this.keyId),
            ),
          });
        } finally {
          plaintext.fill(0);
        }
      }
      if (index < 0) vault.providers.push(next);
      else vault.providers[index] = next;
    });
  }
  async addCredential(
    expectedRevision: number,
    providerId: string,
    credential: Omit<VaultCredential, 'encrypted'>,
    plaintext: Buffer,
  ) {
    return this.update(expectedRevision, (vault, key) => {
      const provider = vault.providers.find((p) => p.id === providerId);
      if (!provider) throw new Error('AI provider not configured');
      if (provider.credentials.some((c) => c.id === credential.id))
        throw new VaultConflict('AI credential ID already exists');
      provider.credentials.push({
        ...credential,
        encrypted: encryptCredential(
          plaintext,
          key,
          this.keyId,
          credentialAad(provider, credential, this.keyId),
        ),
      });
    });
  }
  async rotate(expectedRevision: number, newEncodedKey: string, newKeyId: string) {
    return this.locked(async () => {
      const oldKey = this.key();
      let nextKey: Buffer | undefined;
      try {
        nextKey = masterKey(newEncodedKey);
        if (
          newKeyId === this.keyId ||
          !/^[a-zA-Z0-9_-]{1,64}$/.test(newKeyId) ||
          oldKey.equals(nextKey)
        )
          throw new Error('Rotation requires new key material and version');
        const vault = await this.parse(this.filename, oldKey);
        if (vault.revision !== expectedRevision)
          throw new VaultConflict('AI vault revision changed');
        for (const provider of vault.providers)
          for (const credential of provider.credentials) {
            const plaintext = decryptCredential(
              credential.encrypted,
              oldKey,
              this.keyId,
              credentialAad(provider, credential, this.keyId),
            );
            try {
              credential.encrypted = encryptCredential(
                plaintext,
                nextKey,
                newKeyId,
                credentialAad(provider, credential, newKeyId),
              );
            } finally {
              plaintext.fill(0);
            }
          }
        vault.revision++;
        await this.atomic(vault, nextKey, newKeyId);
        return vault.revision;
      } finally {
        oldKey.fill(0);
        nextKey?.fill(0);
      }
    });
  }
  async restoreBackup(expectedRevision: number) {
    return this.locked(async () => {
      const key = this.key();
      try {
        const backup = await this.parse(`${this.filename}.bak`, key);
        try {
          const current = await this.parse(this.filename, key);
          if (current.revision !== expectedRevision)
            throw new VaultConflict('AI vault revision changed');
        } catch (error) {
          if (error instanceof VaultConflict)
            throw error; /* Explicit maintenance recovery may replace a corrupt file, only with a verified backup. */
        }
        backup.revision = expectedRevision + 1;
        await this.atomic(backup, key, this.keyId, false);
        return backup.revision;
      } finally {
        key.fill(0);
      }
    });
  }
}
