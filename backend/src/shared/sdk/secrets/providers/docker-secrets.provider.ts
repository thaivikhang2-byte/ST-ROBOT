// ═══════════════════════════════════════════
// Secrets SDK — Docker Secrets Provider
// Reads from /run/secrets/ (Docker Swarm)
// ═══════════════════════════════════════════

import * as fs from 'fs';
import * as path from 'path';
import { ISecretsProvider } from './secrets-provider.interface';

export class DockerSecretsProvider implements ISecretsProvider {
  readonly name = 'docker-secrets';
  private readonly basePath = '/run/secrets';

  async get(key: string): Promise<string | undefined> {
    const filePath = path.join(this.basePath, key.toLowerCase());
    try {
      return fs.readFileSync(filePath, 'utf-8').trim();
    } catch {
      return undefined;
    }
  }

  async has(key: string): Promise<boolean> {
    const filePath = path.join(this.basePath, key.toLowerCase());
    return fs.existsSync(filePath);
  }
}
