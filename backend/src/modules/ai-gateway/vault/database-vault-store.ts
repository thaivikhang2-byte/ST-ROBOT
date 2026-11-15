import type { Prisma } from '@prisma/client';
import { EncryptedVaultStore, VaultConflict } from './vault-store-base';
import { AiVault } from './vault-schema';

export type VaultDatabaseClient = Pick<Prisma.TransactionClient, 'aiProviderVault'>;

/** PostgreSQL stores exactly the same encrypted envelope as the file backend. */
export class DatabaseVaultStore extends EncryptedVaultStore {
  constructor(
    private readonly database: VaultDatabaseClient,
    encodedKey: string,
    keyId: string,
  ) { super(encodedKey, keyId); }

  private async current(key: Buffer) {
    const row = await this.database.aiProviderVault.findUnique({ where: { id: 'default' } });
    if (!row) return { row: null, vault: { version: 1, revision: 0, providers: [] } as AiVault };
    const vault = this.authenticate(row.payload, key);
    if (BigInt(vault.revision) !== row.revision) throw new Error('Invalid AI vault revision');
    return { row, vault };
  }

  async read(): Promise<AiVault> {
    const key = this.key();
    try { return (await this.current(key)).vault; }
    finally { key.fill(0); }
  }

  async update(
    expectedRevision: number,
    change: (vault: AiVault, key: Buffer) => void,
  ): Promise<AiVault> {
    const key = this.key();
    try {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER)
        throw new VaultConflict('AI vault revision changed');
      const { row, vault } = await this.current(key);
      if (vault.revision !== expectedRevision) throw new VaultConflict('AI vault revision changed');
      change(vault, key);
      vault.revision = expectedRevision + 1;
      // Preserve property order: PostgreSQL JSONB normalization would invalidate existing AAD.
      const payload = JSON.stringify(vault);
      this.authenticate(payload, key);
      const result = row
        ? await this.database.aiProviderVault.updateMany({
          where: { id: 'default', revision: BigInt(expectedRevision) },
          data: { revision: BigInt(vault.revision), payload, backup_payload: row.payload },
        })
        : await this.database.aiProviderVault.createMany({
          data: [{ id: 'default', revision: BigInt(vault.revision), payload }],
          // Do not catch a unique violation inside an outer PostgreSQL transaction.
          skipDuplicates: true,
        });
      if (result.count !== 1) throw new VaultConflict('AI vault revision changed');
      return vault;
    } finally { key.fill(0); }
  }

  async rotate(_expectedRevision: number, _newEncodedKey: string, _newKeyId: string): Promise<number> {
    throw new Error('Database vault rotation requires a coordinated database maintenance procedure');
  }
  async restoreBackup(_expectedRevision: number): Promise<number> {
    throw new Error('Database vault recovery uses an authenticated PostgreSQL backup');
  }
}
