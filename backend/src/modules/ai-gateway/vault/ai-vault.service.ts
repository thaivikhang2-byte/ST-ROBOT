import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { aiVaultConfig } from '../../../config/configurations';
import { AiError } from '../ai.error';
import { ErrorCode } from '../../../shared/sdk/errors/error-codes.enum';
import { ConflictException, NotFoundException } from '../../../shared/sdk/errors/domain.exception';
import { VaultStore, VaultConflict } from './vault-store';
import { AiVault, VaultProvider, validateVault, VaultCredential } from './vault-schema';

@Injectable()
export class AiVaultService {
  constructor(@Inject(aiVaultConfig.KEY) readonly config: ConfigType<typeof aiVaultConfig>) {}
  store() {
    return new VaultStore(this.config.path, this.config.masterKey, this.config.keyId);
  }
  private failure(error: unknown): never {
    if (error instanceof VaultConflict) throw new ConflictException(error.message);
    if (error instanceof NotFoundException) throw error;
    throw new AiError(
      ErrorCode.AI_PROVIDER_UNAVAILABLE,
      503,
      'Encrypted AI configuration unavailable',
    );
  }
  async read(): Promise<AiVault> {
    try {
      return await this.store().read();
    } catch (error) {
      return this.failure(error);
    }
  }
  async metadata() {
    const vault = await this.read();
    return {
      version: vault.version,
      revision: vault.revision,
      providers: vault.providers.map((p) => ({
        ...p,
        credentials: p.credentials.map((c) => ({
          id: c.id,
          enabled: c.enabled,
          endpointIds: c.endpointIds,
          limits: c.limits,
        })),
      })),
    };
  }
  async provider(id: string) {
    return (await this.read()).providers.find((p) => p.id === id);
  }
  async available(id: string) {
    try {
      const p = await this.provider(id);
      return (
        !!p?.enabled &&
        p.credentials.some(
          (c) =>
            c.enabled &&
            c.endpointIds.some((id) => p.endpoints.some((e) => e.id === id && e.enabled)),
        )
      );
    } catch {
      return false;
    }
  }
  async replace(revision: number, metadata: Record<string, unknown>) {
    if ('credentials' in metadata)
      throw new AiError(
        ErrorCode.VALIDATION_ERROR,
        400,
        'Credentials use the dedicated encrypted credential operation',
      );
    let provider: VaultProvider;
    try {
      provider = validateVault({
        version: 1,
        revision,
        providers: [{ ...metadata, credentials: [] }],
      }).providers[0];
    } catch {
      throw new AiError(ErrorCode.VALIDATION_ERROR, 400, 'Invalid provider metadata');
    }
    const isEndpointApproved = (baseUrl: string) =>
      this.config.allowedEndpoints.some(
        (approved) =>
          baseUrl === approved ||
          baseUrl.startsWith(approved.replace(/\/$/, '') + '/'),
      );
    for (const endpoint of provider.endpoints)
      if (!isEndpointApproved(endpoint.baseUrl))
        throw new AiError(ErrorCode.FORBIDDEN, 403, 'Endpoint is not deployment-approved');
    try {
      await this.store().replaceProvider(revision, provider);
      return this.metadata();
    } catch (error) {
      return this.failure(error);
    }
  }
  async add(
    revision: number,
    providerId: string,
    metadata: Omit<VaultCredential, 'encrypted'>,
    key: Buffer,
  ) {
    try {
      await this.store().addCredential(revision, providerId, metadata, key);
      return this.metadata();
    } catch (error) {
      return this.failure(error);
    } finally {
      key.fill(0);
    }
  }
  async removeCredential(revision: number, providerId: string, id: string) {
    try {
      await this.store().update(revision, (v) => {
        const p = v.providers.find((p) => p.id === providerId);
        if (!p) throw new NotFoundException('AI provider');
        if (!p.credentials.some((c) => c.id === id)) throw new NotFoundException('AI credential');
        p.credentials = p.credentials.filter((c) => c.id !== id);
      });
      return this.metadata();
    } catch (error) {
      return this.failure(error);
    }
  }
  async removeProvider(revision: number, id: string) {
    try {
      await this.store().update(revision, (v) => {
        if (!v.providers.some((p) => p.id === id)) throw new NotFoundException('AI provider');
        v.providers = v.providers.filter((p) => p.id !== id);
        if (v.defaultProviderId === id) delete v.defaultProviderId;
      });
      return this.metadata();
    } catch (error) {
      return this.failure(error);
    }
  }
  secret(provider: VaultProvider, credential: VaultCredential) {
    try {
      return this.store().decrypt(provider, credential);
    } catch (error) {
      return this.failure(error);
    }
  }
}
