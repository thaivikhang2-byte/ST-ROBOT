import { Injectable, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../modules/storage/storage.service';
import { operationsConfig, storageConfig } from '../config/configurations';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class HealthService {
  private pending?: Promise<{
    database: string;
    redis: string;
    storage: string;
    storageRequired: boolean;
    ready: boolean;
    checkedAt: string;
  }>;
  private cached?: Awaited<NonNullable<HealthService['pending']>>;
  private checked = 0;
  constructor(
    private readonly db: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly metrics: MetricsService,
    @Inject(operationsConfig.KEY) private readonly config: ConfigType<typeof operationsConfig>,
    @Inject(storageConfig.KEY) private readonly settings: ConfigType<typeof storageConfig>,
  ) {}
  private async probe(name: string, run: () => Promise<unknown>) {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        run(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), this.config.probeTimeoutMs);
        }),
      ]);
      this.metrics.dependency.set({ dependency: name }, 1);
      return 'up';
    } catch {
      this.metrics.dependency.set({ dependency: name }, 0);
      return 'down';
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async diagnostics() {
    if (this.cached && Date.now() - this.checked < 1000) return this.cached;
    if (this.pending) return this.pending;
    this.pending = this.inspect()
      .then((result) => {
        this.cached = result;
        this.checked = Date.now();
        return result;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
  private async inspect() {
    const [database, redis, storage] = await Promise.all([
      this.probe('postgresql', () => this.db.$queryRaw`SELECT 1`),
      this.probe('redis', () => this.redis.getClient().ping()),
      this.settings.provider === 'disabled'
        ? 'disabled'
        : this.probe('storage', () =>
            this.storage
              .requireAvailable()
              .client.send(new HeadBucketCommand({ Bucket: this.settings.bucket }), {
                abortSignal: AbortSignal.timeout(this.config.probeTimeoutMs),
              }),
          ),
    ]);
    return {
      database,
      redis,
      storage,
      storageRequired: this.config.requireStorage,
      ready:
        database === 'up' && redis === 'up' && (!this.config.requireStorage || storage === 'up'),
      checkedAt: new Date().toISOString(),
    };
  }
  async ready() {
    const result = await this.diagnostics();
    if (!result.ready) throw new ServiceUnavailableException('Service is not ready');
    return { status: 'ok' };
  }
}
