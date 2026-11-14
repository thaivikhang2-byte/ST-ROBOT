import { ConfigService } from '@nestjs/config';
import { ProviderClients } from './provider-clients';
import { AiVaultService } from './vault/ai-vault.service';
import { ProviderTransport } from './secure-provider-fetch';
import { ProviderLease, ProviderLeases } from './provider-leases';
import { VaultProvider } from './vault/vault-schema';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

describe('Provider client security configuration', () => {
  it('pins official hosts, disables SDK retries and reloads keys per request for rotation', async () => {
    const root = path.resolve('.test-tmp');
    await fs.mkdir(root, { recursive: true });
    const folder = await fs.mkdtemp(path.join(root, 'clients-'));
    const vault = new AiVaultService({
      path: path.join(folder, 'vault.json'),
      masterKey: randomBytes(32).toString('base64'),
      keyId: 'v1',
      allowedEndpoints: ['https://api.openai.com/v1', 'https://api.anthropic.com'],
      allowLocalAdminHttp: false,
    });
    const transport = new ProviderTransport();
    const clients = new ProviderClients(
      vault,
      transport,
      {} as ProviderLeases,
      new ConfigService({ AI_REQUEST_TIMEOUT_MS: 1000 }),
    );
    const limits = { requestsPerMinute: 10, tokensPerDay: 100000, maxConcurrent: 2 };
    const metadata: Omit<VaultProvider, 'credentials'> = {
      id: 'openai',
      type: 'openai',
      enabled: true,
      models: ['test'],
      endpoints: [
        {
          id: 'official',
          baseUrl: 'https://api.openai.com/v1',
          enabled: true,
          capabilities: ['chat'],
        },
      ],
      accountGroup: 'a',
      privacyGroup: 'school',
      limits,
      priority: 0,
      timeoutMs: 1000,
      selection: 'priority',
      maxRetries: 0,
    };
    const lease = async (providerId: string): Promise<ProviderLease> => {
      const v = await vault.read(),
        p = v.providers.find((p) => p.id === providerId)!;
      return {
        id: 'test',
        provider: p,
        endpoint: p.endpoints[0],
        credential: p.credentials[0],
        revision: v.revision,
        keys: [],
        reserved: 0,
        accountLimits: limits,
      };
    };
    try {
      await vault.store().replaceProvider(0, metadata);
      await vault
        .store()
        .addCredential(
          1,
          'openai',
          { id: 'key', enabled: true, endpointIds: ['official'], limits },
          Buffer.from('first-test-key'),
        );
      const first = await clients.openai(await lease('openai'));
      await vault.removeCredential(2, 'openai', 'key');
      await vault
        .store()
        .addCredential(
          3,
          'openai',
          { id: 'key', enabled: true, endpointIds: ['official'], limits },
          Buffer.from('rotated-test-key'),
        );
      const rotated = await clients.openai(await lease('openai'));
      await vault
        .store()
        .replaceProvider(4, {
          ...metadata,
          id: 'anthropic',
          type: 'anthropic',
          endpoints: [{ ...metadata.endpoints[0], baseUrl: 'https://api.anthropic.com' }],
        });
      await vault
        .store()
        .addCredential(
          5,
          'anthropic',
          { id: 'key', enabled: true, endpointIds: ['official'], limits },
          Buffer.from('anthropic-test-key'),
        );
      const anthropic = await clients.anthropic(await lease('anthropic'));
      expect(first.baseURL).toBe('https://api.openai.com/v1');
      expect(first.maxRetries).toBe(0);
      expect(first.apiKey).toBe('first-test-key');
      expect(rotated.apiKey).toBe('rotated-test-key');
      expect(rotated).not.toBe(first);
      expect(anthropic.baseURL).toBe('https://api.anthropic.com');
      expect(anthropic.maxRetries).toBe(0);
    } finally {
      await transport.onModuleDestroy();
      for (const file of await fs.readdir(folder)) await fs.unlink(path.join(folder, file));
      await fs.rmdir(folder);
    }
  });
  it('reports unavailable credentials without creating a dummy client or exposing key values', async () => {
    const clients = new ProviderClients(
      { available: jest.fn().mockResolvedValue(false) } as unknown as AiVaultService,
      {} as ProviderTransport,
      {} as ProviderLeases,
      new ConfigService(),
    );
    expect(await clients.available('openai')).toBe(false);
    await expect(clients.openai()).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
    await expect(clients.anthropic()).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
  });
});
