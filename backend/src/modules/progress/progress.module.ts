import { Module } from '@nestjs/common';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';
import { EnrollmentsController, LearningController } from './learning.controller';
import { LearningAccessService } from './learning-access.service';
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module';
import { LearningAiController, LearningAiService } from './learning-ai';
import { LabsController, LabsService } from './labs';
import { LearningAnalyticsController, LearningAnalyticsService } from './learning-analytics';
import { LearningReferenceController } from './learning-reference';
import { LearningMaintenanceService } from './learning-maintenance.service';

@Module({
  imports: [AiGatewayModule],
  controllers: [
    ProgressController,
    EnrollmentsController,
    LearningController,
    LearningAiController,
    LabsController,
    LearningAnalyticsController,
    LearningReferenceController,
  ],
  providers: [
    ProgressService,
    LearningAccessService,
    LearningAiService,
    LabsService,
    LearningAnalyticsService,
    LearningMaintenanceService,
  ],
  exports: [ProgressService, LearningAccessService, LearningAiService, LearningAnalyticsService],
})
export class ProgressModule {}
