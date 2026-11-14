import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { videoConfig } from '../../config/configurations';
import { ForbiddenException } from '../../shared/sdk/errors/domain.exception';
import { storageUnavailable } from '../storage/storage.service';
import { ManagedVideoProvider, CloudVideoState } from './video-provider';

export const VIDEO_FETCH = Symbol('VIDEO_FETCH');
@Injectable()
export class CloudflareStreamProvider implements ManagedVideoProvider {
  constructor(
    @Inject(videoConfig.KEY) readonly settings: ConfigType<typeof videoConfig>,
    @Inject(VIDEO_FETCH) private readonly transport: typeof fetch,
  ) {}
  available() {
    if (
      !this.settings.cloudEnabled ||
      !this.settings.cloudAccount ||
      !this.settings.cloudToken ||
      !this.settings.cloudCustomer
    )
      throw storageUnavailable();
  }
  private uid(uid: string) {
    if (!/^[a-f0-9]{32}$/.test(uid)) throw storageUnavailable();
    return uid;
  }
  private async request(
    path: string,
    method = 'GET',
    body?: object,
  ): Promise<Record<string, unknown>> {
    this.available();
    try {
      const response = await this.transport(
        `https://api.cloudflare.com/client/v4/accounts/${this.settings.cloudAccount}/stream${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${this.settings.cloudToken}`,
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(15000),
          redirect: 'error',
        },
      );
      if (method === 'DELETE' && response.status === 404) return {};
      if (!response.ok) throw storageUnavailable();
      if (method === 'DELETE') return {};
      const envelope = (await response.json()) as {
        success?: boolean;
        result?: Record<string, unknown>;
      };
      if (!envelope.success || !envelope.result) throw storageUnavailable();
      return envelope.result;
    } catch {
      throw storageUnavailable();
    }
  }
  async createUpload(maxDuration: number) {
    const result = await this.request('/direct_upload', 'POST', {
      maxDurationSeconds: maxDuration,
      requireSignedURLs: true,
      expiry: new Date(Date.now() + 900000).toISOString(),
    });
    const uid = this.uid(String(result.uid));
    const url = new URL(String(result.uploadURL));
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'upload.videodelivery.net' ||
      url.username ||
      url.password
    )
      throw storageUnavailable();
    return { uid, url: url.href };
  }
  async status(uid: string): Promise<CloudVideoState> {
    const r = await this.request('/' + this.uid(uid));
    const s = r.status as Record<string, unknown> | undefined;
    // Never enable playback of a provider asset which lost its private flag.
    const ready = r.readyToStream === true && s?.state === 'ready' && r.requireSignedURLs === true;
    const input = r.input as Record<string, unknown> | undefined;
    return {
      ready,
      failed: s?.state === 'error',
      percent: Math.min(100, Math.max(0, Number(s?.pctComplete) || 0)),
      duration: Number(r.duration) || 0,
      width: Number(input?.width) || 0,
      height: Number(input?.height) || 0,
    };
  }
  async playback(uid: string, expires: number) {
    const r = await this.request('/' + this.uid(uid) + '/token', 'POST', {
      exp: expires,
      downloadable: false,
    });
    if (typeof r.token !== 'string' || !/^[-\w.]+$/.test(r.token)) throw storageUnavailable();
    return `https://customer-${this.settings.cloudCustomer}.cloudflarestream.com/${r.token}/manifest/video.m3u8`;
  }
  async deleteVideo(uid: string) {
    await this.request('/' + this.uid(uid), 'DELETE');
  }
  verifyWebhook(raw: Buffer, signature: string, now = Date.now()) {
    const fields: Record<string, string> = Object.fromEntries(
      signature.split(',').map((x) => x.trim().split('=')),
    ) as Record<string, string>;
    const time = Number(fields.time),
      secret = this.settings.webhookSecret;
    if (
      !secret ||
      !Number.isInteger(time) ||
      Math.abs(now / 1000 - time) > 300 ||
      !/^[a-f0-9]{64}$/.test(fields.sig1 || '')
    )
      throw new ForbiddenException('Invalid video webhook');
    const expected = createHmac('sha256', secret)
      .update(fields.time + '.')
      .update(raw)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(fields.sig1, 'hex')))
      throw new ForbiddenException('Invalid video webhook');
    return createHash('sha256')
      .update(fields.time + '.')
      .update(raw)
      .digest('hex');
  }
}
