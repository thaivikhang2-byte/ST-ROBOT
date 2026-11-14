import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '@prisma/client';

export interface UsageSummary {
  period: string;
  provider: string;
  model: string;
  status: string;
  requests: number;
  known_usage: number;
  known_cost: number;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_usd: string | null;
  mean_latency_ms: number | null;
}
@Injectable()
export class AnalyticsService {
  constructor(private readonly db: PrismaService) {}
  async ai() {
    const summarize = (period: 'day' | 'month', days: number) =>
      this.db.$queryRaw<UsageSummary[]>(Prisma.sql`
   SELECT to_char(date_trunc(${period}, started_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS period,
   provider_id AS provider, model_id AS model, status,
   count(*)::int AS requests,
   count(*) FILTER (WHERE input_tokens IS NOT NULL AND output_tokens IS NOT NULL)::int AS known_usage,
   count(estimated_cost)::int AS known_cost,
   sum(input_tokens)::float8 AS input_tokens, sum(output_tokens)::float8 AS output_tokens,
   sum(estimated_cost)::text AS estimated_usd,
   avg(EXTRACT(EPOCH FROM (finished_at-started_at))*1000)::float8 AS mean_latency_ms
   FROM ai_usage_records WHERE started_at >= ${new Date(Date.now() - days * 86400000)}
   GROUP BY 1,provider_id,model_id,status ORDER BY 1 DESC,provider_id,model_id,status LIMIT 1000`);
    const [daily, monthly, errors, quota, providers] = await Promise.all([
      summarize('day', 30),
      summarize('month', 365),
      this.db.aiUsageRecord.groupBy({
        by: ['error_category'],
        where: {
          started_at: { gte: new Date(Date.now() - 30 * 86400000) },
          error_category: { not: null },
        },
        _count: true,
      }),
      this.db.aiUsageBucket.aggregate({
        where: { day: { gte: new Date(new Date().toISOString().slice(0, 10)) } },
        _sum: { requests: true, charged_tokens: true },
      }),
      this.db.aiProvider.findMany({ select: { id: true, type: true, enabled: true } }),
    ]);
    return {
      generatedAt: new Date(),
      timezone: 'UTC',
      daily,
      monthly,
      errors,
      quotaToday: quota._sum,
      providers,
      costNotice:
        'Estimated USD uses captured request pricing only. Null means unknown; sums cover known rows only. Quota charged tokens can include conservative reservations. Admission denials before reservation are counted by HTTP status, not provider usage.',
      rowLimit: 1000,
      providerHealth: 'Configuration state only; no paid provider probe',
      pythonService: 'Not deployed in this configuration',
    };
  }
  async platform() {
    const since = new Date(Date.now() - 7 * 86400000);
    const [registrations, activeLearners, enrollments, completedLessons, quizzes, videos, stored] =
      await Promise.all([
        this.db.user.count({ where: { created_at: { gte: since }, deleted_at: null } }),
        this.db.progress
          .groupBy({ by: ['user_id'], where: { last_accessed_at: { gte: since } } })
          .then((x) => x.length),
        this.db.enrollment.count({ where: { deleted_at: null, status: 'active' } }),
        this.db.progress.count({ where: { status: 'completed', completed_at: { gte: since } } }),
        this.db.quizAttempt.groupBy({ by: ['status'], _count: true }),
        this.db.video.groupBy({ by: ['status'], where: { deleted_at: null }, _count: true }),
        this.db.storageObject.aggregate({
          where: { deleted_at: null, status: 'ready' },
          _sum: { size: true },
          _count: true,
        }),
      ]);
    const attempts = quizzes.reduce((n, x) => n + x._count, 0),
      completed = quizzes
        .filter((x) => ['graded', 'pending_grading', 'submitted'].includes(x.status))
        .reduce((n, x) => n + x._count, 0);
    return {
      generatedAt: new Date(),
      registrationsLast7Days: registrations,
      activeLearnersLast7Days: activeLearners,
      activeEnrollments: enrollments,
      completedLessonsLast7Days: completedLessons,
      quizAttempts: attempts,
      quizCompletionRate: attempts ? completed / attempts : null,
      quizzes,
      videos,
      readyStorageBytes: stored._sum.size?.toString() ?? '0',
      readyStorageObjects: stored._count,
      capacityUtilization: null,
    };
  }
}
