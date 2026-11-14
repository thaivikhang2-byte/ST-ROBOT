import { Module } from '@nestjs/common';
import { LessonsController } from './lessons.controller';
import { LessonsService } from './lessons.service';
import { ProgressModule } from '../progress/progress.module';
import {
  CourseEnrolledPolicy,
  LessonOwnerPolicy,
  LessonAccessPolicy,
} from '../courses/policies/course.policies';

@Module({
  imports: [ProgressModule],
  controllers: [LessonsController],
  providers: [LessonsService, CourseEnrolledPolicy, LessonOwnerPolicy, LessonAccessPolicy],
  exports: [LessonsService],
})
export class LessonsModule {}
