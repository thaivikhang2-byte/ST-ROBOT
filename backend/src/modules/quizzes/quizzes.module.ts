import { Module } from '@nestjs/common';
import { QuizzesController, QuizAttemptsController } from './quizzes.controller';
import { QuizzesService } from './quizzes.service';
import { ProgressModule } from '../progress/progress.module';

@Module({
  imports: [ProgressModule],
  controllers: [QuizzesController, QuizAttemptsController],
  providers: [QuizzesService],
  exports: [QuizzesService],
})
export class QuizzesModule {}
