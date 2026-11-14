import { Module } from '@nestjs/common';
import { AuthModule } from '../../modules/auth/auth.module';
import { UsersModule } from '../../modules/users/users.module';
import { RolesModule } from '../../modules/roles/roles.module';
import { PermissionsModule } from '../../modules/permissions/permissions.module';
import { CoursesModule } from '../../modules/courses/courses.module';
import { LessonsModule } from '../../modules/lessons/lessons.module';
import { CategoriesModule } from '../../modules/categories/categories.module';
import { AiGatewayModule } from '../../modules/ai-gateway/ai-gateway.module';
import { AiAgentModule } from '../../modules/ai-gateway/agent/ai-agent.module';
import { ProgressModule } from '../../modules/progress/progress.module';
import { QuizzesModule } from '../../modules/quizzes/quizzes.module';
import { StorageModule } from '../../modules/storage/storage.module';
import { VideosModule } from '../../modules/videos/videos.module';
import { NotificationsModule } from '../../modules/notifications/notifications.module';
import { SystemModule } from '../../modules/system/system.module';
import { BackupModule } from '../../modules/backup/backup.module';
import { LearnerStateModule } from '../../modules/learner-state/learner-state.module';

@Module({
  imports: [
    SystemModule,
    BackupModule,
    LearnerStateModule,
    AuthModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    CoursesModule,
    LessonsModule,
    CategoriesModule,
    AiGatewayModule,
    AiAgentModule,
    ProgressModule,
    QuizzesModule,
    StorageModule,
    VideosModule,
    NotificationsModule,
  ],
})
export class ApiV1Module {}
