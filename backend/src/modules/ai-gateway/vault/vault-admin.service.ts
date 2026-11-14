import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';
import { auditContent } from '../../courses/content-integrity';
import { AiVaultService } from './ai-vault.service';
import { CreateCredentialDto, ProviderConfigurationDto, VaultRevisionDto } from './vault.dto';

@Injectable()
export class VaultAdminService {
  constructor(private readonly vault: AiVaultService, private readonly prisma: PrismaService) {}
  assertTls(request: Request) {
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '');
    // Express secure honors only the deployment's explicit trust-proxy configuration.
    if (!request.secure && !(local && this.vault.config.allowLocalAdminHttp))
      throw new ForbiddenException('Credential administration requires HTTPS');
  }
  metadata() { return this.vault.metadata(); }
  async configure(id: string, dto: ProviderConfigurationDto, actor: string) {
    if (dto.provider.id !== id) throw new ForbiddenException('Provider identity must match the route');
    return this.prisma.$transaction(async (tx) => {
      await tx.aiQuotaPolicy.update({ where: { id: 'default' }, data: { lock_version: { increment: 1 } } });
      const existing = await tx.aiProvider.findUnique({ where: { id } });
      if (existing && existing.type !== dto.provider.type) throw new ForbiddenException('Existing provider type is immutable');
      const result = await this.vault.replace(dto.expectedRevision, dto.provider);
      const provider = result.providers.find((p) => p.id === id)!;
      await tx.aiProvider.upsert({ where: { id }, create: { id, type: provider.type, enabled: provider.enabled }, update: { enabled: provider.enabled } });
      await auditContent(tx, 'ai.provider_configured', actor, 'ai_provider', id);
      return result;
    });
  }
  async add(id: string, dto: CreateCredentialDto, actor: string) {
    const bytes = Buffer.from(dto.apiKey);
    dto.apiKey = ''; // Do not retain the request DTO's key after conversion.
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.aiQuotaPolicy.update({ where: { id: 'default' }, data: { lock_version: { increment: 1 } } });
        const result = await this.vault.add(dto.expectedRevision, id, {
          id: dto.id ?? randomUUID(), enabled: dto.enabled, endpointIds: dto.endpointIds, limits: dto.limits,
        }, bytes);
        await auditContent(tx, 'ai.credential_added', actor, 'ai_provider', id);
        return result;
      });
    } finally { bytes.fill(0); }
  }
  async remove(id: string, credential: string | undefined, dto: VaultRevisionDto, actor: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.aiQuotaPolicy.update({ where: { id: 'default' }, data: { lock_version: { increment: 1 } } });
      const result = credential
        ? await this.vault.removeCredential(dto.expectedRevision, id, credential)
        : await this.vault.removeProvider(dto.expectedRevision, id);
      if (!credential) await tx.aiProvider.updateMany({ where: { id }, data: { enabled: false } });
      await auditContent(tx, credential ? 'ai.credential_removed' : 'ai.provider_removed', actor, 'ai_provider', id);
      return result;
    });
  }
}
