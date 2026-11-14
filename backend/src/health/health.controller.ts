// ═══════════════════════════════════════════
// Health — Health Controller
// /api/system/health endpoint
// ═══════════════════════════════════════════

import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../shared/sdk/auth/decorators/public.decorator';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthService } from './health.service';

@ApiTags('System')
@Controller('system/health')
@Public()
@SkipThrottle()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Health check' })
  check() {
    return this.health.ready();
  }
  @Get('live')
  @ApiOperation({ summary: 'Process liveness, no dependency details' })
  live() {
    return { status: 'ok' };
  }
  @Get('ready')
  @ApiOperation({ summary: 'Readiness: critical dependencies must be available' })
  ready() {
    return this.health.ready();
  }
}
