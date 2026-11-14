import { Module } from '@nestjs/common';
import { VideoSessionsController } from './video-sessions.controller';
import { VideoSessionsService } from './video-sessions.service';

@Module({
  controllers: [VideoSessionsController],
  providers: [VideoSessionsService],
  exports: [VideoSessionsService],
})
export class VideoSessionsModule {}
