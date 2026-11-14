// ═══════════════════════════════════════════
// Secrets SDK — Vault Provider (stub)
// HashiCorp Vault integration
// ═══════════════════════════════════════════

import { ISecretsProvider } from './secrets-provider.interface';

/**
 * HashiCorp Vault secrets provider.
 *
 * TODO: Implement in Phase 13 (Production hardening)
 * - Vault API client
 * - Token renewal
 * - Secret caching with TTL
 */
export class VaultSecretsProvider implements ISecretsProvider {
  readonly name = 'vault';

  async get(key: string): Promise<string | undefined> {
    // Stub — will integrate with Vault API
    return undefined;
  }

  async has(key: string): Promise<boolean> {
    return false;
  }
}
