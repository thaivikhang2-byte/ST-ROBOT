import { Module } from '@nestjs/common';
import { LearningAccessService } from '../progress/learning-access.service';
import { LearnerStateController } from './learner-state.controller';
import { LearnerStateService } from './learner-state.service';

@Module({
  controllers: [LearnerStateController],
  providers: [LearnerStateService, LearningAccessService],
})
export class LearnerStateModule {}
