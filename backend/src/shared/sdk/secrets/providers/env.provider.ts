// ═══════════════════════════════════════════
// Secrets SDK — Env Provider (default)
// Reads from process.env
// ═══════════════════════════════════════════

import { ISecretsProvider } from './secrets-provider.interface';

export class EnvSecretsProvider implements ISecretsProvider {
  readonly name = 'env';

  async get(key: string): Promise<string | undefined> {
    return process.env[key];
  }

  async has(key: string): Promise<boolean> {
    return key in process.env;
  }
}
