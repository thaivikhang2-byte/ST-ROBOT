// ═══════════════════════════════════════════
// Metrics — Metrics Controller
// /api/system/metrics endpoint (Prometheus)
// ═══════════════════════════════════════════

import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { MetricsGuard } from './metrics.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MetricsService } from './metrics.service';
import { Public } from '../shared/sdk/auth/decorators/public.decorator';

@ApiTags('System')
@Controller('system/metrics')
@Public()
@SkipThrottle()
@UseGuards(MetricsGuard)
@ApiBearerAuth('metrics-scrape')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Prometheus metrics' })
  async getMetrics(): Promise<string> {
    return this.metricsService.getMetrics();
  }
}
