import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue, Process, Processor } from '@nestjs/bull';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { StorageService, storageUnavailable } from './storage.service';
import { MetricsService } from '../../metrics/metrics.service';
import { withContext } from '../../shared/sdk/logger/request-context';

@Injectable()
export class MediaMaintenance {
  private readonly logger = new Logger(MediaMaintenance.name);
  constructor(@InjectQueue('media-maintenance') private readonly queue: Queue) {}
  @Cron(CronExpression.EVERY_MINUTE, { waitForCompletion: true })
  async enqueue() {
    try {
      await this.queue.add(
        'cleanup',
        {},
        {
          jobId: `media-cleanup-${Math.floor(Date.now() / 60000)}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    } catch {
      this.logger.error('Media cleanup could not be queued');
    }
  }
}

@Processor('media-maintenance')
export class MediaCleanupProcessor {
  private readonly logger = new Logger(MediaCleanupProcessor.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly metrics: MetricsService,
  ) {}
  @Process('cleanup')
  async cleanup() {
    return withContext(undefined, () => this.metrics.job('media-maintenance', () => this.run()));
  }
  private async run() {
    if (this.storage.name === 'disabled') return;
    const now = new Date();
    // Recovery after a crashed verifier: never promote unverifiable data, retain metadata for operators.
    const abandoned = await this.prisma.storageObject.findMany({
      where: {
        provider: this.storage.name,
        bucket: this.storage.settings.bucket,
        status: { in: ['pending', 'uploading', 'verifying'] },
        OR: [{ video: null }, { video: { provider: 'legacy' } }],
        upload_expires_at: { lt: new Date(now.getTime() - 300000) },
      },
      select: { id: true },
      orderBy: { upload_expires_at: 'asc' },
      take: 40,
    });
    if (abandoned.length)
      await this.prisma.storageObject.updateMany({
        where: {
          id: { in: abandoned.map((row) => row.id) },
          status: { in: ['pending', 'uploading', 'verifying'] },
          upload_expires_at: { lt: new Date(now.getTime() - 300000) },
        },
        data: { status: 'failed' },
      });
    const rows = await this.prisma.storageObject.findMany({
      where: {
        provider: this.storage.name,
        bucket: this.storage.settings.bucket,
        OR: [
          { status: { in: ['failed', 'deleted'] }, purged_at: null },
          { status: 'ready', staging_deleted_at: null, upload_expires_at: { lte: now } },
        ],
      },
      orderBy: { created_at: 'asc' },
      take: 40,
    });
    try {
      for (const row of rows) {
        if (['failed', 'deleted'].includes(row.status)) await this.storage.delete(row.object_key);
        // Keep a grace period for an in-flight verifier; a late PUT cannot escape later cleanup.
        const grace = row.status === 'ready' ? 0 : 300000;
        const canDeleteStaging =
          !row.upload_expires_at || row.upload_expires_at.getTime() + grace <= now.getTime();
        if (canDeleteStaging && row.staging_key) await this.storage.delete(row.staging_key);
        await this.prisma.storageObject.updateMany({
          where: { id: row.id, status: row.status },
          data: {
            ...(canDeleteStaging ? { staging_deleted_at: now } : {}),
            ...(canDeleteStaging && ['failed', 'deleted'].includes(row.status)
              ? { purged_at: now }
              : {}),
          },
        });
      }
    } catch {
      this.logger.error('Media cleanup failed; bounded Bull retries scheduled');
      throw storageUnavailable();
    }
    return rows.length;
  }
}
