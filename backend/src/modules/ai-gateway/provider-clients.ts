import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { createGeminiClient } from './gemini-client';
import { AiVaultService } from './vault/ai-vault.service';
import { ProviderTransport } from './secure-provider-fetch';
import { ProviderLeases, ProviderLease } from './provider-leases';
import { AiUsage } from './ai.types';
import { AiError } from './ai.error';
import { ErrorCode } from '../../shared/sdk/errors/error-codes.enum';

@Injectable()
export class ProviderClients {
  constructor(
    private readonly vault: AiVaultService,
    private readonly transport: ProviderTransport,
    private readonly leases: ProviderLeases,
    private readonly config: ConfigService,
  ) {}
  available(provider: string) {
    return this.vault.available(provider);
  }
  acquire(provider: string, model: string, capability: string, tokens: number) {
    return this.leases.acquire(provider, model, capability, tokens);
  }
  finish(lease: ProviderLease, usage: AiUsage | null, error?: unknown) {
    return this.leases.finish(lease, usage, error);
  }
  private async secret(lease?: ProviderLease) {
    if (!lease)
      throw new AiError(
        ErrorCode.AI_PROVIDER_UNAVAILABLE,
        503,
        'Encrypted credential admission required',
      );
    const current = await this.vault.read();
    if (current.revision !== lease.revision)
      throw new AiError(
        ErrorCode.AI_PROVIDER_UNAVAILABLE,
        503,
        'AI credential configuration changed',
      );
    return { lease, bytes: this.vault.secret(lease.provider, lease.credential) };
  }
  private gatewayHeaders(baseUrl: string): Record<string, string> {
    if (baseUrl.includes('gateway.ai.cloudflare.com')) {
      return { 'cf-aig-max-attempts': '1' };
    }
    return {};
  }
  async openai(lease?: ProviderLease) {
    const s = await this.secret(lease);
    try {
      return new OpenAI({
        apiKey: s.bytes.toString(),
        baseURL: s.lease.endpoint.baseUrl,
        maxRetries: 0,
        timeout: s.lease.provider.timeoutMs,
        defaultHeaders: this.gatewayHeaders(s.lease.endpoint.baseUrl),
        fetch: this.transport.create(s.lease.endpoint.baseUrl),
      });
    } finally {
      s.bytes.fill(0);
    }
  }
  async openrouter(lease?: ProviderLease) {
    const s = await this.secret(lease);
    try {
      return new OpenAI({
        apiKey: s.bytes.toString(),
        baseURL: s.lease.endpoint.baseUrl,
        maxRetries: 0,
        timeout: s.lease.provider.timeoutMs,
        defaultHeaders: {
          'HTTP-Referer': 'https://st-robot.local',
          'X-Title': 'ST-Robot LMS',
          ...this.gatewayHeaders(s.lease.endpoint.baseUrl),
        },
        fetch: this.transport.create(s.lease.endpoint.baseUrl),
      });
    } finally {
      s.bytes.fill(0);
    }
  }
  async workersAi(lease?: ProviderLease) {
    const s = await this.secret(lease);
    const token = s.bytes.toString();
    s.bytes.fill(0);
    const baseUrl = s.lease.endpoint.baseUrl.replace(/\/$/, '');
    const customFetch = this.transport.create(s.lease.endpoint.baseUrl);
    return {
      baseUrl,
      timeoutMs: s.lease.provider.timeoutMs,
      request: async (path: string, body: unknown, signal: AbortSignal) => {
        const timeoutSignal = AbortSignal.timeout(s.lease.provider.timeoutMs);
        const combinedSignal = AbortSignal.any([signal, timeoutSignal]);
        return customFetch(`${baseUrl}/${path.replace(/^\//, '')}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...this.gatewayHeaders(baseUrl),
          },
          body: JSON.stringify(body),
          signal: combinedSignal,
        });
      },
      get: async (path: string, signal: AbortSignal) => {
        const timeoutSignal = AbortSignal.timeout(s.lease.provider.timeoutMs);
        const combinedSignal = AbortSignal.any([signal, timeoutSignal]);
        return customFetch(`${baseUrl}/${path.replace(/^\//, '')}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            ...this.gatewayHeaders(baseUrl),
          },
          signal: combinedSignal,
        });
      },
    };
  }
  async anthropic(lease?: ProviderLease) {
    const s = await this.secret(lease);
    try {
      return new Anthropic({
        apiKey: s.bytes.toString(),
        baseURL: s.lease.endpoint.baseUrl,
        maxRetries: 0,
        timeout: s.lease.provider.timeoutMs,
        defaultHeaders: this.gatewayHeaders(s.lease.endpoint.baseUrl),
        fetch: this.transport.create(s.lease.endpoint.baseUrl),
      });
    } finally {
      s.bytes.fill(0);
    }
  }
  async gemini(lease?: ProviderLease) {
    const s = await this.secret(lease);
    try {
      return createGeminiClient(
        s.lease.endpoint.baseUrl,
        s.bytes.toString(),
        s.lease.provider.timeoutMs,
        this.transport.create(s.lease.endpoint.baseUrl),
      );
    } finally {
      s.bytes.fill(0);
    }
  }
  timeout(): number {
    return Number(this.config.get('AI_REQUEST_TIMEOUT_MS', 60000));
  }
}
