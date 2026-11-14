import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';
import { BullModule } from '@nestjs/bull';
import { HealthModule } from '../../health/health.module';
import { OperationsAccess } from './operations-access';
import { AnalyticsService } from '../analytics/analytics.service';
import { OperationalAlertsService } from './operational-alerts.service';

@Module({
  imports: [
    HealthModule,
    BullModule.registerQueue(
      { name: 'identity-mail' },
      { name: 'media-maintenance' },
      { name: 'video-processing' },
      { name: 'operations-backup' },
    ),
  ],
  controllers: [SystemController],
  providers: [SystemService, OperationsAccess, AnalyticsService, OperationalAlertsService],
  exports: [SystemService, OperationsAccess, AnalyticsService],
})
export class SystemModule {}
