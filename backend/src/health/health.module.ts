// ═══════════════════════════════════════════
// Health — Health Module
// ═══════════════════════════════════════════

import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { StorageModule } from '../modules/storage/storage.module';

@Module({
  imports: [TerminusModule, StorageModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
