import { masterKey, encryptCredential, decryptCredential } from './credential-crypto';
import { AiVault, VaultProvider, VaultCredential, credentialAad, validateVault } from './vault-schema';

export class VaultConflict extends Error {}

/** Shared encryption and provider mutations; storage backends contain ciphertext only. */
export abstract class EncryptedVaultStore {
  constructor(private readonly encodedKey: string, readonly keyId: string) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(keyId)) throw new Error('Invalid AI vault key version');
  }
  protected key() { return masterKey(this.encodedKey); }
  protected authenticate(payload: string, key: Buffer, keyId = this.keyId): AiVault {
    if (Buffer.byteLength(payload, 'utf8') > 1048576) throw new Error('Invalid AI vault size');
    const vault = validateVault(JSON.parse(payload) as unknown);
    for (const provider of vault.providers)
      for (const credential of provider.credentials) {
        const plaintext = decryptCredential(credential.encrypted, key, keyId, credentialAad(provider, credential, keyId));
        plaintext.fill(0);
      }
    return vault;
  }
  abstract read(): Promise<AiVault>;
  abstract update(expectedRevision: number, change: (vault: AiVault, key: Buffer) => void): Promise<AiVault>;
  abstract rotate(expectedRevision: number, newEncodedKey: string, newKeyId: string): Promise<number>;
  abstract restoreBackup(expectedRevision: number): Promise<number>;
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
}
