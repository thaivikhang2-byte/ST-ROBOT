import { Injectable, Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { HealthService } from '../../health/health.service';
import { MetricsService } from '../../metrics/metrics.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { operationsConfig, featureConfig } from '../../config/configurations';
import { OperationsAccess } from './operations-access';
import { Cron } from '@nestjs/schedule';
@Injectable()
export class SystemService {
  constructor(
    private readonly db: PrismaService,
    private readonly health: HealthService,
    private readonly metrics: MetricsService,
    private readonly analytics: AnalyticsService,
    private readonly access: OperationsAccess,
    @InjectQueue('identity-mail') private readonly mail: Queue,
    @InjectQueue('media-maintenance') private readonly media: Queue,
    @InjectQueue('video-processing') private readonly video: Queue,
    @InjectQueue('operations-backup') private readonly backup: Queue,
    @Inject(operationsConfig.KEY) private readonly config: ConfigType<typeof operationsConfig>,
    @Inject(featureConfig.KEY) private readonly features: ConfigType<typeof featureConfig>,
  ) {}
  async queues() {
    const queues: [string, Queue][] = [
      ['identity-mail', this.mail],
      ['media-maintenance', this.media],
      ['video-processing', this.video],
      ['operations-backup', this.backup],
    ];
    return Promise.all(
      queues.map(async ([name, queue]) => {
        try {
          let timer: NodeJS.Timeout | undefined;
          const counts = await Promise.race([
            queue.getJobCounts(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('timeout')), this.config.probeTimeoutMs);
            }),
          ]).finally(() => {
            if (timer) clearTimeout(timer);
          });
          for (const [state, count] of Object.entries(counts) as [string, number][])
            this.metrics.queueDepth.set({ queue: name, state }, count);
          return { name: name, available: true, counts };
        } catch {
          return { name: name, available: false, counts: null };
        }
      }),
    );
  }
  async snapshot(actorId: string) {
    const actor = await this.access.check(actorId);
    const [dependencies, queues, alerts, backups, ai, platform] = await Promise.all([
      this.health.diagnostics(),
      this.queues(),
      this.db.operationalAlert.findMany({ orderBy: { last_seen_at: 'desc' }, take: 30 }),
      actor.permissions.includes('backup:read')
        ? this.db.backupRecord
            .findMany({
              select: { id: true, status: true, created_at: true, size: true },
              orderBy: { created_at: 'desc' },
              take: 5,
            })
            .then((rows) => rows.map((r) => ({ ...r, size: r.size.toString() })))
        : null,
      actor.permissions.includes('ai:manage') ? this.analytics.ai() : null,
      actor.permissions.includes('analytics:read') ? this.analytics.platform() : null,
    ]);
    return {
      generatedAt: new Date(),
      dependencies,
      http: this.metrics.summary(),
      queues,
      alerts,
      backups,
      ai,
      platform,
      features: { ai: this.features.aiEnabled, chat: this.features.chatEnabled },
      backupSchedule: {
        enabled: this.config.backupEnabled,
        intervalHours: this.config.backupIntervalHours,
        retentionDays: this.config.backupRetentionDays,
      },
      unavailable:
        'Null panels indicate missing dataset permission. Metrics are per process, not fleet totals.',
    };
  }
  @Cron('*/30 * * * * *', { waitForCompletion: true })
  async collect() {
    try {
      await Promise.all([this.health.diagnostics(), this.queues()]);
      const [usage, last] = await Promise.all([
        this.db.aiUsageRecord.groupBy({
          by: ['provider_type', 'status'],
          where: { started_at: { gte: new Date(Date.now() - 86400000) } },
          _count: true,
        }),
        this.db.backupRecord.findFirst({
          where: { status: 'completed', provider: 'encrypted-local' },
          orderBy: { created_at: 'desc' },
          select: { created_at: true },
        }),
      ]);
      this.metrics.aiRequests.reset();
      for (const row of usage) {
        const provider = ['openai', 'anthropic', 'gemini', 'openai-compatible'].includes(
          row.provider_type ?? '',
        )
          ? row.provider_type!
          : 'other';
        const status = [
          'reserved',
          'completed',
          'failed',
          'interrupted',
          'timeout',
          'cancelled',
        ].includes(row.status)
          ? row.status
          : 'other';
        this.metrics.aiRequests.inc({ provider, status }, row._count);
      }
      if (last) this.metrics.backupTime.set(last.created_at.getTime() / 1000);
    } catch {
      /* dependency gauges and authenticated diagnostics report failures; never leak DB errors */
    }
  }
}
