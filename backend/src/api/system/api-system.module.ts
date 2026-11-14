// ═══════════════════════════════════════════
// API Gateway — System Route Group
// /api/system/* — Health, metrics, system info
// ═══════════════════════════════════════════

import { Module } from '@nestjs/common';
import { HealthModule } from '../../health/health.module';
import { MetricsModule } from '../../metrics/metrics.module';

@Module({
  imports: [HealthModule, MetricsModule],
})
export class ApiSystemModule {}
