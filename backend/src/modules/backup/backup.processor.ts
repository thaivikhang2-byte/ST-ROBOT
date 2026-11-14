import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { BackupService } from './backup.service';
import { MetricsService } from '../../metrics/metrics.service';
import { withContext, TraceContext } from '../../shared/sdk/logger/request-context';
@Processor('operations-backup')
export class BackupProcessor {
  constructor(
    private readonly backup: BackupService,
    private readonly metrics: MetricsService,
  ) {}
  @Process({ name: 'snapshot', concurrency: 1 })
  run(job: Job<{ _trace?: TraceContext }>) {
    return withContext(job.data._trace, () =>
      this.metrics.job('operations-backup', () => this.backup.create()),
    );
  }
}
