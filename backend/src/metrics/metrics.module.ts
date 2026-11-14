// ═══════════════════════════════════════════
// Metrics — Metrics Module
// ═══════════════════════════════════════════

import { Global, Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { MetricsGuard } from './metrics.guard';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, MetricsGuard],
  exports: [MetricsService],
})
export class MetricsModule {}
