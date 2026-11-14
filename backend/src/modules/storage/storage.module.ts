import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { ProgressModule } from '../progress/progress.module';
import { BullModule } from '@nestjs/bull';
import { MediaCleanupProcessor, MediaMaintenance } from './media-maintenance';

@Module({
  imports: [ProgressModule, BullModule.registerQueue({ name: 'media-maintenance' })],
  controllers: [MediaController],
  providers: [StorageService, MediaService, MediaCleanupProcessor, MediaMaintenance],
  exports: [StorageService, MediaService],
})
export class StorageModule {}
