import { Injectable, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { ConfigType } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { HealthService } from '../../health/health.service';
import { MetricsService } from '../../metrics/metrics.service';
import { operationsConfig } from '../../config/configurations';
import { SystemService } from './system.service';
import { AppLoggerService } from '../../shared/sdk/logger/logger.service';
import { redact } from '../../shared/sdk/logger/redaction';
@Injectable()
export class OperationalAlertsService {
  constructor(
    private readonly db: PrismaService,
    private readonly health: HealthService,
    private readonly system: SystemService,
    private readonly metrics: MetricsService,
    private readonly logger: AppLoggerService,
    @Inject(operationsConfig.KEY) private readonly config: ConfigType<typeof operationsConfig>,
  ) {}
  async signal(
    code: string,
    active: boolean,
    severity = 'warning',
    details: Record<string, unknown> = {},
  ) {
    return this.db.$transaction(async (tx) => {
      // A per-code advisory transaction lock serializes open/recovery and deduplicates across replicas.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`st-robot-alert:${code}`}))`;
      const old = await tx.operationalAlert.findUnique({ where: { code } });
      if (!active && (!old || old.status === 'resolved')) return old;
      const now = new Date();
      const row = active
        ? await tx.operationalAlert.upsert({
            where: { code },
            create: { code, severity, details: redact(details) as Prisma.InputJsonValue },
            update: {
              severity,
              status: 'open',
              last_seen_at: now,
              resolved_at: null,
              ...(old?.status === 'resolved'
                ? { opened_at: now, occurrences: { increment: 1 } }
                : {}),
              details: redact(details) as Prisma.InputJsonValue,
            },
          })
        : await tx.operationalAlert.update({
            where: { code },
            data: { status: 'resolved', resolved_at: now, last_seen_at: now },
          });
      if (!old || old.status !== row.status) {
        await tx.auditLog.create({
          data: {
            action: active ? 'operations.alert_opened' : 'operations.alert_resolved',
            resource: 'operations',
            resource_id: code,
            new_data: { severity, status: row.status },
          },
        });
        this.logger.event(
          active ? 'warn' : 'info',
          active ? 'operations.alert_opened' : 'operations.alert_resolved',
          { code, severity },
        );
      }
      return row;
    });
  }
  @Cron('*/1 * * * *', { waitForCompletion: true })
  async evaluate() {
    if (!this.config.alertsEnabled) return;
    try {
      const [health, queues, lastBackup, cost, ai, video] = await Promise.all([
        this.health.diagnostics(),
        this.system.queues(),
        this.db.backupRecord.findFirst({ orderBy: { created_at: 'desc' } }),
        this.db.aiUsageRecord.aggregate({
          where: { started_at: { gte: new Date(new Date().toISOString().slice(0, 10)) } },
          _sum: { estimated_cost: true },
        }),
        this.db.aiUsageRecord.groupBy({
          by: ['status'],
          where: { started_at: { gte: new Date(Date.now() - 300000) } },
          _count: true,
        }),
        this.db.video.count({
          where: {
            status: 'failed',
            deleted_at: null,
            updated_at: { gte: new Date(Date.now() - 3600000) },
          },
        }),
      ]);
      const http = this.metrics.summary(),
        requests = ai.reduce((n, r) => n + r._count, 0),
        failed = ai
          .filter((r) => ['failed', 'timeout'].includes(r.status))
          .reduce((n, r) => n + r._count, 0);
      const checks: [string, boolean, string, Record<string, unknown>][] = [
        ['dependency.postgresql', health.database !== 'up', 'critical', {}],
        ['dependency.redis', health.redis !== 'up', 'critical', {}],
        ['dependency.storage', health.storageRequired && health.storage !== 'up', 'critical', {}],
        [
          'http.error_rate',
          http.sampledWindowRequests >= this.config.minRequests &&
            (http.errorRate ?? 0) >= this.config.errorRate,
          'critical',
          { rate: http.errorRate },
        ],
        [
          'queue.backlog',
          queues.some(
            (q) =>
              !q.available ||
              (q.counts ? q.counts.waiting + q.counts.delayed : 0) > this.config.queueBacklog,
          ),
          'warning',
          {},
        ],
        [
          'ai.failure_rate',
          requests >= this.config.minRequests && failed / requests >= this.config.errorRate,
          'warning',
          { requests, failed },
        ],
        [
          'ai.daily_cost',
          Number(cost._sum.estimated_cost ?? 0) > this.config.aiDailyCost,
          'warning',
          { estimatedUsd: cost._sum.estimated_cost?.toString() ?? null },
        ],
        ['video.failures', video >= 3, 'warning', { lastHour: video }],
        [
          'backup.failure',
          this.config.backupEnabled &&
            (!lastBackup ||
              lastBackup.status === 'failed' ||
              lastBackup.created_at.getTime() <
                Date.now() - this.config.backupIntervalHours * 3600000 * 2),
          'critical',
          {},
        ],
      ];
      for (const [code, active, severity, details] of checks)
        await this.signal(code, active, severity, details);
    } catch {
      this.logger.event('error', 'operations.alert_evaluation_unavailable');
    }
  }
}
