import { Module } from '@nestjs/common';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { BullModule } from '@nestjs/bull';
import { SystemModule } from '../system/system.module';
import { StorageModule } from '../storage/storage.module';
import { BackupProcessor } from './backup.processor';

@Module({
  imports: [SystemModule, StorageModule, BullModule.registerQueue({ name: 'operations-backup' })],
  controllers: [BackupController],
  providers: [BackupService, BackupProcessor],
  exports: [BackupService],
})
export class BackupModule {}
