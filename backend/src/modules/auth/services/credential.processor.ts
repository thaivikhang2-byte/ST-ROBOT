import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { CredentialService } from './credential.service';
import { MetricsService } from '../../../metrics/metrics.service';
import { TraceContext, withContext } from '../../../shared/sdk/logger/request-context';

@Processor('identity-mail')
export class CredentialProcessor {
  constructor(
    private readonly credentials: CredentialService,
    private readonly metrics: MetricsService,
  ) {}

  @Process('deliver')
  async deliver(
    job: Job<{ email: string; purpose: 'reset' | 'verify'; _trace?: TraceContext }>,
  ): Promise<void> {
    await withContext(job.data._trace, () =>
      this.metrics.job('identity-mail', () =>
        this.credentials.deliver(job.data.email, job.data.purpose),
      ),
    );
  }
}
