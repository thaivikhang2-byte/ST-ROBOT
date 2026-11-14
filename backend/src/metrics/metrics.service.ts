import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { AppLoggerService } from '../shared/sdk/logger/logger.service';
import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleDestroy {
  readonly registry = new Registry();
  readonly agentRuns = new Counter({
    name: 'ai_agent_runs_total',
    help: 'Agent turns since process start',
    labelNames: ['mode', 'status'],
    registers: [this.registry],
  });
  readonly agentDuration = new Histogram({
    name: 'ai_agent_duration_seconds',
    help: 'Agent orchestration duration',
    labelNames: ['mode', 'status'],
    buckets: [0.1, 1, 5, 15, 60, 120],
    registers: [this.registry],
  });
  readonly agentTools = new Counter({
    name: 'ai_agent_tools_total',
    help: 'Agent tool outcomes with server-bounded names',
    labelNames: ['mode', 'tool', 'status'],
    registers: [this.registry],
  });
  readonly agentCleanup = new Counter({
    name: 'ai_agent_cleanup_total',
    help: 'Completed retention scans',
    registers: [this.registry],
  });
  readonly aiLaneRequests = new Counter({
    name: 'ai_lane_requests_total',
    help: 'AI requests routed by intelligent router lane',
    labelNames: ['lane', 'mode'],
    registers: [this.registry],
  });
  readonly aiCacheHits = new Counter({
    name: 'ai_cache_events_total',
    help: 'Exact and semantic cache hits, misses and rejections',
    labelNames: ['level', 'outcome'],
    registers: [this.registry],
  });
  readonly aiRetries = new Counter({
    name: 'ai_retries_total',
    help: 'Bounded AI provider retries and failovers',
    labelNames: ['provider', 'reason', 'outcome'],
    registers: [this.registry],
  });
  readonly aiCircuitState = new Gauge({
    name: 'ai_circuit_breaker_state',
    help: 'Circuit breaker state per provider (0=CLOSED, 1=HALF_OPEN, 2=OPEN)',
    labelNames: ['provider'],
    registers: [this.registry],
  });
  readonly aiConfirmations = new Counter({
    name: 'ai_action_confirmations_total',
    help: 'Administrative action proposal confirmations, rejections and failures',
    labelNames: ['action_type', 'outcome'],
    registers: [this.registry],
  });
  readonly httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Completed HTTP requests',
    labelNames: ['method', 'path', 'status'],
    registers: [this.registry],
  });
  readonly httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP duration including streams',
    labelNames: ['method', 'path', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 15, 60, 120],
    registers: [this.registry],
  });
  readonly active = new Gauge({
    name: 'http_active_requests',
    help: 'In-flight HTTP requests',
    registers: [this.registry],
  });
  readonly dependency = new Gauge({
    name: 'dependency_up',
    help: 'Last probed dependency state',
    labelNames: ['dependency'],
    registers: [this.registry],
  });
  readonly aiRequests = new Gauge({
    name: 'ai_requests_last_24h',
    help: 'Persisted AI admissions over last 24h',
    labelNames: ['provider', 'status'],
    registers: [this.registry],
  });
  readonly backupTime = new Gauge({
    name: 'backup_last_verified_timestamp_seconds',
    help: 'Last completed authenticated backup time, absent if none',
    registers: [this.registry],
  });
  readonly queueDepth = new Gauge({
    name: 'worker_queue_jobs',
    help: 'Queue depth by fixed queue and state',
    labelNames: ['queue', 'state'],
    registers: [this.registry],
  });
  readonly jobs = new Counter({
    name: 'worker_jobs_total',
    help: 'Worker executions since process start',
    labelNames: ['queue', 'status'],
    registers: [this.registry],
  });
  readonly jobDuration = new Histogram({
    name: 'worker_job_duration_seconds',
    help: 'Worker execution duration',
    labelNames: ['queue', 'status'],
    buckets: [0.1, 1, 5, 30, 120, 600, 1800],
    registers: [this.registry],
  });
  private recent: {
    at: number;
    status: number;
    duration: number;
    path: string;
    requestId: string;
    traceId: string;
  }[] = [];
  private total = 0;
  private errors = 0;
  readonly since = new Date().toISOString();
  constructor(@Optional() private readonly logger?: AppLoggerService) {
    collectDefaultMetrics({ register: this.registry });
  }
  record(
    method: string,
    path: string,
    status: number,
    duration: number,
    requestId: string,
    traceId: string,
  ) {
    // Only Express registered route templates may be passed by the HTTP middleware.
    const labels = {
      method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)
        ? method
        : 'OTHER',
      path,
      status: String(status),
    };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDuration.observe(labels, duration);
    this.total++;
    if (status >= 500) this.errors++;
    this.recent.push({ at: Date.now(), status, duration, path, requestId, traceId });
    this.recent = this.recent.filter((x) => x.at > Date.now() - 300000).slice(-1000);
  }
  summary() {
    const recent = this.recent.filter((x) => x.at > Date.now() - 300000);
    const sorted = recent.map((x) => x.duration).sort((a, b) => a - b);
    return {
      since: this.since,
      total: this.total,
      errors: this.errors,
      windowSeconds: 300,
      sampledWindowRequests: recent.length,
      windowCapacity: 1000,
      errorRate: recent.length
        ? recent.filter((x) => x.status >= 500).length / recent.length
        : null,
      p95Seconds: sorted.length
        ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]
        : null,
      recentErrors: recent
        .filter((x) => x.status >= 500)
        .slice(-20)
        .reverse(),
    };
  }
  async job<T>(queue: string, run: () => Promise<T>): Promise<T> {
    const start = performance.now();
    let status = 'completed';
    try {
      return await run();
    } catch (e) {
      status = 'failed';
      throw e;
    } finally {
      this.jobs.inc({ queue, status });
      this.jobDuration.observe({ queue, status }, (performance.now() - start) / 1000);
      this.logger?.event(status === 'failed' ? 'error' : 'info', 'worker.execution', {
        queue,
        status,
        durationMs: Math.round(performance.now() - start),
      });
    }
  }
  getMetrics() {
    return this.registry.metrics();
  }
  onModuleDestroy() {
    this.registry.clear();
  }
}
