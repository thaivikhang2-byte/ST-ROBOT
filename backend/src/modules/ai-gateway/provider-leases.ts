import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../../redis/redis.service';
import { AiVaultService } from './vault/ai-vault.service';
import { VaultProvider, VaultEndpoint, VaultCredential, VaultLimits } from './vault/vault-schema';
import { AiError } from './ai.error';
import { ErrorCode } from '../../shared/sdk/errors/error-codes.enum';
import { AiUsage } from './ai.types';

export interface ProviderLease {
  id: string;
  provider: VaultProvider;
  endpoint: VaultEndpoint;
  credential: VaultCredential;
  revision: number;
  keys: string[];
  reserved: number;
  accountLimits: VaultLimits;
}
@Injectable()
export class ProviderLeases {
  constructor(
    private readonly vault: AiVaultService,
    private readonly redis: RedisService,
  ) {}
  async acquire(
    providerId: string,
    model: string,
    capability: string,
    reserved: number,
  ): Promise<ProviderLease> {
    const vault = await this.vault.read(),
      provider = vault.providers.find((p) => p.id === providerId && p.enabled);
    if (!provider || (capability !== 'model-list' && !provider.models.includes(model)))
      throw new AiError(
        ErrorCode.AI_MODEL_UNAVAILABLE,
        503,
        'Provider/model is not configured in the encrypted registry',
      );
    const allowed = this.vault.config.allowedEndpoints;
    const isEndpointApproved = (baseUrl: string) =>
      allowed.some(
        (approved) =>
          baseUrl === approved ||
          baseUrl.startsWith(approved.replace(/\/$/, '') + '/'),
      );
    const endpoints = provider.endpoints.filter(
      (e) => e.enabled && e.capabilities.includes(capability) && isEndpointApproved(e.baseUrl),
    );
    const shared = vault.providers.filter((p) => p.accountGroup === provider.accountGroup);
    const limits: VaultLimits = {
      requestsPerMinute: Math.min(...shared.map((p) => p.limits.requestsPerMinute)),
      tokensPerDay: Math.min(...shared.map((p) => p.limits.tokensPerDay)),
      maxConcurrent: Math.min(...shared.map((p) => p.limits.maxConcurrent)),
    };
    const credentials = provider.credentials.filter((c) => c.enabled);
    try {
      if (provider.selection === 'round-robin' && credentials.length) {
        const offset = await this.redis.getClient().incr(`ai-route:${provider.id}`);
        credentials.push(...credentials.splice(0, offset % credentials.length));
      }
      for (const endpoint of endpoints)
        for (const credential of credentials) {
          if (!credential.endpointIds.includes(endpoint.id)) continue;
          const now = Date.now(),
            day = new Date(now).toISOString().slice(0, 10),
            minute = Math.floor(now / 60000),
            id = randomUUID();
          const scope = `ai-account:${provider.accountGroup}`,
            key = `ai-credential:${provider.id}:${credential.id}`;
          const keys = [
            `${scope}:m:${minute}`,
            `${scope}:d:${day}`,
            `${scope}:active`,
            `${key}:m:${minute}`,
            `${key}:d:${day}`,
            `${key}:active`,
            `ai-cooldown:account:${provider.accountGroup}`,
            `ai-cooldown:credential:${provider.id}:${credential.id}`,
            `ai-cooldown:endpoint:${provider.id}:${endpoint.id}`,
            `ai-lease:${id}`,
          ];
          // Check both scopes before any write; changing keys never bypasses shared account limits.
          const script = `
          if redis.call('EXISTS',KEYS[7])==1 then return -1 end
          if redis.call('EXISTS',KEYS[8])==1 or redis.call('EXISTS',KEYS[9])==1 then return 0 end
          for i=0,1 do
            local b=i*3; local a=i*3
            redis.call('ZREMRANGEBYSCORE',KEYS[b+3],'-inf',ARGV[1])
            if tonumber(redis.call('GET',KEYS[b+1]) or '0') >= tonumber(ARGV[a+4]) or
              tonumber(redis.call('GET',KEYS[b+2]) or '0')+tonumber(ARGV[3]) > tonumber(ARGV[a+5]) or
              redis.call('ZCARD',KEYS[b+3]) >= tonumber(ARGV[a+6]) then
              if i==0 then return -1 else return 0 end
            end
          end
          for i=0,1 do
            local b=i*3
            redis.call('INCR',KEYS[b+1]);redis.call('EXPIRE',KEYS[b+1],120)
            redis.call('INCRBY',KEYS[b+2],ARGV[3]);redis.call('EXPIRE',KEYS[b+2],172800)
            redis.call('ZADD',KEYS[b+3],ARGV[2],ARGV[10]);redis.call('EXPIRE',KEYS[b+3],300)
          end
          redis.call('SET',KEYS[10],'active','PX',300000)
          return 1`;
          const admitted = Number(
            await this.redis
              .getClient()
              .eval(
                script,
                keys.length,
                ...keys,
                now,
                now + provider.timeoutMs + 60000,
                reserved,
                limits.requestsPerMinute,
                limits.tokensPerDay,
                limits.maxConcurrent,
                credential.limits.requestsPerMinute,
                credential.limits.tokensPerDay,
                credential.limits.maxConcurrent,
                id,
              ),
          );
          if (admitted < 0)
            throw new AiError(
              ErrorCode.AI_QUOTA_EXCEEDED,
              429,
              'AI provider account limit reached',
            );
          if (admitted === 1)
            return { id, provider, endpoint, credential, revision: vault.revision, keys, reserved, accountLimits: limits };
        }
    } catch (error) {
      if (error instanceof AiError) throw error;
      throw new AiError(
        ErrorCode.AI_PROVIDER_UNAVAILABLE,
        503,
        'AI credential admission unavailable',
      );
    }
    throw new AiError(
      ErrorCode.AI_PROVIDER_UNAVAILABLE,
      503,
      'No authorized credential is currently available',
    );
  }
  async finish(lease: ProviderLease, usage: AiUsage | null, error?: unknown) {
    const known =
      usage &&
      Number.isSafeInteger(usage.inputTokens) &&
      Number.isSafeInteger(usage.outputTokens) &&
      usage.inputTokens! >= 0 &&
      usage.outputTokens! >= 0;
    const charged = known ? usage!.inputTokens! + usage!.outputTokens! : lease.reserved;
    const script = `if redis.call('GET',KEYS[10])~='active' then return 0 end
      redis.call('DEL',KEYS[10]);redis.call('ZREM',KEYS[3],ARGV[1]);redis.call('ZREM',KEYS[6],ARGV[1]);
      redis.call('INCRBY',KEYS[2],ARGV[2]);redis.call('INCRBY',KEYS[5],ARGV[2]);return 1`;
    await this.redis
      .getClient()
      .eval(script, lease.keys.length, ...lease.keys, lease.id, charged - lease.reserved);
    const status =
      typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0;
    if ([401, 403].includes(status))
      await this.redis.getClient().set(lease.keys[7], '1', 'EX', 300);
    else if (status === 429) await this.redis.getClient().set(lease.keys[6], '1', 'EX', 60);
    else if (status >= 500) await this.redis.getClient().set(lease.keys[8], '1', 'EX', 30);
    if (!error)
      await this.redis
        .getClient()
        .set(`ai-last-success:${lease.provider.id}`, new Date().toISOString(), 'EX', 86400);
  }
}
