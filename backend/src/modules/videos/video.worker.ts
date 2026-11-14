import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Job } from 'bull';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { SelfHostedHlsProvider, VideoProcessingError } from './self-hosted-hls.provider';
import { VideosService } from './videos.service';
import { StorageService } from '../storage/storage.service';
import { MetricsService } from '../../metrics/metrics.service';
import { TraceContext, withContext } from '../../shared/sdk/logger/request-context';

@Processor('video-processing')
export class VideoWorker implements OnModuleInit {
  private readonly logger = new Logger(VideoWorker.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: SelfHostedHlsProvider,
    private readonly videos: VideosService,
    private readonly storage: StorageService,
    private readonly metrics: MetricsService,
  ) {}
  async onModuleInit() {
    if (!this.provider.settings.workerEnabled) await this.videos.queue.pause(true);
  }
  @Process({ name: 'encode', concurrency: 1 })
  async encode(job: Job<{ id: string; _trace?: TraceContext }>) {
    return withContext(job.data._trace, () =>
      this.metrics.job('video-processing', () => this.process(job)),
    );
  }
  private async process(job: Job<{ id: string }>) {
    if (!this.provider.settings.workerEnabled) throw new VideoProcessingError('WORKER_DISABLED');
    const now = new Date(),
      lease = new Date(Date.now() + (this.provider.settings.timeout + 120) * 1000);
    const v = await this.prisma.video.findUnique({
      where: { id: job.data.id },
      include: { storage_object: true },
    });
    if (!v || v.deleted_at || v.status === 'ready' || v.provider !== 'self-hosted') return;
    if (v.processing_attempts >= 3) return;
    const prefix = `video-hls/${v.id}/${randomUUID()}`;
    const claim = await this.prisma.video.updateMany({
      where: {
        id: v.id,
        deleted_at: null,
        processing_attempts: { lt: 3 },
        OR: [
          { status: { in: ['queued', 'failed'] } },
          { status: 'processing', processing_lease: { lt: now } },
        ],
      },
      data: {
        status: 'processing',
        processing_lease: lease,
        hls_prefix: prefix,
        processing_error: null,
        processing_attempts: { increment: 1 },
      },
    });
    if (!claim.count) return;
    let keys: string[] = [];
    try {
      if (v.hls_prefix) await this.storage.deleteVideoPrefix(v.hls_prefix);
      const source = v.storage_object;
      if (!source?.staging_key || source.deleted_at)
        throw new VideoProcessingError('SOURCE_UNAVAILABLE');
      this.storage.matches(source.provider, source.bucket);
      const result = await this.provider.process(
        {
          key: source.staging_key,
          archiveKey: source.object_key,
          size: Number(source.size),
          checksum: source.checksum,
          mimeType: source.mime_type,
        },
        prefix,
        async (percent) => {
          const changed = await this.prisma.video.updateMany({
            where: { id: v.id, status: 'processing', processing_lease: lease, deleted_at: null },
            data: { processing_percent: percent },
          });
          await job.progress(percent);
          return !!changed.count;
        },
      );
      keys = result.keys;
      const published = await this.prisma.$transaction(async (tx) => {
        const changed = await tx.video.updateMany({
          where: { id: v.id, status: 'processing', processing_lease: lease, deleted_at: null },
          data: {
            status: 'ready',
            processing_percent: 100,
            processing_lease: null,
            processing_error: null,
            duration_seconds: result.duration,
            source_width: result.width,
            source_height: result.height,
            renditions: result.renditions,
          },
        });
        if (changed.count)
          await tx.storageObject.update({ where: { id: source.id }, data: { status: 'ready' } });
        return changed.count;
      });
      if (!published) await Promise.allSettled(keys.map((key) => this.storage.delete(key)));
    } catch (error) {
      await this.prisma.video.updateMany({
        where: { id: v.id, status: 'processing', processing_lease: lease },
        data: {
          status: 'failed',
          processing_lease: null,
          processing_error:
            error instanceof VideoProcessingError ? error.message : 'PROCESSING_UNAVAILABLE',
        },
      });
      this.logger.warn(
        `Video processing failed for asset ${v.id}; attempt ${v.processing_attempts + 1}`,
      );
      throw new VideoProcessingError('PROCESSING_FAILED');
    }
  }
}

@Injectable()
export class VideoMaintenance {
  private readonly logger = new Logger(VideoMaintenance.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly videos: VideosService,
    private readonly storage: StorageService,
  ) {}
  @Cron(CronExpression.EVERY_MINUTE, { waitForCompletion: true })
  async recover() {
    try {
      await this.prisma.video.updateMany({
        where: {
          provider: 'self-hosted',
          status: 'processing',
          processing_attempts: { gte: 3 },
          processing_lease: { lt: new Date() },
          deleted_at: null,
        },
        data: {
          status: 'failed',
          processing_error: 'WORKER_RETRY_EXHAUSTED',
          processing_lease: null,
        },
      });
      const rows = await this.prisma.video.findMany({
        where: {
          provider: 'self-hosted',
          deleted_at: null,
          processing_attempts: { lt: 3 },
          OR: [
            { status: 'queued' },
            { status: 'processing', processing_lease: { lt: new Date() } },
          ],
        },
        take: 20,
      });
      for (const row of rows) await this.videos.enqueue(row.id);
      const failed = await this.prisma.video.findMany({
        where: {
          provider: 'self-hosted',
          status: 'failed',
          processing_attempts: { gte: 3 },
          hls_prefix: { not: null },
        },
        take: 20,
      });
      for (const row of failed) {
        await this.storage.deleteVideoPrefix(row.hls_prefix!);
        await this.prisma.video.updateMany({
          where: { id: row.id, status: 'failed', hls_prefix: row.hls_prefix },
          data: { hls_prefix: null },
        });
      }
      // Abandoned source references are retained as metadata; existing media cleanup reclaims expired bytes.
      const abandoned = await this.prisma.video.findMany({
        where: {
          provider: 'self-hosted',
          status: 'uploading',
          storage_object: { upload_expires_at: { lt: new Date() } },
        },
        take: 20,
      });
      for (const row of abandoned)
        await this.prisma.$transaction(async (tx) => {
          await tx.video.updateMany({
            where: { id: row.id, status: 'uploading' },
            data: { status: 'failed', processing_error: 'UPLOAD_EXPIRED' },
          });
          await tx.storageObject.updateMany({
            where: { id: row.storage_object_id!, status: 'uploading' },
            data: { status: 'failed' },
          });
        });
      await this.prisma.videoSession.deleteMany({
        // Legacy sessions may contain historical watch data; only Phase 10 capability sessions expire here.
        where: {
          auth_family_id: { not: null },
          expires_at: { lt: new Date(Date.now() - 86400000) },
        },
      });
      await this.prisma.videoWebhookReceipt.deleteMany({
        where: { created_at: { lt: new Date(Date.now() - 86400000) } },
      });
    } catch {
      this.logger.warn('Video maintenance unavailable; retry on next tick');
    }
  }
}
