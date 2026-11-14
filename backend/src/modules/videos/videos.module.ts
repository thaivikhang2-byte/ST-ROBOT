import { Module } from '@nestjs/common';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';
import { StorageModule } from '../storage/storage.module';
import { ProgressModule } from '../progress/progress.module';
import { BullModule } from '@nestjs/bull';
import { CloudflareStreamProvider, VIDEO_FETCH } from './cloudflare-stream.provider';
import { SelfHostedHlsProvider } from './self-hosted-hls.provider';
import { VideoWorker, VideoMaintenance } from './video.worker';

@Module({
  imports: [StorageModule, ProgressModule, BullModule.registerQueue({ name: 'video-processing' })],
  controllers: [VideosController],
  providers: [
    VideosService,
    CloudflareStreamProvider,
    SelfHostedHlsProvider,
    VideoWorker,
    VideoMaintenance,
    { provide: VIDEO_FETCH, useValue: fetch },
  ],
  exports: [VideosService],
})
export class VideosModule {}
