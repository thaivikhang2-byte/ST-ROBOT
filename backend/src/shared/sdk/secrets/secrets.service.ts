// ═══════════════════════════════════════════
// Secrets SDK — Secrets Service
// Abstraction layer for secrets management
// ═══════════════════════════════════════════

import { Injectable } from '@nestjs/common';
import { ISecretsProvider } from './providers/secrets-provider.interface';
import { EnvSecretsProvider } from './providers/env.provider';
import { DockerSecretsProvider } from './providers/docker-secrets.provider';

@Injectable()
export class SecretsService {
  private provider: ISecretsProvider;

  constructor() {
    this.provider = this.resolveProvider();
  }

  async get(key: string): Promise<string | undefined> {
    return this.provider.get(key);
  }

  async getOrThrow(key: string): Promise<string> {
    const value = await this.provider.get(key);
    if (value === undefined) {
      throw new Error(`Secret "${key}" not found in provider "${this.provider.name}"`);
    }
    return value;
  }

  async has(key: string): Promise<boolean> {
    return this.provider.has(key);
  }

  getProviderName(): string {
    return this.provider.name;
  }

  private resolveProvider(): ISecretsProvider {
    const provider = process.env.SECRETS_PROVIDER || 'env';

    switch (provider) {
      case 'docker-secrets':
        return new DockerSecretsProvider();
      // case 'vault':
      //   return new VaultSecretsProvider();
      case 'env':
      default:
        return new EnvSecretsProvider();
    }
  }
}
